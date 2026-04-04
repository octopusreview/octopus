"use client";

import { useState, useRef, useEffect, useCallback, memo } from "react";
import { IconMessageCircle, IconX, IconSend, IconLoader2 } from "@tabler/icons-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { generateFingerprint } from "@/lib/fingerprint";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const MarkdownContent = memo(function MarkdownContent({ content }: { content: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
        ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-1 last:mb-0">{children}</ul>,
        ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-1 last:mb-0">{children}</ol>,
        li: ({ children }) => <li>{children}</li>,
        code: ({ children, className }) => {
          const isBlock = className?.includes("language-");
          if (isBlock) {
            return (
              <pre className="my-2 overflow-x-auto rounded-lg bg-black/30 p-2.5 text-xs">
                <code>{children}</code>
              </pre>
            );
          }
          return <code className="rounded bg-white/10 px-1 py-0.5 text-xs text-[#10D8BE]">{children}</code>;
        },
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-[#10D8BE] underline underline-offset-2 hover:text-[#0fc0a8]">
            {children}
          </a>
        ),
        h1: ({ children }) => <h1 className="mb-2 text-base font-bold text-white">{children}</h1>,
        h2: ({ children }) => <h2 className="mb-1.5 text-sm font-bold text-white">{children}</h2>,
        h3: ({ children }) => <h3 className="mb-1 text-sm font-semibold text-white">{children}</h3>,
      }}
    >
      {content}
    </Markdown>
  );
});

const SUGGESTED_QUESTIONS = [
  "What is Octopus?",
  "How does code review work?",
  "Can I self-host Octopus?",
  "What languages are supported?",
];

export function AskOctopus() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const fingerprintRef = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Generate fingerprint once on mount
  useEffect(() => {
    generateFingerprint().then((fp) => {
      fingerprintRef.current = fp;
    });
  }, []);

  // Listen for external open trigger (from navbar button)
  useEffect(() => {
    const handler = () => setIsOpen(true);
    window.addEventListener("ask-octopus-open", handler);
    return () => window.removeEventListener("ask-octopus-open", handler);
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) return;

      const userMessage: Message = { role: "user", content: trimmed };
      setMessages((prev) => [...prev, userMessage]);
      setInput("");
      setIsStreaming(true);

      // Build history (exclude the current message)
      const history = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      // Add empty assistant message for streaming
      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/ask-octopus", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: trimmed,
            history,
            fingerprint: fingerprintRef.current,
            sessionId,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Request failed" }));
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              role: "assistant",
              content: err.error || "Something went wrong. Please try again.",
            };
            return updated;
          });
          setIsStreaming(false);
          return;
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No reader");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6);
            if (data === "[DONE]") break;

            try {
              const parsed = JSON.parse(data);
              if (parsed.session_id) {
                setSessionId(parsed.session_id);
              }
              if (parsed.delta) {
                setMessages((prev) => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last?.role === "assistant") {
                    updated[updated.length - 1] = {
                      ...last,
                      content: last.content + parsed.delta,
                    };
                  }
                  return updated;
                });
              }
            } catch {
              // skip malformed JSON
            }
          }
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: "assistant",
            content: "Connection error. Please try again.",
          };
          return updated;
        });
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [isStreaming, messages, sessionId],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <>
      {/* Floating button — hidden, chat is opened from navbar */}

      {/* Chat panel — bottom sheet on mobile, floating panel on desktop */}
      {isOpen && (
        <>
          {/* Mobile backdrop */}
          <div
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm sm:hidden"
            onClick={() => setIsOpen(false)}
          />
        </>
      )}
      {isOpen && (
        <div className="fixed inset-x-0 bottom-0 z-50 flex h-[85dvh] flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-[#111] shadow-2xl shadow-black/60 sm:inset-auto sm:right-6 sm:bottom-6 sm:h-[560px] sm:w-[420px] sm:rounded-2xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/[0.08] bg-[#0c0c0c] px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex size-7 items-center justify-center rounded-lg bg-[#10D8BE]/10">
                <IconMessageCircle className="size-4 text-[#10D8BE]" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Ask Octopus</h3>
                <p className="text-[10px] text-[#666]">AI-powered answers about Octopus</p>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="rounded-lg p-1.5 text-[#666] transition-colors hover:bg-white/[0.06] hover:text-white"
            >
              <IconX className="size-4" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center">
                <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-[#10D8BE]/10">
                  <IconMessageCircle className="size-6 text-[#10D8BE]" />
                </div>
                <p className="mb-1 text-sm font-medium text-white">
                  Ask me anything about Octopus
                </p>
                <p className="mb-6 text-center text-xs text-[#666]">
                  I can help with setup, features, pricing, integrations, and more.
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  {SUGGESTED_QUESTIONS.map((q) => (
                    <button
                      key={q}
                      onClick={() => sendMessage(q)}
                      className="rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs text-[#888] transition-colors hover:border-white/[0.15] hover:bg-white/[0.06] hover:text-white"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                        msg.role === "user"
                          ? "bg-[#10D8BE]/15 text-white"
                          : "bg-white/[0.05] text-[#ccc]"
                      }`}
                    >
                      {msg.role === "assistant" && msg.content === "" && isStreaming ? (
                        <div className="flex items-center gap-2 text-[#666]">
                          <IconLoader2 className="size-3.5 animate-spin" />
                          <span className="text-xs">Thinking...</span>
                        </div>
                      ) : msg.role === "assistant" ? (
                        <div className="break-words">
                          <MarkdownContent content={msg.content} />
                        </div>
                      ) : (
                        <div className="whitespace-pre-wrap break-words">
                          {msg.content}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-white/[0.08] bg-[#0c0c0c] px-3 py-3">
            <div className="flex items-end gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about Octopus..."
                rows={1}
                disabled={isStreaming}
                className="max-h-20 flex-1 resize-none bg-transparent text-base text-white placeholder-[#555] outline-none disabled:opacity-50 sm:text-sm"
                style={{
                  height: "auto",
                  minHeight: "20px",
                }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = "auto";
                  target.style.height = `${Math.min(target.scrollHeight, 80)}px`;
                }}
              />
              <button
                onClick={() => sendMessage(input)}
                disabled={!input.trim() || isStreaming}
                className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-[#10D8BE] text-[#0c0c0c] transition-opacity disabled:opacity-30"
              >
                {isStreaming ? (
                  <IconLoader2 className="size-3.5 animate-spin" />
                ) : (
                  <IconSend className="size-3.5" />
                )}
              </button>
            </div>
            <p className="mt-1.5 text-center text-[10px] text-[#444]">
              Powered by Octopus docs. Answers may not always be accurate.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
