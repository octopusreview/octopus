import React, { useMemo } from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  staticFile,
} from "remotion";

// ── Theme (matches Octopus website) ────────────────────
const C = {
  bg: "#0a0a0a",
  text: "#f0f0f0",
  textMuted: "#9ca3af",
  textDim: "#6b7280",
  accent: "#2dd4a0",     // teal — site's primary accent
  green: "#2dd4a0",
  orange: "#f59e0b",
  red: "#ef4444",
  cyan: "#2dd4a0",
  purple: "#a78bfa",
  pink: "#f472b6",
  codeBg: "#111111",
  codeBorder: "#1f1f1f",
  lineNum: "#3b3b3b",
};

// ── Code snippets per phase ────────────────────────────
const PHASES: {
  id: number;
  title: string;
  subtitle: string;
  description: string;
  color: string;
  code: string;
  language: string;
  filename: string;
}[] = [
  {
    id: 0,
    title: "Auto-Index",
    subtitle: "Repository Indexing",
    description: "On the first review, the engine clones the repo tree via API, splits code into 1500-char chunks with 200-char overlap, generates embeddings, and upserts everything into Qdrant's code_chunks collection.",
    color: C.accent,
    filename: "lib/indexer.ts",
    language: "typescript",
    code: `async function indexRepository(repo: Repository) {
  const tree = await fetchRepoTree(repo);
  const chunks = chunkCode(tree, {
    size: 1500, overlap: 200
  });

  const embeddings = await createEmbeddings(
    chunks.map(c => c.content)
  );

  await qdrant.upsert("code_chunks", {
    points: chunks.map((chunk, i) => ({
      id: generateId(),
      vector: embeddings[i],
      payload: {
        path: chunk.filePath,
        content: chunk.content,
        repoId: repo.id
      }
    }))
  });
}`,
  },
  {
    id: 1,
    title: "Feedback Sync",
    subtitle: "Learn from Past Reviews",
    description: "Fetches GitHub reactions and author replies from prior reviews. Emoji replies take a fast path; text replies are classified by Haiku as dismissed, accepted, or unclear. Patterns are embedded into Qdrant for future suppression.",
    color: "#34d9a8",
    filename: "lib/reviewer.ts",
    language: "typescript",
    code: `async function syncFeedback(prId: string) {
  // Sync GitHub reactions
  const reactions = await ghGetReactions(prId);
  for (const r of reactions) {
    await db.reviewIssue.update({
      where: { id: r.findingId },
      data: {
        feedback: r.type === "+1"
          ? "up" : "down"
      }
    });
  }

  // Classify text dismissals via LLM
  const replies = await ghGetBotReplies(prId);
  for (const reply of replies) {
    const verdict = await classifyFeedback(
      reply.body  // "dismissed" | "accepted"
    );
    await embedFeedbackPattern(reply, verdict);
  }
}`,
  },
  {
    id: 2,
    title: "Fetch & Prepare",
    subtitle: "Diff Processing",
    description: "Pulls the unified diff from the provider API, applies .octopusignore rules to filter noise, detects build artifacts like node_modules or dist, and merges the file tree with PR-added files.",
    color: "#5eead4",
    filename: "lib/review-helpers.ts",
    language: "typescript",
    code: `async function prepareDiff(pr: PullRequest) {
  const rawDiff = await ghGetPRDiff(pr);

  // Apply .octopusignore filters
  const ignoreRules = await fetchOctopusIgnore(
    pr.repoId
  );
  const filtered = applyIgnoreRules(
    rawDiff, ignoreRules
  );

  // Detect bad commits (node_modules, dist/)
  const warnings = detectBuildArtifacts(filtered);

  if (filtered.files.length === 0) {
    await postSkippedMessage(pr);
    return null;
  }

  return { diff: filtered, warnings };
}`,
  },
  {
    id: 3,
    title: "Semantic Search",
    subtitle: "Context Retrieval",
    description: "Embeds the first 8K chars of the diff, runs hybrid dense + BM25 search on Qdrant for code and knowledge chunks, then reranks with Cohere rerank-v3.5 keeping results above 0.25 score.",
    color: "#99f6e4",
    filename: "lib/qdrant.ts",
    language: "typescript",
    code: `async function searchContext(diff: string) {
  const query = diff.slice(0, 8000);
  const embedding = await embed(query);

  // Hybrid search: dense vectors + BM25
  const codeChunks = await qdrant.search(
    "code_chunks",
    { vector: embedding, limit: 50 }
  );

  const knowledgeChunks = await qdrant.search(
    "knowledge_chunks",
    { vector: embedding, limit: 25 }
  );

  // Rerank with Cohere
  const reranked = await cohere.rerank({
    model: "rerank-v3.5",
    query: diff.slice(0, 2000),
    documents: [...codeChunks, ...knowledgeChunks],
    topN: 15
  });

  return reranked.filter(r => r.score > 0.25);
}`,
  },
  {
    id: 4,
    title: "LLM Review",
    subtitle: "AI Code Analysis",
    description: "Builds a system prompt with codebase context, knowledge chunks, and false positive history. Sends the diff to Claude or GPT and parses structured JSON findings from the response.",
    color: C.accent,
    filename: "lib/reviewer.ts",
    language: "typescript",
    code: `const response = await createAiMessage({
  model: getReviewModel(repo, org),
  maxTokens: 8192,
  system: buildPrompt({
    codebaseContext: rerankedChunks,
    knowledgeContext: knowledgeChunks,
    fileTree: mergedTree,
    falsePositives: feedbackPatterns,
    prNumber: pr.number,
  }),
  cacheSystem: true,
  messages: [{
    role: "user",
    content: \`Review this PR:\\n<diff>\\n\${diff}\\n</diff>\`
  }]
}, orgId);

// Parse findings from JSON block
const findings = extractFindings(
  response,
  "<!-- OCTOPUS_FINDINGS_START -->"
);`,
  },
  {
    id: 5,
    title: "Filter & Dedup",
    subtitle: "Quality Control",
    description: "Multi-pass filtering: confidence threshold, disabled categories, semantic matching against known false positives (>0.85 similarity), optional two-pass LLM validation, and hard dedup for re-reviews.",
    color: "#2dd4a0",
    filename: "lib/review-dedup.ts",
    language: "typescript",
    code: `function filterFindings(
  findings: Finding[],
  config: ReviewConfig,
  feedback: FeedbackPattern[]
) {
  return findings
    // 1. Confidence threshold
    .filter(f => f.confidence >= config.threshold)
    // 2. Category filter
    .filter(f => !config.disabled.includes(f.category))
    // 3. Semantic feedback matching
    .filter(f => {
      const match = semanticMatch(f, feedback);
      return match.score < 0.85; // suppress FPs
    })
    // 4. Sort by severity, cap at max
    .sort(bySeverity)
    .slice(0, config.maxFindings ?? 30);
}`,
  },
  {
    id: 6,
    title: "Post to PR",
    subtitle: "GitHub / Bitbucket",
    description: "Maps each finding to a valid diff line, builds inline comments with suggested fixes, submits the PR review via GitHub API, and updates the Check Run status based on severity.",
    color: "#34d9a8",
    filename: "lib/github.ts",
    language: "typescript",
    code: `async function postReview(
  pr: PullRequest,
  findings: Finding[],
  reviewBody: string
) {
  const diffLines = parseDiffLines(pr.diff);
  const comments = findings.map(f => ({
    path: f.filePath,
    line: findValidDiffLine(diffLines, f),
    body: formatInlineComment(f),
  }));

  await ghCreatePullRequestReview({
    owner: pr.owner,
    repo: pr.repo,
    pull_number: pr.number,
    body: reviewBody,
    event: "COMMENT",
    comments,
  });

  // Update check run status
  const conclusion = hasBlockingFindings(findings)
    ? "failure" : "success";
  await ghUpdateCheckRun(pr, conclusion);
}`,
  },
  {
    id: 7,
    title: "Persist & Store",
    subtitle: "Database + Vectors",
    description: "Creates ReviewIssue records for each finding in the database, embeds the full review body into Qdrant review_chunks and diagram_chunks collections, and marks the PR as completed.",
    color: "#5eead4",
    filename: "lib/reviewer.ts",
    language: "typescript",
    code: `async function persistResults(
  pr: PullRequest,
  findings: Finding[],
  reviewBody: string
) {
  // Save findings to database
  await db.reviewIssue.createMany({
    data: findings.map(f => ({
      pullRequestId: pr.id,
      title: f.title,
      description: f.description,
      severity: f.severity,
      filePath: f.filePath,
      lineNumber: f.line,
      confidence: f.confidence,
    }))
  });

  // Embed review into Qdrant
  await qdrant.upsert("review_chunks", {
    points: [{ vector: await embed(reviewBody) }]
  });

  await db.pullRequest.update({
    where: { id: pr.id },
    data: { status: "completed", reviewBody }
  });
}`,
  },
  {
    id: 8,
    title: "Emit Events",
    subtitle: "Notifications",
    description: "Fires review-completed via EventBus triggering Slack messages, audit logs, and email digests. Pushes a real-time update through Pubby so the dashboard refreshes instantly.",
    color: "#99f6e4",
    filename: "lib/events/emitter.ts",
    language: "typescript",
    code: `async function emitReviewCompleted(
  pr: PullRequest,
  findings: Finding[]
) {
  // Fire event to all observers
  await eventBus.emit("review-completed", {
    pullRequestId: pr.id,
    orgId: pr.orgId,
    findingsCount: findings.length,
    severity: getMaxSeverity(findings),
  });
  // -> SlackObserver: sends channel message
  // -> AuditObserver: logs to audit trail
  // -> EmailObserver: sends digest email

  // Real-time dashboard push
  await pubby.publish(
    \`presence-org-\${pr.orgId}\`,
    { type: "review-completed", prId: pr.id }
  );
}`,
  },
];

const TOTAL_PHASES = PHASES.length;

// ── Timing ─────────────────────────────────────────────
const INTRO_DURATION = 90;
const PHASE_DURATION = 150; // frames per phase (~5s)

// ── Syntax highlighting (simple) ───────────────────────
type TokenType = "keyword" | "string" | "comment" | "func" | "type" | "number" | "operator" | "plain";

interface Token {
  text: string;
  type: TokenType;
}

const KEYWORDS = new Set([
  "async", "await", "function", "const", "let", "var", "return",
  "for", "of", "if", "import", "from", "export", "new", "null",
  "true", "false", "type", "interface",
]);

const TYPES = new Set([
  "Repository", "PullRequest", "Finding", "ReviewConfig",
  "FeedbackPattern", "string", "number", "boolean",
]);

function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  // Match comments
  if (line.trimStart().startsWith("//")) {
    tokens.push({ text: line, type: "comment" });
    return tokens;
  }

  const regex = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\$\{|\}|\/\/.*|[a-zA-Z_]\w*|\d+|[{}()\[\];:,.<>=!?&|+\-*/]|\s+)/g;
  let match;
  while ((match = regex.exec(line)) !== null) {
    const text = match[0];
    let type: TokenType = "plain";

    if (/^["'`]/.test(text) || text === "${" || text === "}") {
      type = "string";
    } else if (text.startsWith("//")) {
      type = "comment";
    } else if (KEYWORDS.has(text)) {
      type = "keyword";
    } else if (TYPES.has(text)) {
      type = "type";
    } else if (/^\d+$/.test(text)) {
      type = "number";
    } else if (/^[a-zA-Z_]\w*$/.test(text) && regex.lastIndex < line.length && line[regex.lastIndex] === "(") {
      type = "func";
    } else if (/^[{}()\[\];:,.<>=!?&|+\-*/]+$/.test(text)) {
      type = "operator";
    }
    tokens.push({ text, type });
  }
  return tokens;
}

const TOKEN_COLORS: Record<TokenType, string> = {
  keyword: "#2dd4a0",
  string: "#86efac",
  comment: "#4a4a4a",
  func: "#5eead4",
  type: "#99f6e4",
  number: "#fbbf24",
  operator: "#6ee7b7",
  plain: "#d1d5db",
};

// ── Entry animation styles per phase ───────────────────
type EntryStyle = "slideLeft" | "slideRight" | "zoomIn" | "flipX" | "dropDown" | "riseUp" | "spiralIn" | "slideLeftFlip" | "slideRightFlip";

const ENTRY_STYLES: EntryStyle[] = [
  "slideLeft",       // Phase 0
  "flipX",           // Phase 1
  "riseUp",          // Phase 2
  "slideRight",      // Phase 3
  "zoomIn",          // Phase 4 (LLM Review - dramatic center zoom)
  "dropDown",        // Phase 5
  "slideLeftFlip",   // Phase 6
  "spiralIn",        // Phase 7
  "slideRightFlip",  // Phase 8
];

function getEntryTransform(
  style: EntryStyle,
  progress: number,
  ease: (p: number) => number,
) {
  const p = ease(progress);
  switch (style) {
    case "slideLeft":
      return { rotateY: (1 - p) * -35, rotateX: 0, translateX: (1 - p) * -500, translateY: 0, translateZ: (1 - p) * -200, scale: 0.85 + p * 0.15 };
    case "slideRight":
      return { rotateY: (1 - p) * 35, rotateX: 0, translateX: (1 - p) * 500, translateY: 0, translateZ: (1 - p) * -200, scale: 0.85 + p * 0.15 };
    case "zoomIn":
      return { rotateY: 0, rotateX: (1 - p) * 8, translateX: 0, translateY: 0, translateZ: (1 - p) * -600, scale: 0.3 + p * 0.7 };
    case "flipX":
      return { rotateY: (1 - p) * 90, rotateX: 0, translateX: (1 - p) * 200, translateY: 0, translateZ: (1 - p) * -100, scale: 0.9 + p * 0.1 };
    case "dropDown":
      return { rotateY: 0, rotateX: (1 - p) * -25, translateX: 0, translateY: (1 - p) * -400, translateZ: (1 - p) * -150, scale: 0.8 + p * 0.2 };
    case "riseUp":
      return { rotateY: 0, rotateX: (1 - p) * 20, translateX: 0, translateY: (1 - p) * 400, translateZ: (1 - p) * -150, scale: 0.8 + p * 0.2 };
    case "spiralIn":
      return { rotateY: (1 - p) * 180, rotateX: (1 - p) * 15, translateX: (1 - p) * -300, translateY: (1 - p) * 200, translateZ: (1 - p) * -400, scale: 0.4 + p * 0.6 };
    case "slideLeftFlip":
      return { rotateY: (1 - p) * -60, rotateX: (1 - p) * 10, translateX: (1 - p) * -400, translateY: (1 - p) * -80, translateZ: (1 - p) * -250, scale: 0.85 + p * 0.15 };
    case "slideRightFlip":
      return { rotateY: (1 - p) * 60, rotateX: (1 - p) * -10, translateX: (1 - p) * 400, translateY: (1 - p) * 80, translateZ: (1 - p) * -250, scale: 0.85 + p * 0.15 };
  }
}

function getExitTransform(
  style: EntryStyle,
  progress: number,
  ease: (p: number) => number,
) {
  const p = ease(progress);
  switch (style) {
    case "slideLeft":
    case "slideLeftFlip":
      return { rotateY: p * 30, translateX: p * 400, translateY: p * -60, translateZ: p * -300 };
    case "slideRight":
    case "slideRightFlip":
      return { rotateY: p * -30, translateX: p * -400, translateY: p * 60, translateZ: p * -300 };
    case "zoomIn":
      return { rotateY: 0, translateX: 0, translateY: p * -200, translateZ: p * 400 };
    case "flipX":
      return { rotateY: p * -90, translateX: p * -300, translateY: 0, translateZ: p * -200 };
    case "dropDown":
      return { rotateY: p * 15, translateX: p * 200, translateY: p * 400, translateZ: p * -200 };
    case "riseUp":
      return { rotateY: p * -15, translateX: p * -200, translateY: p * -400, translateZ: p * -200 };
    case "spiralIn":
      return { rotateY: p * -120, translateX: p * 300, translateY: p * -200, translateZ: p * -400 };
  }
}

// ── Code Block Component (3D) ──────────────────────────
const CodeBlock3D: React.FC<{
  phase: (typeof PHASES)[number];
  progress: number;
  exitProgress: number;
  frame: number;
  fps: number;
  phaseIndex: number;
}> = ({ phase, progress, exitProgress, frame, fps, phaseIndex }) => {
  const lines = phase.code.split("\n");
  const entryStyle = ENTRY_STYLES[phaseIndex];
  const easeOut = Easing.out(Easing.cubic);
  const easeIn = Easing.in(Easing.cubic);

  // Compute entry transform
  const entry = getEntryTransform(entryStyle, progress, easeOut);

  // Compute exit transform
  const exit = getExitTransform(entryStyle, exitProgress, easeIn);

  const opacity = interpolate(progress, [0, 0.25], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const exitOpacity = interpolate(exitProgress, [0, 0.5], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Subtle floating motion while visible
  const floatY = Math.sin(frame * 0.025) * 5;
  const floatRotateX = Math.sin(frame * 0.018) * 0.8;
  const floatRotateY = Math.cos(frame * 0.015) * 0.5;

  const finalRotateY = entry.rotateY + (exit.rotateY ?? 0) + floatRotateY;
  const finalRotateX = (entry.rotateX ?? 0) + floatRotateX;
  const finalTranslateX = entry.translateX + (exit.translateX ?? 0);
  const finalTranslateY = (entry.translateY ?? 0) + (exit.translateY ?? 0) + floatY;
  const finalTranslateZ = entry.translateZ + (exit.translateZ ?? 0);
  const finalScale = entry.scale ?? 1;
  const finalOpacity = opacity * exitOpacity;

  // Line-by-line reveal — slower, spread across more of the phase
  const revealedLines = interpolate(progress, [0.1, 0.95], [0, lines.length], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const breathe = Math.sin(frame * 0.06) * 2;

  // Alternate code block position per phase
  const codeLeft = phaseIndex % 2 === 0 ? 80 : undefined;
  const codeRight = phaseIndex % 2 === 1 ? 80 : undefined;
  const originSide = phaseIndex % 2 === 0 ? "right center" : "left center";

  return (
    <div
      style={{
        position: "absolute",
        left: codeLeft,
        right: codeRight,
        top: 160 + finalTranslateY,
        width: 840,
        opacity: finalOpacity,
        transform: `perspective(1200px) rotateY(${finalRotateY}deg) rotateX(${finalRotateX}deg) translateX(${finalTranslateX}px) translateZ(${finalTranslateZ}px) scale(${finalScale})`,
        transformOrigin: originSide,
        zIndex: 10,
      }}
    >
      {/* File tab */}
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 12,
          backgroundColor: "#1a1a1a",
          borderRadius: "14px 14px 0 0",
          padding: "10px 20px",
          borderBottom: `2px solid ${phase.color}`,
        }}
      >
        <div
          style={{
            width: 16,
            height: 16,
            borderRadius: "50%",
            backgroundColor: phase.color,
            boxShadow: `0 0 10px ${phase.color}80`,
          }}
        />
        <span
          style={{
            color: C.textMuted,
            fontSize: 14,
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          }}
        >
          {phase.filename}
        </span>
      </div>

      {/* Code area */}
      <div
        style={{
          backgroundColor: C.codeBg,
          border: `1px solid ${C.codeBorder}`,
          borderTop: "none",
          borderRadius: "0 12px 12px 12px",
          padding: "20px 0",
          boxShadow: `
            0 0 ${30 + breathe}px ${phase.color}15,
            0 20px 60px rgba(0,0,0,0.6),
            inset 0 1px 0 rgba(255,255,255,0.03)
          `,
          overflow: "hidden",
        }}
      >
        {lines.map((line, lineIdx) => {
          const lineProgress = interpolate(
            revealedLines,
            [lineIdx - 0.5, lineIdx + 0.5],
            [0, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
          );
          const tokens = tokenizeLine(line);

          return (
            <div
              key={lineIdx}
              style={{
                display: "flex",
                padding: "0 32px",
                lineHeight: "26px",
                opacity: lineProgress,
                transform: `translateX(${(1 - lineProgress) * 20}px)`,
              }}
            >
              {/* Line number */}
              <span
                style={{
                  color: C.lineNum,
                  fontSize: 13,
                  fontFamily: "'JetBrains Mono', monospace",
                  width: 36,
                  textAlign: "right",
                  marginRight: 20,
                  userSelect: "none",
                  flexShrink: 0,
                }}
              >
                {lineIdx + 1}
              </span>
              {/* Code tokens */}
              <span style={{ fontSize: 14, fontFamily: "'JetBrains Mono', 'Fira Code', monospace", whiteSpace: "pre" }}>
                {tokens.map((token, ti) => (
                  <span key={ti} style={{ color: TOKEN_COLORS[token.type] }}>
                    {token.text}
                  </span>
                ))}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ── Phase Title Overlay ────────────────────────────────
const PhaseTitle: React.FC<{
  phase: (typeof PHASES)[number];
  progress: number;
  exitProgress: number;
  frame: number;
  fps: number;
  phaseIndex: number;
}> = ({ phase, progress, exitProgress, frame, fps, phaseIndex }) => {
  const enterSpring = spring({
    frame: Math.round(progress * 30),
    fps,
    config: { damping: 12, stiffness: 100 },
  });

  const exitOpacity = interpolate(exitProgress, [0, 0.4], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const floatY = Math.sin(frame * 0.025) * 3;

  // Title goes on opposite side of code
  const titleSide = phaseIndex % 2 === 0 ? "right" : "left";

  return (
    <div
      style={{
        position: "absolute",
        [titleSide === "right" ? "right" : "left"]: 100,
        top: 200 + floatY,
        width: 540,
        opacity: enterSpring * exitOpacity,
        transform: `translateY(${(1 - enterSpring) * 40}px)`,
        zIndex: 8,
      }}
    >
      {/* Phase number badge */}
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 10,
          backgroundColor: phase.color + "18",
          border: `1px solid ${phase.color}40`,
          borderRadius: 14,
          padding: "8px 20px",
          marginBottom: 20,
        }}
      >
        <div
          style={{
            width: 12,
            height: 12,
            borderRadius: "50%",
            backgroundColor: phase.color,
            boxShadow: `0 0 10px ${phase.color}`,
          }}
        />
        <span
          style={{
            color: phase.color,
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: 4,
            textTransform: "uppercase",
            fontFamily: "Inter, system-ui, sans-serif",
          }}
        >
          Phase {phase.id}
        </span>
      </div>

      {/* Title */}
      <div
        style={{
          color: C.text,
          fontSize: 62,
          fontWeight: 800,
          fontFamily: "Inter, system-ui, sans-serif",
          lineHeight: 1.1,
          marginBottom: 14,
          textShadow: `0 0 40px ${phase.color}30`,
        }}
      >
        {phase.title}
      </div>

      {/* Subtitle */}
      <div
        style={{
          color: C.textMuted,
          fontSize: 26,
          fontFamily: "Inter, system-ui, sans-serif",
          marginBottom: 22,
        }}
      >
        {phase.subtitle}
      </div>

      {/* Description */}
      <div
        style={{
          color: C.textDim,
          fontSize: 20,
          fontFamily: "Inter, system-ui, sans-serif",
          lineHeight: 1.7,
          marginBottom: 24,
          opacity: interpolate(progress, [0.3, 0.6], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          transform: `translateY(${interpolate(progress, [0.3, 0.6], [12, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })}px)`,
        }}
      >
        {phase.description}
      </div>

      {/* Decorative line */}
      <div
        style={{
          width: interpolate(progress, [0.2, 0.6], [0, 80], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          height: 3,
          backgroundColor: phase.color,
          borderRadius: 2,
          boxShadow: `0 0 12px ${phase.color}60`,
        }}
      />
    </div>
  );
};

// ── Progress Bar ───────────────────────────────────────
const ProgressBar: React.FC<{
  currentPhase: number;
  phaseProgress: number;
  isOutro: boolean;
}> = ({ currentPhase, phaseProgress, isOutro }) => {
  const totalProgress = isOutro
    ? 1
    : (currentPhase + phaseProgress) / TOTAL_PHASES;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        height: 4,
        backgroundColor: "#1a1a1a",
        zIndex: 20,
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${totalProgress * 100}%`,
          background: `linear-gradient(90deg, #14b8a6, #2dd4a0, #5eead4, #34d9a8, #99f6e4, #2dd4a0)`,
          boxShadow: "0 0 12px rgba(45, 212, 160, 0.5)",
          borderRadius: "0 2px 2px 0",
        }}
      />
    </div>
  );
};

// ── Background Grid (3D perspective) ───────────────────
const PerspectiveGrid: React.FC<{ frame: number }> = ({ frame }) => {
  const gridOffset = (frame * 0.5) % 80;

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        perspective: 600,
        perspectiveOrigin: "50% 30%",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: "-20%",
          right: "-20%",
          bottom: -200,
          height: 700,
          transform: "rotateX(60deg)",
          transformOrigin: "bottom center",
          opacity: 0.06,
          backgroundImage: `
            linear-gradient(${C.accent} 1px, transparent 1px),
            linear-gradient(90deg, ${C.accent} 1px, transparent 1px)
          `,
          backgroundSize: "80px 80px",
          backgroundPosition: `0 ${gridOffset}px`,
        }}
      />
    </div>
  );
};

// ── Floating Particles ─────────────────────────────────
const Particles: React.FC<{ frame: number; width: number; height: number }> = ({
  frame,
  width,
  height,
}) => {
  const particles = useMemo(() => {
    const result = [];
    for (let i = 0; i < 50; i++) {
      result.push({
        x: Math.random() * width,
        y: Math.random() * height,
        z: Math.random(), // depth (0 = far, 1 = near)
        delay: Math.random() * 200,
        size: 1 + Math.random() * 3,
        color: [C.accent, C.cyan, C.purple, C.pink, C.orange][
          Math.floor(Math.random() * 5)
        ],
      });
    }
    return result;
  }, [width, height]);

  return (
    <>
      {particles.map((p, i) => {
        const t = (frame + p.delay) * (0.2 + p.z * 0.5);
        const opacity = interpolate(
          Math.sin(t * 0.03),
          [-1, 0, 1],
          [0, 0.15, 0.4 + p.z * 0.3],
        );
        const drift = Math.sin(t * 0.015) * (20 + p.z * 30);
        const yDrift = Math.cos(t * 0.012) * (15 + p.z * 20);
        const size = p.size * (0.5 + p.z * 0.8);

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: p.x + drift,
              top: p.y + yDrift,
              width: size,
              height: size,
              borderRadius: "50%",
              backgroundColor: p.color,
              opacity,
              boxShadow: `0 0 ${size * 4}px ${p.color}`,
              filter: p.z < 0.3 ? "blur(2px)" : "none",
              pointerEvents: "none",
            }}
          />
        );
      })}
    </>
  );
};

// ── Main Component ─────────────────────────────────────
export const ReviewEnginePipeline: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const phaseFrame = Math.max(0, frame - INTRO_DURATION);
  const currentPhaseIndex = Math.min(
    Math.floor(phaseFrame / PHASE_DURATION),
    TOTAL_PHASES - 1,
  );
  const phaseLocalFrame = phaseFrame - currentPhaseIndex * PHASE_DURATION;
  const phaseLocalProgress = phaseLocalFrame / PHASE_DURATION;

  const outroStart = INTRO_DURATION + TOTAL_PHASES * PHASE_DURATION;
  const isOutro = frame >= outroStart;
  const outroProgress = interpolate(frame, [outroStart, outroStart + 50], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Intro animations
  const introTitleSpring = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 60 },
  });

  const introSubtitleOpacity = interpolate(frame, [25, 50], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const introFade = interpolate(frame, [INTRO_DURATION - 20, INTRO_DURATION], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Phase counter badge top-left
  const phaseCounterOpacity = interpolate(phaseFrame, [0, 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ backgroundColor: C.bg, overflow: "hidden" }}>
      {/* Background layers */}
      <div
        style={{
          position: "absolute",
          top: 0, left: 0, right: 0, bottom: 0,
          background: `
            radial-gradient(ellipse at 20% 50%, ${C.accent}06 0%, transparent 50%),
            radial-gradient(ellipse at 80% 50%, ${C.accent}04 0%, transparent 50%),
            radial-gradient(ellipse at 50% 100%, ${C.accent}03 0%, transparent 40%)
          `,
        }}
      />
      <PerspectiveGrid frame={frame} />
      <Particles frame={frame} width={width} height={height} />

      {/* ── Intro ── */}
      {frame < INTRO_DURATION + 10 && (
        <div
          style={{
            position: "absolute",
            top: 0, left: 0, right: 0, bottom: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 15,
            opacity: introFade,
          }}
        >
          <img
            src={staticFile("logo-w-text.svg")}
            style={{
              height: 120,
              opacity: introTitleSpring,
              transform: `translateY(${(1 - introTitleSpring) * -30}px) scale(${interpolate(introTitleSpring, [0, 1], [0.85, 1])})`,
              filter: `drop-shadow(0 0 40px ${C.accent}40)`,
              marginBottom: 24,
            }}
          />
          <div
            style={{
              fontSize: 72,
              color: C.text,
              fontWeight: 800,
              fontFamily: "Inter, system-ui, sans-serif",
              opacity: introTitleSpring,
              transform: `translateY(${(1 - introTitleSpring) * -40}px) scale(${interpolate(introTitleSpring, [0, 1], [0.9, 1])})`,
              textShadow: `0 0 80px ${C.accent}30`,
              letterSpacing: -2,
            }}
          >
            Review Engine
          </div>
          <div
            style={{
              fontSize: 22,
              color: C.textMuted,
              fontFamily: "Inter, system-ui, sans-serif",
              opacity: introSubtitleOpacity,
              marginTop: 16,
              letterSpacing: 2,
            }}
          >
            AI-Powered Code Review Pipeline
          </div>

          {/* Decorative code preview */}
          <div
            style={{
              marginTop: 50,
              opacity: interpolate(frame, [40, 65], [0, 0.4], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 15,
              color: C.textDim,
              textAlign: "center",
              lineHeight: 1.8,
            }}
          >
            <span style={{ color: "#2dd4a0" + "90" }}>Webhook</span>
            <span> → </span>
            <span style={{ color: "#5eead4" + "90" }}>processReview()</span>
            <span> → </span>
            <span style={{ color: "#34d9a8" + "90" }}>9 phases</span>
            <span> → </span>
            <span style={{ color: "#99f6e4" + "90" }}>AI findings</span>
          </div>
        </div>
      )}

      {/* ── Phase Content ── */}
      {!isOutro &&
        phaseFrame > 0 &&
        PHASES.map((phase, i) => {
          if (Math.abs(i - currentPhaseIndex) > 1) return null;

          const isCurrentPhase = i === currentPhaseIndex;
          const isPrev = i === currentPhaseIndex - 1;

          // Enter: 40 frames to fully appear
          const enterProgress = isCurrentPhase
            ? interpolate(phaseLocalFrame, [0, 40], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              })
            : isPrev
              ? 1
              : 0;

          // Exit: only when becoming prev (first 30 frames of next phase)
          const exitProgress = isPrev
            ? interpolate(phaseLocalFrame, [0, 30], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              })
            : 0;

          // Don't render if not visible
          if (!isCurrentPhase && !isPrev) return null;
          if (isPrev && exitProgress >= 1) return null;

          return (
            <React.Fragment key={phase.id}>
              <CodeBlock3D
                phase={phase}
                progress={enterProgress}
                exitProgress={exitProgress}
                frame={frame}
                fps={fps}
                phaseIndex={i}
              />
              <PhaseTitle
                phase={phase}
                progress={enterProgress}
                exitProgress={exitProgress}
                frame={frame}
                fps={fps}
                phaseIndex={i}
              />
            </React.Fragment>
          );
        })}

      {/* ── Logo watermark (bottom-left) ── */}
      {!isOutro && phaseFrame > 0 && (
        <img
          src={staticFile("logo-w-text.svg")}
          style={{
            position: "absolute",
            bottom: 28,
            left: 40,
            height: 28,
            opacity: phaseCounterOpacity * 0.5,
            filter: "brightness(0.8)",
            zIndex: 20,
            pointerEvents: "none",
          }}
        />
      )}

      {/* ── Phase counter (top-left) ── */}
      {!isOutro && phaseFrame > 0 && (
        <div
          style={{
            position: "absolute",
            top: 40,
            left: 48,
            zIndex: 20,
            opacity: phaseCounterOpacity,
            display: "flex",
            alignItems: "center",
            gap: 16,
          }}
        >
          {PHASES.map((phase, i) => {
            const isActive = i === currentPhaseIndex;
            const isPast = i < currentPhaseIndex;
            return (
              <div
                key={phase.id}
                style={{
                  width: isActive ? 32 : 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: isActive
                    ? phase.color
                    : isPast
                      ? C.green + "80"
                      : "#222222",
                  boxShadow: isActive ? `0 0 10px ${phase.color}80` : "none",
                }}
              />
            );
          })}
        </div>
      )}

      {/* Phase number (top-right) */}
      {!isOutro && phaseFrame > 0 && (
        <div
          style={{
            position: "absolute",
            top: 36,
            right: 48,
            zIndex: 20,
            opacity: phaseCounterOpacity,
            color: C.textDim,
            fontSize: 22,
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          <span style={{ color: PHASES[currentPhaseIndex].color, fontWeight: 700 }}>
            {String(currentPhaseIndex + 1).padStart(2, "0")}
          </span>
          <span> / {String(TOTAL_PHASES).padStart(2, "0")}</span>
        </div>
      )}

      {/* ── Progress bar ── */}
      <ProgressBar
        currentPhase={currentPhaseIndex}
        phaseProgress={phaseLocalProgress}
        isOutro={isOutro}
      />

      {/* ── Outro ── */}
      {isOutro && (
        <div
          style={{
            position: "absolute",
            top: 0, left: 0, right: 0, bottom: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 30,
            backgroundColor: `rgba(10, 10, 10, ${outroProgress * 0.92})`,
          }}
        >
          <div
            style={{
              textAlign: "center",
              opacity: outroProgress,
              transform: `scale(${interpolate(outroProgress, [0, 1], [0.9, 1])})`,
            }}
          >
            <div
              style={{
                fontSize: 64,
                fontWeight: 800,
                color: C.text,
                fontFamily: "Inter, system-ui, sans-serif",
                textShadow: `0 0 80px ${C.accent}40`,
                marginBottom: 20,
                letterSpacing: -1,
              }}
            >
              Review Complete
            </div>
            <div
              style={{
                fontSize: 24,
                color: C.green,
                fontFamily: "Inter, system-ui, sans-serif",
                fontWeight: 600,
                marginBottom: 12,
              }}
            >
              ✓ All 9 phases executed successfully
            </div>
            <div
              style={{
                fontSize: 17,
                color: C.textMuted,
                fontFamily: "'JetBrains Mono', monospace",
                letterSpacing: 1,
              }}
            >
              AI-powered · fully automated · feedback-driven
            </div>
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};
