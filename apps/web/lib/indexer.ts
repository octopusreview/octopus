import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, readdir, stat, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { getInstallationToken, getFileContent as ghGetFileContent, getRepositoryDetails } from "@/lib/github";
import * as bitbucketLib from "@/lib/bitbucket";
import * as gitlabLib from "@/lib/gitlab";
import { ensureCollection, upsertChunks, deleteRepoChunks, deleteRepoFileChunks } from "@/lib/qdrant";
import { generateSparseVectors } from "@/lib/sparse-vector";
import { parseOctopusIgnore, type Ignore } from "@/lib/octopus-ignore";

const execFileAsync = promisify(execFile);

const GITHUB_API = "https://api.github.com";
const MAX_FILE_SIZE = 100_000; // 100KB — skip larger files
const CHUNK_SIZE = 1500; // ~375 tokens
const CHUNK_OVERLAP = 200;

// File extensions we want to index
const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".rb",
  ".c", ".cpp", ".h", ".hpp", ".cs", ".swift", ".kt", ".scala",
  ".vue", ".svelte", ".astro", ".html", ".css", ".scss",
  ".sql", ".graphql", ".proto", ".yaml", ".yml", ".toml",
  ".md", ".mdx", ".txt", ".json", ".xml",
  ".sh", ".bash", ".zsh", ".fish",
  ".dockerfile", ".prisma", ".env.example",
]);

const IGNORE_PATHS = [
  "node_modules/", ".git/", "dist/", "build/", ".next/",
  "vendor/", "__pycache__/", ".turbo/", "coverage/",
  "package-lock.json", "bun.lock", "yarn.lock", "pnpm-lock.yaml",
];

interface TreeItem {
  path: string;
  type: string;
  sha: string;
  size?: number;
}

export type LogLevel = "info" | "success" | "error" | "warning";

export type OnLog = (message: string, level?: LogLevel) => void;

function shouldIndex(path: string, size?: number, ig?: Ignore): boolean {
  if (size && size > MAX_FILE_SIZE) return false;
  if (IGNORE_PATHS.some((p) => path.includes(p))) return false;
  if (ig?.ignores(path)) return false;

  const ext = "." + path.split(".").pop()?.toLowerCase();
  const basename = path.split("/").pop() ?? "";

  // Handle extensionless files like Dockerfile, Makefile
  if (basename === "Dockerfile" || basename === "Makefile") return true;

  return CODE_EXTENSIONS.has(ext);
}

function chunkText(
  content: string,
  filePath: string,
): { text: string; startLine: number; endLine: number }[] {
  const lines = content.split("\n");
  const chunks: { text: string; startLine: number; endLine: number }[] = [];

  let currentChunk = "";
  let startLine = 1;
  let currentLine = 1;

  for (const line of lines) {
    // If a single line exceeds CHUNK_SIZE, split it into smaller pieces
    if (line.length > CHUNK_SIZE) {
      // First, flush any accumulated chunk
      if (currentChunk.length > 0) {
        chunks.push({
          text: `// File: ${filePath}\n${currentChunk}`,
          startLine,
          endLine: currentLine - 1,
        });
        currentChunk = "";
      }

      // Split the long line into CHUNK_SIZE pieces
      for (let j = 0; j < line.length; j += CHUNK_SIZE - CHUNK_OVERLAP) {
        const piece = line.slice(j, j + CHUNK_SIZE);
        chunks.push({
          text: `// File: ${filePath}\n${piece}`,
          startLine: currentLine,
          endLine: currentLine,
        });
      }

      startLine = currentLine + 1;
    } else if (currentChunk.length + line.length + 1 > CHUNK_SIZE && currentChunk.length > 0) {
      chunks.push({
        text: `// File: ${filePath}\n${currentChunk}`,
        startLine,
        endLine: currentLine - 1,
      });

      // Overlap: go back a few lines
      const overlapLines = currentChunk.split("\n").slice(-3);
      currentChunk = overlapLines.join("\n") + "\n" + line;
      startLine = currentLine - overlapLines.length;
    } else {
      currentChunk += (currentChunk ? "\n" : "") + line;
    }
    currentLine++;
  }

  if (currentChunk.trim()) {
    chunks.push({
      text: `// File: ${filePath}\n${currentChunk}`,
      startLine,
      endLine: currentLine - 1,
    });
  }

  return chunks;
}

export interface Contributor {
  login: string;
  avatarUrl: string;
  contributions: number;
}

export interface IndexStats {
  totalFiles: number;
  indexedFiles: number;
  totalChunks: number;
  totalVectors: number;
  contributorCount: number;
  contributors: Contributor[];
  durationMs: number;
  /** Set when GitHub reported a different default branch than the caller passed in. */
  resolvedDefaultBranch?: string;
}

export async function indexRepository(
  repoId: string,
  fullName: string,
  defaultBranch: string,
  installationId: number,
  onLog: OnLog = () => {},
  signal?: AbortSignal,
  provider: string = "github",
  organizationId?: string,
  /** Pre-resolved token (e.g. GITHUB_TOKEN from Actions). Skips getInstallationToken when provided. */
  providedToken?: string,
): Promise<IndexStats> {
  const startTime = Date.now();

  const allChunks: {
    text: string;
    filePath: string;
    startLine: number;
    endLine: number;
  }[] = [];

  let totalFileCount = 0;
  let processed = 0;
  let skipped = 0;
  let contributorCount = 0;
  let contributors: Contributor[] = [];
  let resolvedDefaultBranch: string | undefined;

  if ((provider === "bitbucket" || provider === "gitlab") && organizationId) {
    // ── Bitbucket / GitLab indexing flow (clone-based) ──
    const isGl = provider === "gitlab";
    onLog(`Authenticating with ${isGl ? "GitLab" : "Bitbucket"}...`);
    const token = isGl
      ? await gitlabLib.getAccessToken(organizationId)
      : await bitbucketLib.getAccessToken(organizationId);
    onLog(`${isGl ? "GitLab" : "Bitbucket"} authentication successful`, "success");

    // 1. Shallow clone the repo
    const cloneDir = join(tmpdir(), `octopus-${isGl ? "gl" : "bb"}-${repoId}-${Date.now()}`);
    let cloneUrl: string;
    if (isGl) {
      const gh = await gitlabLib.getCloneHost(organizationId);
      cloneUrl = `${gh}/${fullName}.git`;
    } else {
      const [workspace, repoSlug] = fullName.split("/");
      cloneUrl = `https://bitbucket.org/${workspace}/${repoSlug}.git`;
    }
    // GitLab's git smart-http server requires Basic auth (Bearer is rejected);
    // Bitbucket accepts a Bearer header. Build the auth header per provider —
    // never embed the token in the URL, since git surfaces the cmd in error logs.
    const gitAuthHeader = isGl
      ? `Basic ${Buffer.from(`oauth2:${token}`).toString("base64")}`
      : `Bearer ${token}`;

    try {
      onLog(`Cloning ${fullName}@${defaultBranch}...`);
      const cloneController = new AbortController();
      if (signal) {
        signal.addEventListener("abort", () => cloneController.abort(), { once: true });
      }
      try {
        await execFileAsync("git", [
          "clone",
          "--depth", "1",
          "--branch", defaultBranch,
          "--single-branch",
          cloneUrl,
          cloneDir,
        ], {
          timeout: 120_000,
          signal: cloneController.signal,
          env: {
            ...process.env,
            GIT_CONFIG_COUNT: "1",
            GIT_CONFIG_KEY_0: "http.extraHeader",
            GIT_CONFIG_VALUE_0: `Authorization: ${gitAuthHeader}`,
          },
        });
      } catch (err) {
        const stderr = (err as { stderr?: string }).stderr ?? "";
        const msg = err instanceof Error ? err.message : String(err);
        const combined = `${stderr}\n${msg}`.toLowerCase();
        const looksEmpty =
          combined.includes("remote branch") && combined.includes("not found") ||
          combined.includes("couldn't find remote ref") ||
          combined.includes("you appear to have cloned an empty repository") ||
          combined.includes("warning: you appear to have cloned an empty");
        if (looksEmpty) {
          onLog(
            `Repository '${fullName}' appears to be empty: there are no files on branch '${defaultBranch}' to index. Push some code to the repository and try again.`,
            "error",
          );
          throw new Error(
            `Repository is empty: no files to index on branch '${defaultBranch}'. Push some code and retry indexing.`,
          );
        }
        throw err;
      }
      onLog("Repository cloned successfully", "success");

      // 2. Walk the cloned directory to get all file paths
      onLog(`Scanning repository files...`);
      const allPaths: string[] = [];

      const MAX_DEPTH = 50;
      async function walkDir(dir: string, prefix: string, depth = 0) {
        if (depth > MAX_DEPTH) return;
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === ".git") continue;
          if (entry.isSymbolicLink()) continue; // skip symlinks to avoid infinite loops
          const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            await walkDir(join(dir, entry.name), relPath, depth + 1);
          } else if (entry.isFile()) {
            allPaths.push(relPath);
          }
        }
      }

      await walkDir(cloneDir, "");

      // Check for .octopusignore
      let ig: Ignore | undefined;
      if (allPaths.includes(".octopusignore")) {
        try {
          const ignoreContent = await readFile(join(cloneDir, ".octopusignore"), "utf-8");
          ig = parseOctopusIgnore(ignoreContent);
          onLog("Found .octopusignore — applying custom ignore rules", "info");
        } catch {
          onLog("Failed to read .octopusignore, continuing without it", "warning");
        }
      }

      const filePaths = allPaths.filter((p) => shouldIndex(p, undefined, ig));
      totalFileCount = allPaths.length;

      onLog(`Found ${allPaths.length} total files, ${filePaths.length} eligible for indexing`, "success");

      // 3. Read file contents from disk
      onLog("Processing file contents...");

      for (let i = 0; i < filePaths.length; i++) {
        if (signal?.aborted) throw new Error("Indexing cancelled");

        const filePath = filePaths[i];
        try {
          const fullPath = join(cloneDir, filePath);
          const fileStat = await stat(fullPath);

          if (fileStat.size > MAX_FILE_SIZE) {
            skipped++;
            continue;
          }

          const content = await readFile(fullPath, "utf-8");

          if (content.includes("\0")) {
            skipped++;
            continue;
          }

          const chunks = chunkText(content, filePath);
          for (const chunk of chunks) {
            allChunks.push({
              text: chunk.text,
              filePath,
              startLine: chunk.startLine,
              endLine: chunk.endLine,
            });
          }
          processed++;
        } catch {
          skipped++;
        }

        if (processed > 0 && i % 100 === 0) {
          onLog(`Processing files... ${processed}/${filePaths.length}`);
        }
      }

      onLog(`Processed ${processed} files, skipped ${skipped}, created ${allChunks.length} chunks`, "success");
    } finally {
      // Clean up cloned directory
      try {
        await rm(cloneDir, { recursive: true, force: true });
      } catch {
        console.warn(`[indexer] Failed to clean up clone dir: ${cloneDir}`);
      }
    }
  } else {
    // ── GitHub indexing flow ──
    onLog("Authenticating with GitHub...");
    const token = providedToken ?? await getInstallationToken(installationId);
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    };
    onLog("GitHub authentication successful", "success");

    // 1. Get repo tree. The stored default branch can be stale (e.g. webhook
    // payload omitted it and we fell back to "main" on a master repo), so on
    // 404 we re-resolve the branch from the repo metadata before giving up.
    let activeBranch = defaultBranch;

    onLog(`Fetching repository tree for ${fullName}@${activeBranch}...`);
    let treeRes = await fetch(
      `${GITHUB_API}/repos/${fullName}/git/trees/${activeBranch}?recursive=1`,
      { headers },
    );

    if (!treeRes.ok && treeRes.status === 404) {
      const [owner, repoName] = fullName.split("/");
      const details = await getRepositoryDetails(installationId, owner, repoName, token);
      if (!details) {
        onLog(`Repository not found or GitHub App lacks access to ${fullName}`, "error");
        onLog("Go to GitHub Settings → Applications → Configure to grant access", "warning");
        throw new Error(`GitHub App does not have access to ${fullName}`);
      }
      if (details.default_branch !== activeBranch) {
        onLog(`Default branch mismatch: stored '${activeBranch}', actual '${details.default_branch}' — retrying`, "warning");
        activeBranch = details.default_branch;
        resolvedDefaultBranch = details.default_branch;
        treeRes = await fetch(
          `${GITHUB_API}/repos/${fullName}/git/trees/${activeBranch}?recursive=1`,
          { headers },
        );
      }
    }

    if (!treeRes.ok) {
      if (treeRes.status === 409) {
        onLog(
          `Repository '${fullName}' appears to be empty: there are no files to index. Push some code to the repository and try again.`,
          "error",
        );
        throw new Error(
          `Repository is empty: no files to index. Push some code and retry indexing.`,
        );
      }
      if (treeRes.status === 404) {
        onLog(`Branch '${activeBranch}' not found on ${fullName}`, "error");
        throw new Error(`Branch '${activeBranch}' not found on ${fullName}`);
      }
      onLog(`Failed to fetch tree: HTTP ${treeRes.status}`, "error");
      throw new Error(`Failed to fetch tree: ${treeRes.status}`);
    }

    const treeData = await treeRes.json();
    const allItems = (treeData.tree as TreeItem[] | undefined) ?? [];

    if (allItems.length === 0) {
      onLog(
        `Repository '${fullName}' appears to be empty: there are no files to index. Push some code to the repository and try again.`,
        "error",
      );
      throw new Error(
        `Repository is empty: no files to index. Push some code and retry indexing.`,
      );
    }

    // Check for .octopusignore
    let ig: Ignore | undefined;
    const ignoreBlob = allItems.find((item) => item.type === "blob" && item.path === ".octopusignore");
    if (ignoreBlob) {
      try {
        const [owner, repoName] = fullName.split("/");
        const ignoreContent = await ghGetFileContent(installationId, owner, repoName, activeBranch, ".octopusignore");
        if (ignoreContent) {
          ig = parseOctopusIgnore(ignoreContent);
          onLog("Found .octopusignore — applying custom ignore rules", "info");
        }
      } catch {
        onLog("Failed to fetch .octopusignore, continuing without it", "warning");
      }
    }

    const files: TreeItem[] = allItems.filter(
      (item) => item.type === "blob" && shouldIndex(item.path, item.size, ig),
    );
    totalFileCount = allItems.length;

    onLog(`Found ${allItems.length} total files, ${files.length} eligible for indexing`, "success");

    // 1b. Fetch contributors
    try {
      const contribRes = await fetch(
        `${GITHUB_API}/repos/${fullName}/contributors?per_page=30`,
        { headers },
      );
      if (contribRes.ok) {
        const contribData = await contribRes.json();
        if (Array.isArray(contribData)) {
          contributors = contribData.map((c: { login: string; avatar_url: string; contributions: number }) => ({
            login: c.login,
            avatarUrl: c.avatar_url,
            contributions: c.contributions,
          }));
          const linkHeader = contribRes.headers.get("link");
          if (linkHeader) {
            const match = linkHeader.match(/page=(\d+)>; rel="last"/);
            contributorCount = match ? parseInt(match[1], 10) * 30 : contributors.length;
          } else {
            contributorCount = contributors.length;
          }
        }
      }
      onLog(`Found ${contributorCount} contributors`, "success");
    } catch {
      onLog("Could not fetch contributor count", "warning");
    }

    // 2. Fetch file contents and chunk
    onLog("Fetching and chunking file contents...");
    const CONCURRENCY = 10;

    // Per-blob fetch timeout. Without this, a stalled GitHub blob response hangs
    // the whole Promise.all batch indefinitely (see tgoskits incident).
    const BLOB_FETCH_TIMEOUT_MS = 30_000;

    async function fetchWithTimeout(url: string): Promise<Response> {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), BLOB_FETCH_TIMEOUT_MS);
      const onParentAbort = () => ctrl.abort();
      signal?.addEventListener("abort", onParentAbort);
      try {
        return await fetch(url, { headers, signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onParentAbort);
      }
    }

    function skip(filePath: string, reason: string) {
      skipped++;
      onLog(`Skipped ${filePath}: ${reason}`, "warning");
    }

    async function fetchBlob(file: TreeItem): Promise<void> {
      try {
        const url = `${GITHUB_API}/repos/${fullName}/git/blobs/${file.sha}`;
        const blobRes = await fetchWithTimeout(url);

        if (!blobRes.ok) {
          if (blobRes.status === 403 || blobRes.status === 429) {
            const retryAfter = parseInt(blobRes.headers.get("retry-after") ?? "5", 10);
            onLog(`Rate limited, waiting ${retryAfter}s...`, "warning");
            await new Promise((r) => setTimeout(r, retryAfter * 1000));

            const retry = await fetchWithTimeout(url);
            if (!retry.ok) {
              skip(file.path, `HTTP ${retry.status} after rate-limit retry`);
              return;
            }
            const retryData = await retry.json();
            processBlob(retryData, file.path);
            return;
          }
          skip(file.path, `HTTP ${blobRes.status}`);
          return;
        }

        const blobData = await blobRes.json();
        processBlob(blobData, file.path);
      } catch (err) {
        if (signal?.aborted) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        skip(file.path, msg);
      }
    }

    function processBlob(blobData: { encoding: string; content?: string }, filePath: string) {
      if (blobData.encoding !== "base64") {
        skip(filePath, `unsupported encoding '${blobData.encoding}'`);
        return;
      }
      if (!blobData.content) {
        skip(filePath, "empty blob content");
        return;
      }

      const content = Buffer.from(blobData.content, "base64").toString("utf-8");

      if (content.includes("\0")) {
        skip(filePath, "binary content (null byte)");
        return;
      }

      const chunks = chunkText(content, filePath);
      for (const chunk of chunks) {
        allChunks.push({
          text: chunk.text,
          filePath,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
        });
      }
      processed++;
    }

    for (let i = 0; i < files.length; i += CONCURRENCY) {
      if (signal?.aborted) throw new Error("Indexing cancelled");
      const batch = files.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(fetchBlob));
      if (processed > 0) {
        onLog(`Processing files... ${processed}/${files.length}`);
      }
    }

    onLog(`Processed ${processed} files, skipped ${skipped}, created ${allChunks.length} chunks`, "success");
  }

  if (allChunks.length === 0) {
    onLog("No indexable content found", "warning");
    return {
      totalFiles: totalFileCount,
      indexedFiles: processed,
      totalChunks: 0,
      totalVectors: 0,
      contributorCount,
      contributors,
      durationMs: Date.now() - startTime,
      resolvedDefaultBranch,
    };
  }

  // 3. Ensure Qdrant collection exists
  onLog("Preparing vector database...");
  await ensureCollection();
  onLog("Vector database ready", "success");

  // 4. Delete old chunks for this repo
  onLog("Cleaning up previous index data...");
  await deleteRepoChunks(repoId);
  onLog("Previous data cleared", "success");

  // 5. Create embeddings in batches
  const texts = allChunks.map((c) => c.text);
  const totalBatches = Math.ceil(texts.length / 512);
  onLog(`Generating embeddings for ${texts.length} chunks (${totalBatches} batch${totalBatches > 1 ? "es" : ""})...`);

  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += 512) {
    if (signal?.aborted) throw new Error("Indexing cancelled");

    const batch = texts.slice(i, i + 512);
    const batchNum = Math.floor(i / 512) + 1;
    if (totalBatches > 1) {
      onLog(`Processing embedding batch ${batchNum}/${totalBatches}...`);
    }

    const { createEmbeddings: embed } = await import("@/lib/embeddings");
    const batchVectors = await embed(batch);
    vectors.push(...batchVectors);
  }

  onLog(`Generated ${vectors.length} embeddings`, "success");

  if (signal?.aborted) throw new Error("Indexing cancelled");

  // 6. Upsert to Qdrant
  const sparseVectors = generateSparseVectors(texts);

  const indexedAt = new Date().toISOString();
  const points = allChunks.map((chunk, i) => ({
    id: crypto.randomUUID(),
    vector: vectors[i],
    sparseVector: sparseVectors[i],
    payload: {
      repoId,
      fullName,
      filePath: chunk.filePath,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      text: chunk.text,
      language: chunk.filePath.split(".").pop() ?? "unknown",
      indexedAt,
    },
  }));

  const qdrantBatches = Math.ceil(points.length / 100);
  onLog(`Storing ${points.length} vectors in database (${qdrantBatches} batch${qdrantBatches > 1 ? "es" : ""})...`);
  await upsertChunks(points);
  onLog(`Successfully stored ${points.length} vectors`, "success");

  return {
    totalFiles: totalFileCount,
    indexedFiles: processed,
    totalChunks: allChunks.length,
    totalVectors: points.length,
    contributorCount,
    contributors,
    durationMs: Date.now() - startTime,
    resolvedDefaultBranch,
  };
}

/**
 * Incrementally re-index only the changed files from a merged PR.
 * Deletes old chunks for changed/removed files, fetches & indexes added/modified files.
 * The repo stays "indexed" throughout — no downtime window.
 */
export async function incrementalIndex(
  repoId: string,
  fullName: string,
  defaultBranch: string,
  installationId: number,
  changedFiles: { filename: string; status: string }[],
  provider: string = "github",
  organizationId?: string,
): Promise<{ updatedFiles: number; removedFiles: number; newVectors: number }> {
  const removed = changedFiles
    .filter((f) => f.status === "removed")
    .map((f) => f.filename);
  const addedOrModified = changedFiles
    .filter((f) => f.status !== "removed" && shouldIndex(f.filename))
    .map((f) => f.filename);

  // 1. Delete chunks for all changed files (removed + modified + added that had old version)
  const allChangedPaths = [...new Set([...removed, ...addedOrModified])];
  if (allChangedPaths.length > 0) {
    await ensureCollection();
    await deleteRepoFileChunks(repoId, allChangedPaths);
  }

  // 2. Fetch and chunk only added/modified files
  if (addedOrModified.length === 0) {
    return { updatedFiles: 0, removedFiles: removed.length, newVectors: 0 };
  }

  const allChunks: { text: string; filePath: string; startLine: number; endLine: number }[] = [];

  if (provider === "github") {
    for (const filePath of addedOrModified) {
      try {
        const [owner, repoName] = fullName.split("/");
        const content = await ghGetFileContent(installationId, owner, repoName, defaultBranch, filePath);
        if (!content || content.includes("\0")) continue;
        const chunks = chunkText(content, filePath);
        for (const chunk of chunks) {
          allChunks.push({ text: chunk.text, filePath, startLine: chunk.startLine, endLine: chunk.endLine });
        }
      } catch {
        console.warn(`[indexer:incremental] Failed to fetch ${filePath}, skipping`);
      }
    }
  } else if (provider === "bitbucket" && organizationId) {
    const [workspace, repoSlug] = fullName.split("/");
    for (const filePath of addedOrModified) {
      try {
        const content = await bitbucketLib.getFileContent(organizationId, workspace, repoSlug, defaultBranch, filePath);
        if (!content || content.includes("\0")) continue;
        const chunks = chunkText(content, filePath);
        for (const chunk of chunks) {
          allChunks.push({ text: chunk.text, filePath, startLine: chunk.startLine, endLine: chunk.endLine });
        }
      } catch {
        console.warn(`[indexer:incremental] Failed to fetch ${filePath}, skipping`);
      }
    }
  } else if (provider === "gitlab" && organizationId) {
    for (const filePath of addedOrModified) {
      try {
        const content = await gitlabLib.getFileContent(organizationId, fullName, defaultBranch, filePath);
        if (!content || content.includes("\0")) continue;
        const chunks = chunkText(content, filePath);
        for (const chunk of chunks) {
          allChunks.push({ text: chunk.text, filePath, startLine: chunk.startLine, endLine: chunk.endLine });
        }
      } catch {
        console.warn(`[indexer:incremental] Failed to fetch ${filePath}, skipping`);
      }
    }
  }

  if (allChunks.length === 0) {
    return { updatedFiles: addedOrModified.length, removedFiles: removed.length, newVectors: 0 };
  }

  // 3. Generate embeddings & upsert
  const texts = allChunks.map((c) => c.text);
  const { createEmbeddings } = await import("@/lib/embeddings");
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += 512) {
    const batch = texts.slice(i, i + 512);
    const batchVectors = await createEmbeddings(batch);
    vectors.push(...batchVectors);
  }

  const sparseVectors = generateSparseVectors(texts);
  const indexedAt = new Date().toISOString();
  const points = allChunks.map((chunk, i) => ({
    id: crypto.randomUUID(),
    vector: vectors[i],
    sparseVector: sparseVectors[i],
    payload: {
      repoId,
      fullName,
      filePath: chunk.filePath,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      text: chunk.text,
      language: chunk.filePath.split(".").pop() ?? "unknown",
      indexedAt,
    },
  }));

  await upsertChunks(points);

  return { updatedFiles: addedOrModified.length, removedFiles: removed.length, newVectors: points.length };
}
