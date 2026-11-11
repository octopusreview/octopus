import type { AiCreateParams, AiResponse } from "@/lib/providers";
import type { AiRequestReceipt } from "@/lib/providers/request-evidence";
import { sha256, type ReviewCoverage } from "@/lib/review-coverage";
import { parseRecoveryFindingsSet, recoveryFindingsBody } from "@/lib/review-evidence";
import { parseFindingsFromJson, type InlineFinding } from "@/lib/review-dedup";
import { CapacityAdmissionError, markCapacityNotDispatched, admitGenerationRetry, withinReviewWindow, COMPLETE_REVIEW_POLICY, GENERATION_RETRY, type CapacityAdmissionReceipt, type ReviewExecutionWindow } from "./review-capacity";
import { AiProviderFailure, classifyFailure, safeErrorDetails, type FailureClass, type KeyOwner } from "./provider-failure";

export type FindingsRecoveryEvidence = {
  state: "completed" | "incomplete" | "failed";
  reason: string;
  model: string;
  responseModel: string | null;
  responseProvider: AiResponse["provider"] | null;
  policySha256: string;
  templateSha256: string;
  requests: AiRequestReceipt[];
  responseSha256: string | null;
  completion: AiResponse["completion"] | null;
};

export type ReviewAssessment = {
  capacityAdmission?: CapacityAdmissionReceipt;
  failure?: { stage: "generation"; keyOwner: KeyOwner; status?: number } & FailureClass;
  /** Earlier failed generation attempts, oldest first; the fields beside this describe the final attempt. */
  attempts?: Array<{ failure: NonNullable<ReviewAssessment["failure"]>; requests: AiRequestReceipt[]; capacityAdmission?: CapacityAdmissionReceipt }>;
  state: "completed" | "incomplete" | "not-required";
  reason: string;
  model: string | null;
  policySha256: string;
  templateSha256: string;
  requests: AiRequestReceipt[];
  responseSha256: string | null;
  completion: AiResponse["completion"] | null;
  /** Response syntax is independent of input coverage and provider completion. */
  responseValidation?: { state: "valid" | "invalid"; reason: string | null; scoreStructure?: ReturnType<typeof scoreStructure> };
  /** Supplemental extraction evidence; never repairs the primary assessment. */
  recoveries?: FindingsRecoveryEvidence[];
};

const FINDINGS_RECOVERY_TEMPLATE = `You previously wrote this code review but {{missingDescription}}. The Findings Summary table shows {{total}} total findings.

Here is the review you wrote:
{{reviewBody}}

Now output ONLY the {{missingRequest}} as a JSON array. Each finding must have this exact structure:

[
  {
    "severity": "🔴",
    "title": "Issue title",
    "filePath": "path/to/file.ts",
    "startLine": 42,
    "endLine": 58,
    "category": "Bug",
    "description": "Clear explanation of the issue",
    "suggestion": "suggested fix code or empty string",
    "confidence": 85
  }
]

Rules:
- severity: one of 🔴 🟠 🟡 🔵 💡
- filePath: relative path only, no backticks, no :L suffix
- startLine/endLine: integers
- confidence: integer 0-100 (90-100 = certain, 70-89 = clear, 50-69 = likely, below 50 = do not include)
- Output ONLY valid JSON array. No markdown, no explanation, no code fences.`;

/** Record the existing extraction call separately from source assessment. */
export async function executeFindingsRecovery(
  input: { model: string; reviewBody: string; parsedFindingsCount: number; tableFindingsTotal: number },
  coverage: ReviewCoverage,
  call: (request: AiCreateParams) => Promise<AiResponse>,
): Promise<AiResponse & { findings: InlineFinding[] | null }> {
  const assessment = coverage.assessment;
  if (!assessment) throw new Error("Primary review assessment unavailable for findings recovery");
  const { model, reviewBody, parsedFindingsCount, tableFindingsTotal } = input;
  const values: Record<string, string> = {
    missingDescription: parsedFindingsCount === 0 ? "omitted the findings block" : `only included ${parsedFindingsCount} of ${tableFindingsTotal} findings`,
    total: String(tableFindingsTotal),
    reviewBody,
    missingRequest: parsedFindingsCount === 0 ? "missing findings" : `${tableFindingsTotal - parsedFindingsCount} missing finding(s)`,
  };
  // One replacement pass leaves placeholder-like text in the supplied review intact.
  const content = FINDINGS_RECOVERY_TEMPLATE.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key]);
  const evidence: FindingsRecoveryEvidence = {
    state: "incomplete", reason: "Provider did not return a completed findings recovery", model,
    responseModel: null, responseProvider: null,
    policySha256: sha256(JSON.stringify({ policy: "findings-recovery-v1", primaryPolicySha256: assessment.policySha256,
      primaryTemplateSha256: assessment.templateSha256, primaryResponseSha256: assessment.responseSha256 })),
    templateSha256: sha256(FINDINGS_RECOVERY_TEMPLATE), requests: [], responseSha256: null, completion: null,
  };
  (assessment.recoveries ??= []).push(evidence);
  let response: AiResponse;
  try {
    response = await call({ model, maxTokens: 4096, messages: [{ role: "user", content }], onRequest: receipt => evidence.requests.push(receipt) });
  } catch (error) {
    evidence.state = "failed";
    evidence.reason = "Findings recovery failed or was interrupted";
    throw error;
  }
  evidence.responseSha256 = sha256(response.text);
  evidence.responseModel = response.model;
  evidence.responseProvider = response.provider;
  evidence.completion = response.completion ?? null;
  const observed = evidence.requests.length === 1 && evidence.requests[0].model === response.model
    && evidence.requests[0].provider === response.provider && evidence.requests[0].inputPreserved;
  evidence.state = observed && response.completion?.state === "completed" ? "completed" : "incomplete";
  evidence.reason = !observed ? "Actual findings recovery request provenance unavailable"
    : response.completion?.state !== "completed" ? "Findings recovery completion incomplete or unknown"
      : "Provider completed the findings recovery response; source assessment unchanged";
  const body = recoveryFindingsBody(response.text);
  const valid = parseRecoveryFindingsSet(response.text) !== null;
  if (!valid) {
    const reason = "Findings recovery JSON set is malformed";
    evidence.state = "incomplete";
    evidence.reason = `${evidence.reason}; ${reason}`;
    markReviewAssessmentIncomplete(coverage, `${assessment.reason}; ${reason}`);
  }
  return { ...response, findings: valid ? parseFindingsFromJson(body) ?? [] : null };
}

const REVIEW_HEADING = "## 🐙 Octopus Review";

const SCORE_CATEGORIES = ["Security", "Code Quality", "Performance", "Error Handling", "Consistency", "Overall"] as const;

// Only unescaped pipes separate Markdown cells; an even backslash run leaves a delimiter.
function scoreCells(line: string): string[] {
  const cells: string[] = []; let start = 0; let slashes = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "|" && slashes % 2 === 0) { cells.push(line.slice(start, i)); start = i + 1; }
    slashes = line[i] === "\\" ? slashes + 1 : 0;
  }
  cells.push(line.slice(start)); return cells;
}
function scoreSection(text: string): string {
  return /^### Score[ \t]*\r?\n([\s\S]*?)(?=^#{1,6} |(?![\s\S]))/m.exec(text)?.[1] ?? "";
}
/** Fixed enums and capped counts only; never retain response text or score values. */
function scoreStructure(text: string) {
  const lines = scoreSection(normalizeReviewResponse(text)).split("\n").map(scoreCells);
  return SCORE_CATEGORIES.map(category => {
    const rows = lines.filter(cells => cells[1]?.trim().replaceAll("**", "") === category);
    const token = rows[0]?.[2]?.trim().replaceAll("**", "");
    return { category, rows: Math.min(rows.length, 2), cells: Math.min(rows[0]?.length ?? 0, 6),
      token: token === undefined ? "missing" : /^(?:[1-5]\/5|N\/A|Not assessed)$/.test(token) ? "recognized" : "invalid" };
  });
}

/**
 * Canonicalize presentation shapes that models vary without changing the meaning of the
 * review, so validation judges structure rather than typography: a suffix on
 * the report heading (`## 🐙 Octopus Review — PR #12`) and an Overall row whose
 * two cells are not both bold, and horizontal spacing around score slashes.
 */
export function normalizeReviewResponse(text: string): string {
  return text
    .replace(/(^### Score[ \t]*\r?\n)([\s\S]*?)(?=^#{1,6} |(?![\s\S]))/gm, (_section, heading: string, body: string) => heading + body.split("\n").map(line => {
      const cells = scoreCells(line);
      if (cells.length !== 5 || !SCORE_CATEGORIES.some(category => cells[1].trim().replaceAll("**", "") === category)) return line;
      cells[2] = cells[2].replace(/^(\s*(?:\*\*)?)([1-5])[ \t]*\/[ \t]*5((?:\*\*)?\s*)$/, "$1$2/5$3");
      return cells.join("|");
    }).join("\n"))
    .replace(/^## 🐙 Octopus Review\b[^\n]*$/gm, REVIEW_HEADING)
    .replace(/^\|\s*(?:\*\*)?Overall(?:\*\*)?\s*\|\s*(?:\*\*)?([1-5]\/5|N\/A|Not assessed)(?:\*\*)?\s*\|([^\n]*)$/gm, "| **Overall** | **$1** |$2");
}

/** Fixed diagnostic messages only: never include untrusted response excerpts. */
export function reviewResponseValidationError(text: string, inputComplete = true): string | null {
  text = normalizeReviewResponse(text);
  if ((text.match(/^## 🐙 Octopus Review[ \t]*\r?$/gm) ?? []).length !== 1
    || (text.match(/^### Score[ \t]*\r?$/gm) ?? []).length !== 1
    || (text.match(/^### Summary[ \t]*\r?$/gm) ?? []).length !== 1
    || !/^### Summary[ \t]*\r?\n\s*\S/m.test(text)) return "Review headings missing or duplicated";
  const score = scoreSection(text);
  if ((score.match(/^\|[ \t]*Category[ \t]*\|[ \t]*Score[ \t]*\|[ \t]*Notes[ \t]*\|[ \t]*\r?$/gm) ?? []).length !== 1) return "Score table header missing or duplicated";
  for (const category of ["Security", "Code Quality", "Performance", "Error Handling", "Consistency"]) {
    const rows = score.split("\n").filter(line => scoreCells(line)[1]?.trim().replaceAll("**", "") === category);
    if (rows.length !== 1 || scoreCells(rows[0]).length !== 5
      || !(inputComplete ? /^(?:[1-5]\/5|N\/A)$/ : /^N\/A$/).test(scoreCells(rows[0])[2].trim().replaceAll("**", ""))) return "Score category rows missing, duplicated or malformed";
  }
  // Only a row whose first cell is Overall counts: a notes cell that contains the
  // word ("consistent overall") is not a second Overall row.
  const overall = score.split("\n").filter(line => scoreCells(line)[1]?.trim().replaceAll("**", "") === "Overall");
  const cells = overall.length === 1 ? scoreCells(overall[0]) : [];
  const overallScore = inputComplete ? /^\*\*[1-5]\/5\*\*$/ : /^\*\*Not assessed\*\*$/;
  if (cells.length !== 5 || cells[0].trim() !== "" || cells[4].trim() !== ""
    || cells[1].trim() !== "**Overall**" || !overallScore.test(cells[2].trim()) || !cells[3]) return inputComplete
    ? "Overall score missing, duplicated or malformed"
    : "Incomplete-input Overall must be exactly Not assessed, with no duplicate row";
  return reviewFindingsValidationError(text);
}

export function validReviewResponse(text: string): boolean {
  return reviewResponseValidationError(text) === null;
}

function reviewFindingsValidationError(text: string): string | null {
  const matches = [...text.matchAll(/<!-- OCTOPUS_FINDINGS_START -->\s*([\s\S]*?)\s*<!-- OCTOPUS_FINDINGS_END -->/g)];
  if (matches.length !== 1
    || text.split("<!-- OCTOPUS_FINDINGS_START -->").length !== 2
    || text.split("<!-- OCTOPUS_FINDINGS_END -->").length !== 2) return "Findings JSON markers missing or duplicated";
  let findings: unknown;
  try {
    const block = matches[0][1].trim();
    const fenced = /^```json[ \t]*\r?\n([\s\S]*?)\r?\n```$/.exec(block);
    findings = JSON.parse(fenced ? fenced[1] : block);
  } catch { return "Findings JSON is malformed"; }
  if (!Array.isArray(findings)
    || (findings.length > 0 && parseFindingsFromJson(text)?.length !== findings.length)) return "Findings JSON entries are malformed";
  const severities = ["🔴", "🟠", "🟡", "🔵", "💡"];
  if (findings.some(finding => !finding || !severities.includes(finding.severity)
    || !Number.isInteger(finding.startLine) || finding.startLine < 1)) return "Findings JSON severity or location is invalid";
  // Count headings and table headers outside JSON so another section cannot hide
  // a second summary table. The table itself ends before a standalone advisory.
  const presentation = text.replace(matches[0][0], "");
  const summaries = [...text.matchAll(/^### Findings Summary[ \t]*\r?\n([\s\S]*?)(?=^#{1,6} |<!-- OCTOPUS_FINDINGS_START -->|(?![\s\S]))/gm)];
  if (summaries.length !== 1
    || (presentation.match(/^[ \t]*#{1,6}[ \t]+Findings Summary[ \t]*\r?$/gm) ?? []).length !== 1) return "Findings Summary heading missing or duplicated";
  const lines = summaries[0][1].trim().split("\n").map(line => line.trim());
  const header = /^[ \t]*\|[ \t]*Severity[ \t]*\|[ \t]*Count[ \t]*\|[ \t]*\r?$/gm;
  if ((presentation.match(header) ?? []).length !== 1
    || !/^\|\s*Severity\s*\|\s*Count\s*\|$/.test(lines[0] ?? "")
    || !/^\|\s*:?-{3,}:?\s*\|\s*:?-{3,}:?\s*\|$/.test(lines[1] ?? "")) return "Findings Summary table header missing, duplicated or malformed";
  const counts = new Map<string, number>();
  let end = 2;
  for (; end < lines.length && lines[end].startsWith("|"); end++) {
    const row = /^\|\s*(🔴|🟠|🟡|🔵|💡)[^|]*\|\s*(\d+)\s*\|$/.exec(lines[end]);
    if (!row || counts.has(row[1]) || !Number.isSafeInteger(Number(row[2]))) return "Findings Summary severity rows duplicated or malformed";
    counts.set(row[1], Number(row[2]));
  }
  const advisory = lines.slice(end).filter(Boolean);
  // Compatibility with the documented Conflict Risk blockquote, including its
  // wrapped continuation. Arbitrary prose, another advisory or table is invalid.
  if (advisory.length && (!/^>\s*⚠️\s+\*\*Conflict Risk\*\*:\s+\S/.test(advisory[0])
    || advisory.some((line, index) => line.includes("|") || (index > 0
      && (!/^>\s+[^>#\s]/.test(line) || line.includes("**Conflict Risk**:")))))) return "Unexpected content after Findings Summary table";
  return severities.every(severity => (counts.get(severity) ?? 0) === findings.filter(finding => finding.severity === severity).length)
    ? null : "Findings Summary counts do not match findings JSON";
}

export function validReviewFindings(text: string): boolean {
  return reviewFindingsValidationError(text) === null;
}

/** Invalidating an assessment must never rewrite what input was supplied. */
export function markReviewAssessmentIncomplete(coverage: ReviewCoverage, reason: string): void {
  if (!coverage.assessment) return;
  coverage.assessment.state = "incomplete";
  coverage.assessment.reason = reason;
}

export function recordNoModelAssessment(coverage: ReviewCoverage): void {
  const excludedOnly = coverage.inventoryComplete && coverage.files.length > 0
    && coverage.files.every(file => file.state === "excluded");
  coverage.assessment = {
    state: excludedOnly ? "not-required" : "incomplete",
    reason: excludedOnly ? "All changed paths explicitly excluded by policy; no model assessment performed" : "No eligible changed input available for assessment",
    model: null, policySha256: sha256(JSON.stringify(coverage)), templateSha256: sha256("no-model-v1"),
    requests: [], responseSha256: null, completion: null,
  };
}

/** The caller persists assessment evidence without response text alongside the final outcome. */
export async function executeCoveredReview(
  request: AiCreateParams, coverage: ReviewCoverage, template: string,
  call: (request: AiCreateParams) => Promise<AiResponse>,
  /** Absent: never retry. `confirm` runs immediately before the second dispatch and must recheck everything. */
  retry?: { window: ReviewExecutionWindow | undefined; confirm: (failure: AiProviderFailure, signal: AbortSignal) => Promise<boolean> },
): Promise<AiResponse> {
  const assessment: ReviewAssessment = {
    state: "incomplete", reason: "Provider did not return a completed assessment", model: request.model,
    policySha256: sha256(JSON.stringify({ policy: "bounded-review-assessment-v2", coverage })),
    templateSha256: sha256(template), requests: [], responseSha256: null, completion: null,
  };
  coverage.assessment = assessment;
  let response: AiResponse;
  const dispatch = () => call({ ...request, onRequest: receipt => assessment.requests.push(receipt),
    ...(request.completeReviewAdmission ? { completeReviewAdmission: { ...request.completeReviewAdmission,
      onDecision: receipt => { assessment.capacityAdmission = receipt; request.completeReviewAdmission?.onDecision?.(receipt); },
    } } : {}),
  });
  let first: { error: unknown; reason: string; attempt: NonNullable<ReviewAssessment["attempts"]>[number] } | undefined;
  for (;;) try {
    // The admitted path bounds itself; any other retry is held to the original job window here.
    response = first && retry?.window && !request.completeReviewAdmission
      ? await withinReviewWindow(retry.window, retry.window.remainingMs() - COMPLETE_REVIEW_POLICY.publicationReserveMs, dispatch) : await dispatch();
    break;
  } catch (error) {
    if (first && error instanceof CapacityAdmissionError && error.receipt.primaryDispatch === "not-started" && assessment.requests.length === 0) {
      // The retry was refused before dispatch: the original classified failure stands.
      delete assessment.attempts; delete assessment.capacityAdmission;
      Object.assign(assessment, first.attempt, { reason: first.reason });
      throw first.error;
    }
    if (error instanceof CapacityAdmissionError) {
      assessment.capacityAdmission = structuredClone(error.receipt);
      assessment.reason = error.message;
      if (error.receipt.primaryDispatch === "not-started" && assessment.requests.length === 0) markCapacityNotDispatched(coverage);
    } else {
      assessment.reason = "Provider request failed or was interrupted";
      const signal = request.completeReviewAdmission?.window.signal ?? request.executionWindow?.signal;
      if (error instanceof AiProviderFailure && !signal?.aborted) {
        try {
          const details = safeErrorDetails(error.details);
          if (details.name !== "AbortError") {
            const keyOwner = error.keyOwner === "platform" || error.keyOwner === "organization" ? error.keyOwner : "unknown";
            assessment.failure = { stage: "generation", ...classifyFailure(details, keyOwner, "generation"), keyOwner, ...(details.status ? { status: details.status } : {}) };
            assessment.reason = "Provider request failed during review generation";
          }
        } catch { /* Preserve the original failure if diagnostics are unavailable. */ }
      }
    }
    const failure = assessment.failure;
    // One retry, only for a classified transient provider failure; unknown causes are never retried.
    if (!first && retry && failure?.retryability === "transient" && error instanceof AiProviderFailure
      && await admitGenerationRetry(retry.window, request.completeReviewAdmission ? COMPLETE_REVIEW_POLICY.minGenerationMs : GENERATION_RETRY.minGenerationMs,
        failure.status === 429 && failure.keyOwner === "platform" ? error.retryAfterMs : undefined, signal => retry.confirm(error, signal))) {
      first = { error, reason: assessment.reason, attempt: { failure, requests: assessment.requests, ...(assessment.capacityAdmission ? { capacityAdmission: assessment.capacityAdmission } : {}) } };
      assessment.attempts = [first.attempt];
      delete assessment.failure; delete assessment.capacityAdmission;
      assessment.requests = []; assessment.reason = "Provider did not return a completed assessment";
      continue;
    }
    throw error;
  }
  assessment.responseSha256 = sha256(response.text);
  assessment.completion = response.completion ?? null;
  const validationError = reviewResponseValidationError(response.text, coverage.complete);
  assessment.responseValidation = { state: validationError === null ? "valid" : "invalid", reason: validationError, ...(validationError !== null ? { scoreStructure: scoreStructure(response.text) } : {}) };
  if (validationError !== null) console.log(`[review-assessment] Response rejected: ${validationError}; completion=${response.completion?.reason ?? "unknown"}`);
  const observed = assessment.requests.length === 1 && assessment.requests[0].model === response.model
    && assessment.requests[0].provider === response.provider && assessment.requests[0].inputPreserved;
  const failures = [
    ...(!observed ? ["Actual provider request provenance unavailable"] : []),
    ...(validationError !== null ? [validationError] : []),
    ...(response.completion?.state !== "completed" ? ["Provider completion incomplete or unknown"] : []),
  ];
  assessment.state = failures.length === 0 ? "completed" : "incomplete";
  assessment.reason = failures.length > 0 ? failures.join("; ")
    : coverage.complete ? "Provider completed a valid review response"
      : "Provider completed a valid response; overall score withheld because input coverage is incomplete";
  return { ...response, text: normalizeReviewResponse(response.text) };
}
