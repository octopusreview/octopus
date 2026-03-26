/**
 * Reads all .md files in public/skills/, extracts frontmatter metadata,
 * computes a SHA-256 hash for each, and writes public/skills/skills.json.
 *
 * Run: bun run scripts/generate-skills-json.ts
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";

const SKILLS_DIR = join(import.meta.dirname, "../public/skills");
const OUTPUT = join(SKILLS_DIR, "skills.json");
const VERSION = 1;

interface SkillEntry {
  name: string;
  title: string;
  description: string;
  filename: string;
  hash: string;
}

function parseFrontmatter(content: string) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const lines = match[1].split("\n");
  const meta: Record<string, string> = {};
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return meta;
}

function titleFromName(name: string) {
  return name
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

async function main() {
  const files = (await readdir(SKILLS_DIR)).filter(
    (f) => f.endsWith(".md") && f !== "README.md",
  );
  files.sort();

  const skills: SkillEntry[] = [];

  for (const filename of files) {
    const content = await readFile(join(SKILLS_DIR, filename), "utf-8");
    const hash = createHash("sha256").update(content).digest("hex");
    const meta = parseFrontmatter(content);
    const name = filename.replace(/\.md$/, "");

    skills.push({
      name,
      title: meta.title || titleFromName(name),
      description: meta.description || "",
      filename,
      hash,
    });
  }

  const output = { version: VERSION, skills };
  await writeFile(OUTPUT, JSON.stringify(output, null, 2) + "\n");

  console.log(`Generated skills.json v${VERSION} with ${skills.length} skills`);
  for (const s of skills) {
    console.log(`  ${s.name} (${s.hash.slice(0, 8)}...)`);
  }
}

main();
