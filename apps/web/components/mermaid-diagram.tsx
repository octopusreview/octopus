"use client";

import { useEffect, useRef, useState, useId } from "react";
import { IconMaximize, IconX } from "@tabler/icons-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { VisuallyHidden } from "radix-ui";

// Module-level cache so re-mounts don't re-render the same diagram
const svgCache = new Map<string, string>();

export function MermaidDiagram({ code }: { code: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const trimmed = code.trim();
  const [svg, setSvg] = useState<string | null>(svgCache.get(trimmed) ?? null);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const uniqueId = useId().replace(/:/g, "m");

  useEffect(() => {
    if (svgCache.has(trimmed)) {
      setSvg(svgCache.get(trimmed)!);
      return;
    }

    let cancelled = false;

    async function render() {
      // Create a temporary offscreen container so mermaid doesn't
      // pollute document.body with error elements on syntax failures.
      const tempContainer = document.createElement("div");
      tempContainer.style.position = "absolute";
      tempContainer.style.left = "-9999px";
      tempContainer.style.top = "-9999px";
      document.body.appendChild(tempContainer);

      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          fontFamily: "inherit",
          securityLevel: "strict",
        });

        const { svg: renderedSvg } = await mermaid.render(
          `mermaid-${uniqueId}`,
          trimmed,
          tempContainer,
        );

        if (!cancelled) {
          svgCache.set(trimmed, renderedSvg);
          setSvg(renderedSvg);
          setError(false);
        }
      } catch {
        if (!cancelled) {
          setError(true);
        }
      } finally {
        tempContainer.remove();
      }
    }

    render();
    return () => {
      cancelled = true;
    };
  }, [trimmed, uniqueId]);

  if (error) {
    return (
      <pre className="overflow-x-auto rounded bg-background/50 p-2 text-xs">
        <code>{code}</code>
      </pre>
    );
  }

  if (!svg) {
    return (
      <div className="flex items-center justify-center rounded bg-background/50 p-4 text-xs text-muted-foreground">
        Loading diagram...
      </div>
    );
  }

  return (
    <>
      <div className="group relative rounded bg-background/50 p-2">
        <Button
          variant="ghost"
          size="icon-sm"
          className="absolute top-1 right-1 opacity-0 transition-opacity group-hover:opacity-100 z-10 bg-background/80 hover:bg-background"
          onClick={() => setExpanded(true)}
        >
          <IconMaximize className="size-3.5" />
        </Button>
        <div
          ref={containerRef}
          className="overflow-x-auto [&_svg]:max-w-full [&_text]:!fill-foreground [&_.nodeLabel]:!text-foreground [&_.edgeLabel]:!text-foreground [&_.label]:!text-foreground"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>

      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent
          className="sm:max-w-[90vw] max-h-[90vh] overflow-auto"
          showCloseButton={false}
        >
          <VisuallyHidden.Root>
            <DialogTitle>Diyagram</DialogTitle>
          </VisuallyHidden.Root>
          <Button
            variant="ghost"
            size="icon-sm"
            className="absolute top-3 right-3 z-10"
            onClick={() => setExpanded(false)}
          >
            <IconX className="size-4" />
          </Button>
          <div
            className="flex items-center justify-center [&_svg]:max-w-full [&_svg]:max-h-[80vh] [&_text]:!fill-foreground [&_.nodeLabel]:!text-foreground [&_.edgeLabel]:!text-foreground [&_.label]:!text-foreground"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
