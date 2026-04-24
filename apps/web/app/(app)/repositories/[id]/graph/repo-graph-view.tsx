"use client";

import type { ComponentType } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const ForceGraph2D = dynamic(
  async () => (await import("react-force-graph-2d")).default,
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[70vh] items-center justify-center text-muted-foreground">
        Loading graph…
      </div>
    ),
  },
) as unknown as ComponentType<Record<string, unknown>>;

type GraphNode = {
  id: string;
  path: string;
  name: string;
  dir: string;
  language: string;
  chunks: number;
  lines: number;
};

type GraphEdge = {
  source: string;
  target: string;
  type: "import" | "semantic";
  weight: number;
};

type Highlight = {
  id: string;
  path: string;
  title: string;
  description: string;
  kind: "entrypoint" | "config" | "hub" | "large";
  score: number;
};

type GraphPayload = {
  repo: { id: string; fullName: string };
  nodes: GraphNode[];
  edges: GraphEdge[];
  highlights: Highlight[];
};

type NodeObject = GraphNode & { x?: number; y?: number };
type LinkObject = GraphEdge & { source: NodeObject | string; target: NodeObject | string };

type ForceGraphHandle = {
  centerAt: (x: number, y: number, durationMs?: number) => void;
  zoom: (k: number, durationMs?: number) => void;
};

const DIR_PALETTE = [
  "#60a5fa",
  "#f472b6",
  "#34d399",
  "#fbbf24",
  "#a78bfa",
  "#f87171",
  "#22d3ee",
  "#fb923c",
  "#4ade80",
  "#e879f9",
];

const KIND_STYLES: Record<Highlight["kind"], { label: string; className: string }> = {
  entrypoint: { label: "Entry", className: "bg-blue-500/15 text-blue-300 ring-blue-500/30" },
  config: { label: "Config", className: "bg-amber-500/15 text-amber-300 ring-amber-500/30" },
  hub: { label: "Hub", className: "bg-fuchsia-500/15 text-fuchsia-300 ring-fuchsia-500/30" },
  large: { label: "Large", className: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30" },
};

function buildDirColorMap(nodes: GraphNode[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const n of nodes) counts.set(n.dir, (counts.get(n.dir) ?? 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  });
  const map = new Map<string, string>();
  sorted.forEach(([dir], i) => {
    map.set(dir, DIR_PALETTE[i % DIR_PALETTE.length]);
  });
  return map;
}

export function RepoGraphView({
  repoId,
  indexStatus,
}: {
  repoId: string;
  indexStatus: string;
}) {
  const [data, setData] = useState<GraphPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [showSemantic, setShowSemantic] = useState(true);
  const [showImports, setShowImports] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraphHandle | null>(null);
  const [dims, setDims] = useState({ width: 800, height: 600 });

  useEffect(() => {
    if (indexStatus !== "indexed") return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/repositories/${repoId}/graph`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((json: GraphPayload) => {
        if (cancelled) return;
        setData(json);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load graph");
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [repoId, indexStatus]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setDims({ width: el.clientWidth, height: Math.max(500, el.clientHeight) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const dirColors = useMemo(
    () => (data ? buildDirColorMap(data.nodes) : new Map<string, string>()),
    [data],
  );

  const [showAllDirs, setShowAllDirs] = useState(false);
  const LEGEND_MAX = 8;
  const dirList = useMemo(() => [...dirColors.entries()], [dirColors]);
  const visibleDirs = showAllDirs ? dirList : dirList.slice(0, LEGEND_MAX);

  const filtered = useMemo(() => {
    if (!data) return { nodes: [], links: [] as LinkObject[] };
    const links = data.edges.filter((e) =>
      e.type === "semantic" ? showSemantic : showImports,
    );
    return { nodes: data.nodes, links: links as LinkObject[] };
  }, [data, showSemantic, showImports]);

  function focusOn(nodeId: string) {
    if (!data) return;
    const node = data.nodes.find((n) => n.id === nodeId) as NodeObject | undefined;
    if (!node || node.x === undefined || node.y === undefined) {
      setFocusedId(nodeId);
      return;
    }
    setFocusedId(nodeId);
    graphRef.current?.centerAt(node.x, node.y, 600);
    graphRef.current?.zoom(3, 600);
  }

  if (indexStatus !== "indexed") {
    return (
      <Card className="p-6">
        <p className="text-muted-foreground">
          This repository is not indexed yet. Once indexing finishes the graph will be available here.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={showImports ? "default" : "outline"}
          onClick={() => setShowImports((v) => !v)}
        >
          Imports
        </Button>
        <Button
          size="sm"
          variant={showSemantic ? "default" : "outline"}
          onClick={() => setShowSemantic((v) => !v)}
        >
          Semantic
        </Button>
        {data && (
          <span className="text-xs text-muted-foreground ml-2">
            {data.nodes.length} files · {data.edges.length} edges
          </span>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="overflow-hidden p-0">
          <div
            ref={containerRef}
            className="relative h-[70vh] w-full bg-background"
          >
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                Building graph…
              </div>
            )}
            {error && (
              <div className="absolute inset-0 flex items-center justify-center text-destructive">
                {error}
              </div>
            )}
            {data && !loading && !error && (
              <ForceGraph2D
                ref={(r: ForceGraphHandle | null) => {
                  graphRef.current = r;
                }}
                graphData={filtered}
                width={dims.width}
                height={dims.height}
                backgroundColor="transparent"
                nodeRelSize={4}
                nodeVal={(n: NodeObject) => Math.max(1, Math.sqrt(n.chunks))}
                nodeLabel={(n: NodeObject) => n.path}
                nodeColor={(n: NodeObject) =>
                  focusedId === n.id
                    ? "#ffffff"
                    : dirColors.get(n.dir) ?? DIR_PALETTE[0]
                }
                linkColor={(l: LinkObject) =>
                  l.type === "semantic"
                    ? "rgba(148,163,184,0.35)"
                    : "rgba(148,163,184,0.75)"
                }
                linkWidth={(l: LinkObject) => (l.type === "semantic" ? 0.5 : 1)}
                linkLineDash={(l: LinkObject) =>
                  l.type === "semantic" ? [2, 3] : null
                }
                linkDirectionalArrowLength={(l: LinkObject) =>
                  l.type === "import" ? 3 : 0
                }
                linkDirectionalArrowRelPos={1}
                cooldownTicks={120}
                onNodeHover={(n: NodeObject | null) => setHoveredNode(n ?? null)}
                onNodeClick={(n: NodeObject) => focusOn(n.id)}
                nodeCanvasObjectMode={(n: NodeObject) =>
                  focusedId === n.id ? "before" : "after"
                }
                nodeCanvasObject={(
                  node: NodeObject,
                  ctx: CanvasRenderingContext2D,
                  globalScale: number,
                ) => {
                  const r = Math.max(1, Math.sqrt(node.chunks)) * 4;
                  if (focusedId === node.id) {
                    ctx.beginPath();
                    ctx.arc(node.x ?? 0, node.y ?? 0, r + 4, 0, Math.PI * 2);
                    ctx.fillStyle = "rgba(255,255,255,0.18)";
                    ctx.fill();
                  }
                  if (globalScale < 1.5 && focusedId !== node.id) return;
                  const label = node.name;
                  const fontSize = 10 / globalScale;
                  ctx.font = `${fontSize}px sans-serif`;
                  ctx.fillStyle = "rgba(255,255,255,0.85)";
                  ctx.textAlign = "center";
                  ctx.textBaseline = "top";
                  ctx.fillText(label, node.x ?? 0, (node.y ?? 0) + r + 1);
                }}
              />
            )}
            {hoveredNode && (
              <div className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-background/90 px-3 py-2 text-xs shadow ring-1 ring-border">
                <div className="font-medium">{hoveredNode.path}</div>
                <div className="text-muted-foreground">
                  {hoveredNode.chunks} chunks · {hoveredNode.lines} lines · {hoveredNode.language}
                </div>
              </div>
            )}
            {data && !loading && !error && (
              <div className="absolute top-2 right-2 w-56 rounded-md bg-background/90 p-3 text-xs shadow ring-1 ring-border">
                <div className="mb-2 font-semibold">Legend</div>
                <div className="mb-2 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-0.5 w-6 bg-slate-300/80" />
                    <span className="text-muted-foreground">Import (directed)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <svg width="24" height="2" className="shrink-0">
                      <line
                        x1="0"
                        y1="1"
                        x2="24"
                        y2="1"
                        stroke="rgb(148,163,184)"
                        strokeOpacity="0.6"
                        strokeDasharray="2,3"
                      />
                    </svg>
                    <span className="text-muted-foreground">Semantic similarity</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block rounded-full bg-muted-foreground/40"
                      style={{ width: 6, height: 6 }}
                    />
                    <span
                      className="inline-block rounded-full bg-muted-foreground/70"
                      style={{ width: 10, height: 10 }}
                    />
                    <span className="text-muted-foreground">Size = chunk count</span>
                  </div>
                </div>
                <div className="border-t pt-2">
                  <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                    Top-level folder
                  </div>
                  <ul className="space-y-1">
                    {visibleDirs.map(([dir, color]) => (
                      <li key={dir} className="flex items-center gap-2">
                        <span
                          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: color }}
                        />
                        <span className="truncate">{dir === "." ? "(root)" : dir}</span>
                      </li>
                    ))}
                  </ul>
                  {dirList.length > LEGEND_MAX && (
                    <button
                      type="button"
                      onClick={() => setShowAllDirs((v) => !v)}
                      className="mt-2 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      {showAllDirs
                        ? "Show less"
                        : `Show ${dirList.length - LEGEND_MAX} more…`}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </Card>

        <Card className="flex max-h-[70vh] flex-col overflow-hidden">
          <div className="border-b px-4 py-3">
            <h3 className="text-sm font-semibold">Highlights</h3>
            <p className="text-xs text-muted-foreground">
              Key files for orienting around this repo. Click to focus on the graph.
            </p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {data?.highlights?.length ? (
              <ul className="divide-y">
                {data.highlights.map((h) => {
                  const style = KIND_STYLES[h.kind];
                  const isFocused = focusedId === h.id;
                  return (
                    <li key={h.id}>
                      <button
                        type="button"
                        onClick={() => focusOn(h.id)}
                        className={`w-full text-left px-4 py-3 transition-colors hover:bg-muted/50 ${
                          isFocused ? "bg-muted/70" : ""
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ${style.className}`}
                          >
                            {style.label}
                          </span>
                          <span className="truncate text-sm font-medium">
                            {h.title}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground break-words">
                          {h.description}
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="p-4 text-sm text-muted-foreground">
                {loading ? "Analyzing repository…" : "No highlights found."}
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
