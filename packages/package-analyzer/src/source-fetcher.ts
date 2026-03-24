/**
 * Fetch source code of an npm package for deep-dive analysis.
 * Uses unpkg.com CDN to browse package files without downloading tarballs.
 */

const UNPKG = "https://unpkg.com";
const MAX_FILE_SIZE = 50_000; // 50KB per file
const MAX_TOTAL_SIZE = 150_000; // 150KB total

export interface PackageSourceFile {
  path: string;
  content: string;
  size: number;
}

export interface PackageSource {
  name: string;
  version: string;
  files: PackageSourceFile[];
  packageJson: Record<string, any>;
  totalSize: number;
  truncated: boolean;
}

/**
 * Fetch key source files from a published npm package.
 * Prioritizes: package.json, install scripts, main entry, index files.
 */
export async function fetchPackageSource(
  name: string,
  version?: string,
): Promise<PackageSource> {
  const tag = version ?? "latest";
  const result: PackageSource = {
    name,
    version: tag,
    files: [],
    packageJson: {},
    totalSize: 0,
    truncated: false,
  };

  // 1. Fetch package.json
  const pkgJsonContent = await fetchFile(`${UNPKG}/${name}@${tag}/package.json`);
  if (!pkgJsonContent) {
    throw new Error(`Could not fetch package.json for ${name}@${tag}`);
  }

  result.files.push({ path: "package.json", content: pkgJsonContent, size: pkgJsonContent.length });
  result.totalSize += pkgJsonContent.length;

  try {
    result.packageJson = JSON.parse(pkgJsonContent);
  } catch {
    return result;
  }

  const pkg = result.packageJson;

  // 2. Determine files to fetch (prioritized)
  const filesToFetch = new Set<string>();

  // Main entry points
  if (pkg.main) filesToFetch.add(pkg.main);
  if (pkg.module) filesToFetch.add(pkg.module);
  if (pkg.exports) {
    // Handle string exports
    if (typeof pkg.exports === "string") {
      filesToFetch.add(pkg.exports);
    } else if (typeof pkg.exports === "object") {
      // Handle object exports (e.g., { ".": { "import": "./index.mjs" } })
      for (const val of Object.values(pkg.exports)) {
        if (typeof val === "string") filesToFetch.add(val);
        else if (typeof val === "object" && val) {
          for (const v of Object.values(val as Record<string, string>)) {
            if (typeof v === "string") filesToFetch.add(v);
          }
        }
      }
    }
  }

  // Common entry points
  filesToFetch.add("index.js");
  filesToFetch.add("index.mjs");
  filesToFetch.add("index.cjs");
  filesToFetch.add("lib/index.js");
  filesToFetch.add("dist/index.js");
  filesToFetch.add("src/index.js");
  filesToFetch.add("src/index.ts");

  // Install scripts files (most critical for malware)
  const scripts = pkg.scripts ?? {};
  for (const key of ["preinstall", "postinstall", "prepare", "preuninstall"]) {
    const cmd = scripts[key];
    if (!cmd) continue;
    // Extract file paths from scripts like "node malicious.js" or "sh setup.sh"
    const fileMatch = cmd.match(/(?:node|sh|bash|tsx?|npx)\s+([^\s;|&]+)/);
    if (fileMatch?.[1]) filesToFetch.add(fileMatch[1]);
  }

  // 3. Fetch files (skip package.json, already fetched)
  filesToFetch.delete("package.json");

  for (const filePath of filesToFetch) {
    if (result.totalSize >= MAX_TOTAL_SIZE) {
      result.truncated = true;
      break;
    }

    const cleaned = filePath.replace(/^\.\//, "");
    const content = await fetchFile(`${UNPKG}/${name}@${tag}/${cleaned}`);
    if (content && content.length <= MAX_FILE_SIZE) {
      result.files.push({ path: cleaned, content, size: content.length });
      result.totalSize += content.length;
    }
  }

  // Resolve version from package.json
  if (pkg.version) result.version = pkg.version;

  return result;
}

async function fetchFile(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url, { redirect: "follow" });
    if (!resp.ok) return null;
    const contentType = resp.headers.get("content-type") ?? "";
    // Skip binary files
    if (contentType.includes("image") || contentType.includes("octet-stream")) return null;
    return await resp.text();
  } catch {
    return null;
  }
}
