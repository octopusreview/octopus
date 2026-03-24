"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { IconLoader2, IconCheck, IconX, IconArrowDown } from "@tabler/icons-react";

export interface ProgressEntry {
  step: string;
  message: string;
  package?: string;
  timestamp: number;
}

interface ProgressLogProps {
  entries: ProgressEntry[];
  isComplete: boolean;
}

export function ProgressLog({ entries, isComplete }: ProgressLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [newMessages, setNewMessages] = useState(0);

  const hasError = entries.some((e) => e.step === "error");

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      setNewMessages(0);
    }
  }, []);

  // Auto-scroll when new entries arrive (if user is at bottom)
  useEffect(() => {
    if (isAtBottom) {
      scrollToBottom();
    } else {
      setNewMessages((prev) => prev + 1);
    }
  }, [entries.length, isAtBottom, scrollToBottom]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 30;
    setIsAtBottom(atBottom);
    if (atBottom) setNewMessages(0);
  };

  if (entries.length === 0) return null;

  return (
    <div className="bg-muted/50 rounded-lg border p-4">
      <div className="flex items-center gap-2 mb-3">
        {hasError ? (
          <IconX className="h-4 w-4 text-red-500" />
        ) : isComplete ? (
          <IconCheck className="h-4 w-4 text-green-500" />
        ) : (
          <IconLoader2 className="h-4 w-4 animate-spin" />
        )}
        <span className="text-sm font-medium">
          {hasError ? "Analysis Failed" : isComplete ? "Analysis Complete" : "Analysis in Progress..."}
        </span>
      </div>
      <div className="relative">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="space-y-1 max-h-60 overflow-y-auto"
        >
          {entries.map((entry, i) => (
            <div key={i} className="flex items-start gap-2 text-xs font-mono">
              <span className="text-muted-foreground shrink-0">
                {new Date(entry.timestamp).toLocaleTimeString()}
              </span>
              <span className="text-muted-foreground shrink-0">[{entry.step}]</span>
              <span className={entry.step === "error" ? "text-red-500" : ""}>
                {entry.message}
              </span>
            </div>
          ))}
        </div>
        {!isAtBottom && newMessages > 0 && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs text-primary-foreground shadow-lg"
          >
            <IconArrowDown className="h-3 w-3" />
            {newMessages} new
          </button>
        )}
      </div>
    </div>
  );
}
