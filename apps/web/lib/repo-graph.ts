import { getQdrantClient, COLLECTION_NAME } from "@/lib/qdrant";

export type GraphNode = {
  id: string;
  path: string;
  name: string;
  dir: string;
  language: string;
  chunks: number;
  lines: number;
};

export type GraphEdge = {
  source: string;
  target: string;
  type: "import" | "semantic";
  weight: number;
};

export type GraphHighlight = {
  id: string;
  path: string;
  title: string;
  description: string;
  kind: "entrypoint" | "config" | "hub" | "large";
  score: number;
};

export type RepoGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  highlights: GraphHighlight[];
};

type ScrollPoint = {
  id: string | number;
  payload?: Record<string, unknown> | null;
  vector?: unknown;
};

const MAX_CHUNKS_SCANNED = 5000;
const MAX_NODES = 400;
const SEMANTIC_TOP_K_PER_NODE = 3;
const SEMANTIC_MIN_SCORE = 0.55;

const IMPORT_RE =
  /(?:import\s+[^;'"`]+?from\s+|import\s+|require\(|from\s+)['"]([^'"]+)['"]/g;

async function scrollRepoChunks(
  repoId: string,
): Promise<ScrollPoint[]> {
  const qdrant = getQdrantClient();
  const points: ScrollPoint[] = [];
  let offset: string | number | undefined = undefined;

  while (points.length < MAX_CHUNKS_SCANNED) {
    const result = await qdrant.scroll(COLLECTION_NAME, {
      filter: { must: [{ key: "repoId", match: { value: repoId } }] },
      limit: 256,
      offset,
      with_payload: true,
      with_vector: true,
    });

    points.push(...(result.points as unknown as ScrollPoint[]));
    const next = result.next_page_offset;
    if (next === null || next === undefined) break;
    offset = next as string | number;
  }

  return points;
}

function extractVector(vector: unknown): number[] | null {
  if (!vector) return null;
  if (Array.isArray(vector) && typeof vector[0] === "number") {
    return vector as number[];
  }
  if (typeof vector === "object") {
    const named = (vector as Record<string, unknown>)[""];
    if (Array.isArray(named) && typeof named[0] === "number") {
      return named as number[];
    }
    for (const v of Object.values(vector as Record<string, unknown>)) {
      if (Array.isArray(v) && typeof v[0] === "number") {
        return v as number[];
      }
    }
  }
  return null;
}

function normalize(v: number[]): number[] {
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  if (norm === 0) return v;
  const out = new Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}

function topDir(p: string): string {
  const i = p.indexOf("/");
  return i === -1 ? "." : p.slice(0, i);
}

function resolveImport(
  fromFile: string,
  spec: string,
  allFiles: Set<string>,
): string | null {
  if (!spec.startsWith(".") && !spec.startsWith("/")) return null;

  const fromDir = fromFile.slice(0, fromFile.lastIndexOf("/"));
  const parts = (spec.startsWith("/") ? spec : `${fromDir}/${spec}`).split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  const base = stack.join("/");

  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mjs`,
    `${base}.cjs`,
    `${base}.py`,
    `${base}.go`,
    `${base}.rs`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.js`,
    `${base}/index.jsx`,
    `${base}/__init__.py`,
    `${base}/mod.rs`,
  ];
  for (const c of candidates) {
    if (allFiles.has(c)) return c;
  }
  return null;
}

export async function buildRepoGraph(repoId: string): Promise<RepoGraph> {
  const points = await scrollRepoChunks(repoId);

  type FileAgg = {
    path: string;
    chunks: number;
    lines: number;
    language: string;
    text: string[];
    vectorSum: number[] | null;
    vectorCount: number;
  };

  const files = new Map<string, FileAgg>();

  for (const p of points) {
    const payload = p.payload ?? {};
    const filePath = (payload.filePath as string) ?? "";
    if (!filePath) continue;

    const endLine = (payload.endLine as number) ?? 0;
    const text = (payload.text as string) ?? "";
    const language = (payload.language as string) ?? "unknown";

    let agg = files.get(filePath);
    if (!agg) {
      agg = {
        path: filePath,
        chunks: 0,
        lines: 0,
        language,
        text: [],
        vectorSum: null,
        vectorCount: 0,
      };
      files.set(filePath, agg);
    }
    agg.chunks += 1;
    agg.lines = Math.max(agg.lines, endLine);
    agg.text.push(text);

    const vec = extractVector(p.vector);
    if (vec) {
      if (!agg.vectorSum) {
        agg.vectorSum = vec.slice();
      } else {
        for (let i = 0; i < vec.length; i++) agg.vectorSum[i] += vec[i];
      }
      agg.vectorCount += 1;
    }
  }

  // Sort by chunk count, cap to MAX_NODES
  const topFiles = [...files.values()]
    .sort((a, b) => b.chunks - a.chunks)
    .slice(0, MAX_NODES);

  const allPaths = new Set(topFiles.map((f) => f.path));
  const pathToId = new Map<string, string>();
  const nodes: GraphNode[] = topFiles.map((f, idx) => {
    const id = `n${idx}`;
    pathToId.set(f.path, id);
    return {
      id,
      path: f.path,
      name: basename(f.path),
      dir: topDir(f.path),
      language: f.language,
      chunks: f.chunks,
      lines: f.lines,
    };
  });

  const edges: GraphEdge[] = [];
  const edgeKey = new Set<string>();

  // Structural edges from import statements
  for (const f of topFiles) {
    const fromId = pathToId.get(f.path)!;
    const blob = f.text.join("\n");
    IMPORT_RE.lastIndex = 0;
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = IMPORT_RE.exec(blob)) !== null) {
      const spec = m[1];
      if (seen.has(spec)) continue;
      seen.add(spec);
      const resolved = resolveImport(f.path, spec, allPaths);
      if (!resolved || resolved === f.path) continue;
      const toId = pathToId.get(resolved);
      if (!toId) continue;
      const key = `${fromId}->${toId}:import`;
      if (edgeKey.has(key)) continue;
      edgeKey.add(key);
      edges.push({ source: fromId, target: toId, type: "import", weight: 1 });
    }
  }

  // Semantic edges via cosine similarity on averaged embeddings
  const withVec = topFiles
    .map((f) => {
      if (!f.vectorSum || f.vectorCount === 0) return null;
      const avg = f.vectorSum.map((x) => x / f.vectorCount);
      return { path: f.path, id: pathToId.get(f.path)!, vec: normalize(avg) };
    })
    .filter((x): x is { path: string; id: string; vec: number[] } => !!x);

  for (let i = 0; i < withVec.length; i++) {
    const a = withVec[i];
    const scored: { id: string; score: number }[] = [];
    for (let j = 0; j < withVec.length; j++) {
      if (i === j) continue;
      const score = dot(a.vec, withVec[j].vec);
      if (score >= SEMANTIC_MIN_SCORE) {
        scored.push({ id: withVec[j].id, score });
      }
    }
    scored.sort((x, y) => y.score - x.score);
    for (const { id: toId, score } of scored.slice(0, SEMANTIC_TOP_K_PER_NODE)) {
      const [lo, hi] = a.id < toId ? [a.id, toId] : [toId, a.id];
      const key = `${lo}~${hi}:semantic`;
      if (edgeKey.has(key)) continue;
      // Skip if a structural edge already exists either direction
      if (
        edgeKey.has(`${a.id}->${toId}:import`) ||
        edgeKey.has(`${toId}->${a.id}:import`)
      ) {
        continue;
      }
      edgeKey.add(key);
      edges.push({ source: a.id, target: toId, type: "semantic", weight: score });
    }
  }

  const highlights = computeHighlights(nodes, edges);

  return { nodes, edges, highlights };
}

function classifyFile(
  path: string,
  name: string,
): { kind: GraphHighlight["kind"]; title: string; detail: string } | null {
  const lower = name.toLowerCase();

  if (lower === "schema.prisma") {
    return { kind: "config", title: "Prisma schema", detail: "Database source of truth — models and relations live here" };
  }
  if (lower === "package.json") {
    return { kind: "config", title: "Package manifest", detail: "Dependencies, scripts, and workspace configuration" };
  }
  if (lower === "tsconfig.json" || lower.startsWith("tsconfig.")) {
    return { kind: "config", title: "TypeScript config", detail: "Compiler options and path aliases" };
  }
  if (lower === "next.config.js" || lower === "next.config.ts" || lower === "next.config.mjs") {
    return { kind: "config", title: "Next.js config", detail: "Framework-level runtime and build configuration" };
  }
  if (/\.(config|conf)\.(t|j|mj|cj)s$/.test(lower) || lower.endsWith(".config.json")) {
    return { kind: "config", title: name, detail: "Tooling configuration" };
  }
  if (lower === "middleware.ts" || lower === "middleware.js") {
    return { kind: "entrypoint", title: "Next.js middleware", detail: "Runs on every matching request before the route handler" };
  }
  if (lower === "route.ts" || lower === "route.js") {
    return { kind: "entrypoint", title: `Route · ${prettyRoute(path)}`, detail: "Next.js API route handler" };
  }
  if (lower === "page.tsx" || lower === "page.jsx" || lower === "page.ts" || lower === "page.js") {
    return { kind: "entrypoint", title: `Page · ${prettyRoute(path)}`, detail: "Next.js app-router page" };
  }
  if (lower === "layout.tsx" || lower === "layout.jsx") {
    return { kind: "entrypoint", title: `Layout · ${prettyRoute(path)}`, detail: "Next.js layout wrapping nested routes" };
  }
  if (/^index\.(t|j)sx?$/.test(lower) || /^main\.(t|j)sx?$/.test(lower) || /^app\.(t|j)sx?$/.test(lower)) {
    return { kind: "entrypoint", title: name, detail: "Module entry point" };
  }
  return null;
}

function prettyRoute(path: string): string {
  // Extract Next.js route from app-router paths
  const idx = path.lastIndexOf("/app/");
  if (idx === -1) return path;
  const after = path.slice(idx + 5);
  const withoutFile = after.replace(/\/(page|route|layout)\.[a-z]+$/, "");
  const cleaned = withoutFile
    .split("/")
    .filter((s) => !s.startsWith("(") || !s.endsWith(")"))
    .join("/");
  return "/" + cleaned;
}

function computeHighlights(
  nodes: GraphNode[],
  edges: GraphEdge[],
): GraphHighlight[] {
  const inDeg = new Map<string, number>();
  const outDeg = new Map<string, number>();
  for (const e of edges) {
    if (e.type !== "import") continue;
    const src = typeof e.source === "string" ? e.source : (e.source as { id: string }).id;
    const tgt = typeof e.target === "string" ? e.target : (e.target as { id: string }).id;
    inDeg.set(tgt, (inDeg.get(tgt) ?? 0) + 1);
    outDeg.set(src, (outDeg.get(src) ?? 0) + 1);
  }

  const byPath = new Map(nodes.map((n) => [n.id, n]));
  const maxChunks = Math.max(1, ...nodes.map((n) => n.chunks));

  type Candidate = {
    node: GraphNode;
    kind: GraphHighlight["kind"];
    title: string;
    description: string;
    score: number;
  };

  const candidates: Candidate[] = [];

  for (const node of nodes) {
    const classified = classifyFile(node.path, node.name);
    const inCount = inDeg.get(node.id) ?? 0;

    if (classified) {
      const usedBy = inCount > 0 ? ` · imported by ${inCount} file${inCount === 1 ? "" : "s"}` : "";
      candidates.push({
        node,
        kind: classified.kind,
        title: classified.title,
        description: `${node.path}${usedBy} — ${classified.detail}`,
        score:
          (classified.kind === "entrypoint" ? 80 : 70) +
          inCount * 3 +
          (node.chunks / maxChunks) * 5,
      });
      continue;
    }

    if (inCount >= 3) {
      candidates.push({
        node,
        kind: "hub",
        title: node.name,
        description: `${node.path} — shared module imported by ${inCount} file${inCount === 1 ? "" : "s"}`,
        score: 40 + inCount * 4,
      });
      continue;
    }
  }

  // Add "large" candidates for files that aren't already in (top by chunks, not already selected)
  const selected = new Set(candidates.map((c) => c.node.id));
  const largeCandidates = [...nodes]
    .filter((n) => !selected.has(n.id) && n.chunks >= 3)
    .sort((a, b) => b.chunks - a.chunks)
    .slice(0, 5)
    .map((node) => ({
      node,
      kind: "large" as const,
      title: node.name,
      description: `${node.path} — sizable module (${node.chunks} chunks, ~${node.lines} lines)`,
      score: 20 + node.chunks,
    }));
  candidates.push(...largeCandidates);

  candidates.sort((a, b) => b.score - a.score);

  // Dedup, keep top 12, also ensure we don't have overlapping ids
  const seen = new Set<string>();
  const top: Candidate[] = [];
  for (const c of candidates) {
    if (seen.has(c.node.id)) continue;
    seen.add(c.node.id);
    top.push(c);
    if (top.length >= 12) break;
  }

  // Touch byPath to keep it as a semantic reference if needed later
  void byPath;

  return top.map((c) => ({
    id: c.node.id,
    path: c.node.path,
    title: c.title,
    description: c.description,
    kind: c.kind,
    score: Math.round(c.score * 10) / 10,
  }));
}
