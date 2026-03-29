/**
 * HTML report generator for the review lifecycle simulator.
 * Produces a standalone HTML file with embedded CSS — no external dependencies.
 */

import type { PrMeta, TriggerPoint } from "./review-simulator-github";
import type { InlineFinding, PriorFinding } from "@/lib/review-dedup";

// ─── Types ───────────────────────────────────────────────────────────────────

export type SimulationResult = {
  trigger: TriggerPoint;
  diffFileCount: number;
  diffLineCount: number;
  // Actual octopus output
  actualFindings: PriorFinding[];
  actualReviewBody?: string;
  // Simulated output (from LLM call)
  simulatedFindings: InlineFinding[];
  simulatedRawCount: number;
  // Dedup results
  dedupKept: InlineFinding[];
  dedupRemoved: InlineFinding[];
  // Timing
  llmDurationMs?: number;
  skippedLlm: boolean;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// ─── Report Generation ───────────────────────────────────────────────────────

export function generateReport(results: SimulationResult[], meta: PrMeta, mode: string): string {
  const totalActual = results.reduce((s, r) => s + r.actualFindings.length, 0);
  const totalSimulated = results.reduce((s, r) => s + r.simulatedRawCount, 0);
  const totalDeduped = results.reduce((s, r) => s + r.dedupRemoved.length, 0);
  const totalKept = results.reduce((s, r) => s + r.dedupKept.length, 0);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Review Simulation — ${esc(meta.repo)} #${meta.number}</title>
<style>
  :root {
    --bg: #0d1117; --surface: #161b22; --border: #30363d;
    --text: #e6edf3; --text-muted: #8b949e; --accent: #2dd4bf;
    --red: #ef4444; --orange: #f97316; --yellow: #eab308;
    --blue: #3b82f6; --purple: #8b5cf6; --green: #22c55e;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    background: var(--bg); color: var(--text); line-height: 1.6; padding: 2rem; max-width: 1200px; margin: 0 auto; }
  h1 { font-size: 1.5rem; color: var(--accent); margin-bottom: 0.25rem; }
  h2 { font-size: 1.2rem; margin: 2rem 0 1rem; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; }
  h3 { font-size: 1rem; margin: 1.5rem 0 0.75rem; }
  a { color: var(--accent); text-decoration: none; }
  .meta { color: var(--text-muted); font-size: 0.85rem; margin-bottom: 2rem; }
  .meta span { margin-right: 1.5rem; }

  /* Summary cards */
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin: 1rem 0; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; text-align: center; }
  .card .number { font-size: 2rem; font-weight: 700; }
  .card .label { color: var(--text-muted); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; }
  .card.green .number { color: var(--green); }
  .card.red .number { color: var(--red); }
  .card.yellow .number { color: var(--yellow); }
  .card.accent .number { color: var(--accent); }

  /* Timeline */
  .timeline { position: relative; padding-left: 2rem; margin: 1rem 0; }
  .timeline::before { content: ''; position: absolute; left: 0.6rem; top: 0; bottom: 0; width: 2px; background: var(--border); }
  .trigger { position: relative; margin-bottom: 1.5rem; }
  .trigger::before { content: ''; position: absolute; left: -1.65rem; top: 0.35rem; width: 12px; height: 12px;
    border-radius: 50%; background: var(--accent); border: 2px solid var(--bg); }
  .trigger.first::before { background: var(--green); }
  .trigger-header { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
  .badge { font-size: 0.7rem; padding: 0.15rem 0.5rem; border-radius: 999px; font-weight: 600; text-transform: uppercase; }
  .badge.opened { background: rgba(34,197,94,0.15); color: var(--green); }
  .badge.mention { background: rgba(45,212,191,0.15); color: var(--accent); }
  .sha { font-family: monospace; font-size: 0.8rem; color: var(--text-muted); }
  .date { font-size: 0.8rem; color: var(--text-muted); }
  .stats { font-size: 0.8rem; color: var(--text-muted); }

  /* Tables */
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; margin: 0.5rem 0; }
  th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border); }
  th { color: var(--text-muted); font-weight: 600; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; }
  td.severity { width: 40px; text-align: center; font-size: 1.1rem; }
  td.file { font-family: monospace; font-size: 0.8rem; color: var(--text-muted); max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* Side-by-side */
  .comparison { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin: 1rem 0; }
  @media (max-width: 768px) { .comparison { grid-template-columns: 1fr; } }
  .panel { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; overflow-x: auto; }
  .panel h4 { font-size: 0.85rem; margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.5rem; }
  .panel h4 .count { background: var(--border); color: var(--text); padding: 0.1rem 0.5rem; border-radius: 999px; font-size: 0.75rem; }

  /* Dedup highlight */
  .dedup-section { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; margin: 1rem 0; }
  .dedup-section h4 { font-size: 0.85rem; margin-bottom: 0.5rem; color: var(--green); }
  tr.removed { background: rgba(239,68,68,0.08); }
  tr.removed td { color: var(--red); text-decoration: line-through; opacity: 0.7; }
  tr.kept td { color: var(--green); }

  /* Severity bars */
  .severity-bars { display: flex; gap: 0.5rem; margin: 1rem 0; flex-wrap: wrap; }
  .sev-bar { display: flex; align-items: center; gap: 0.35rem; font-size: 0.8rem; }
  .sev-dot { width: 10px; height: 10px; border-radius: 50%; }

  /* Details */
  details { margin: 0.5rem 0; }
  summary { cursor: pointer; color: var(--text-muted); font-size: 0.85rem; padding: 0.5rem 0; }
  details pre { background: var(--surface); border: 1px solid var(--border); border-radius: 4px;
    padding: 1rem; overflow-x: auto; font-size: 0.75rem; max-height: 300px; overflow-y: auto; margin-top: 0.5rem; }

  .empty { color: var(--text-muted); font-style: italic; padding: 1rem; text-align: center; }
  .footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--border);
    color: var(--text-muted); font-size: 0.75rem; text-align: center; }
</style>
</head>
<body>

<h1>Review Lifecycle Simulation</h1>
<div class="meta">
  <span><strong>PR:</strong> <a href="${esc(meta.url)}">${esc(meta.repo)} #${meta.number}</a></span>
  <span><strong>Title:</strong> ${esc(meta.title)}</span>
  <span><strong>Author:</strong> ${esc(meta.author)}</span>
  <span><strong>Mode:</strong> ${esc(mode)}</span>
  <span><strong>Generated:</strong> ${new Date().toISOString().split("T")[0]}</span>
</div>

<h2>Summary</h2>
<div class="cards">
  <div class="card accent"><div class="number">${results.length}</div><div class="label">Trigger Points</div></div>
  <div class="card yellow"><div class="number">${totalActual}</div><div class="label">Actual Findings</div></div>
  <div class="card accent"><div class="number">${totalSimulated}</div><div class="label">Simulated (Raw)</div></div>
  <div class="card green"><div class="number">${totalDeduped}</div><div class="label">Caught by Dedup</div></div>
  <div class="card"><div class="number">${totalKept}</div><div class="label">After Dedup</div></div>
</div>

<h2>Timeline</h2>
<div class="timeline">
${results.map((r) => {
  const isFirst = r.trigger.type === "pr_opened";
  return `  <div class="trigger${isFirst ? " first" : ""}">
    <div class="trigger-header">
      <span class="badge ${isFirst ? "opened" : "mention"}">${isFirst ? "PR Opened" : "@octopus"}</span>
      <span class="sha">${r.trigger.sha.slice(0, 7)}</span>
      <span class="date">${formatDate(r.trigger.timestamp)}</span>
      <span class="stats">${r.actualFindings.length} actual / ${r.simulatedRawCount} simulated / ${r.dedupRemoved.length} deduped</span>
    </div>
  </div>`;
}).join("\n")}
</div>

${results.map((r, idx) => renderTriggerDetail(r, idx, results.slice(0, idx))).join("\n")}

<div class="footer">
  Generated by Octopus Review Simulator
</div>

</body>
</html>`;
}

function renderTriggerDetail(result: SimulationResult, idx: number, _priorResults: SimulationResult[]): string {
  const t = result.trigger;
  const isFirst = t.type === "pr_opened";

  return `
<h2>Trigger #${idx + 1}: ${isFirst ? "PR Opened" : "@octopus"} <span class="sha" style="font-weight:normal">${t.sha.slice(0, 7)}</span></h2>
${t.userInstruction ? `<p style="color:var(--text-muted);font-size:0.85rem;">Instruction: <em>${esc(t.userInstruction)}</em></p>` : ""}
<p style="color:var(--text-muted);font-size:0.85rem;">${result.diffFileCount} files changed, ${result.diffLineCount} diff lines${result.llmDurationMs ? ` | LLM: ${(result.llmDurationMs / 1000).toFixed(1)}s` : ""}${result.skippedLlm ? " | LLM skipped (--skip-llm)" : ""}</p>

<div class="comparison">
  <div class="panel">
    <h4>Actual Findings <span class="count">${result.actualFindings.length}</span></h4>
    ${result.actualFindings.length > 0 ? `
    <table>
      <tr><th>Sev</th><th>File</th><th>Title</th></tr>
      ${result.actualFindings.map((f) => `
      <tr>
        <td class="severity">${findSeverityEmoji(f.title)}</td>
        <td class="file">${esc(f.filePath)}:${f.line}</td>
        <td>${esc(f.title.replace(/^(🔴|🟠|🟡|🔵|💡)\s*/, ""))}</td>
      </tr>`).join("")}
    </table>` : '<div class="empty">No findings</div>'}
  </div>

  <div class="panel">
    <h4>Simulated Findings <span class="count">${result.simulatedRawCount}</span></h4>
    ${result.simulatedFindings.length > 0 ? `
    <table>
      <tr><th>Sev</th><th>File</th><th>Title</th></tr>
      ${result.simulatedFindings.map((f) => `
      <tr>
        <td class="severity">${f.severity}</td>
        <td class="file">${esc(f.filePath)}:${f.startLine}</td>
        <td>${esc(f.title)}</td>
      </tr>`).join("")}
    </table>` : '<div class="empty">No findings (or LLM skipped)</div>'}
  </div>
</div>

${result.dedupRemoved.length > 0 ? `
<div class="dedup-section">
  <h4>Dedup Results — ${result.dedupRemoved.length} findings caught</h4>
  <table>
    <tr><th>Status</th><th>Sev</th><th>File</th><th>Title</th></tr>
    ${result.dedupRemoved.map((f) => `
    <tr class="removed">
      <td>REMOVED</td>
      <td class="severity">${f.severity}</td>
      <td class="file">${esc(f.filePath)}:${f.startLine}</td>
      <td>${esc(f.title)}</td>
    </tr>`).join("")}
    ${result.dedupKept.map((f) => `
    <tr class="kept">
      <td>KEPT</td>
      <td class="severity">${f.severity}</td>
      <td class="file">${esc(f.filePath)}:${f.startLine}</td>
      <td>${esc(f.title)}</td>
    </tr>`).join("")}
  </table>
</div>` : (idx > 0 ? '<div class="dedup-section"><h4>Dedup Results</h4><div class="empty">No duplicates detected</div></div>' : "")}

${result.actualReviewBody ? `
<details>
  <summary>Actual review body (${result.actualReviewBody.length} chars)</summary>
  <pre>${esc(result.actualReviewBody)}</pre>
</details>` : ""}`;
}

function findSeverityEmoji(title: string): string {
  const match = title.match(/^(🔴|🟠|🟡|🔵|💡)/);
  return match?.[1] ?? "?";
}
