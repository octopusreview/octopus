"use client";

import { useRef, useState, useEffect, useCallback, memo, type KeyboardEvent } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { MermaidDiagram } from "@/components/mermaid-diagram";
import { useChat } from "@/components/chat-provider";
import { Button } from "@/components/ui/button";
import {
  IconX,
  IconPlus,
  IconSend,
  IconMessageChatbot,
  IconLoader2,
  IconLayoutSidebar,
  IconGripHorizontal,
  IconMaximize,
  IconMinimize,
  IconTrash,
  IconPencil,
  IconCheck,
  IconDots,
  IconArrowLeft,
  IconClock,
  IconShare,
  IconShareOff,
  IconUsers,
  IconArrowDown,
  IconPlayerStop,
  IconCpu,
} from "@tabler/icons-react";

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [breakpoint]);
  return isMobile;
}

const MIN_W = 360;
const MIN_H = 400;
const MAX_W = 800;
const MAX_H = 800;
const MIN_SIDEBAR_W = 140;
const MAX_SIDEBAR_W = 320;
const SIDEBAR_STORAGE_KEY = "octopus-chat-sidebar-w";

type InteractionMode =
  | { type: "idle" }
  | {
      type: "drag";
      startMouseX: number;
      startMouseY: number;
      startPosX: number;
      startPosY: number;
    }
  | {
      type: "resize";
      edge: "nw" | "n" | "w" | "ne" | "e" | "sw" | "s" | "se";
      startMouseX: number;
      startMouseY: number;
      startW: number;
      startH: number;
      startPosX: number;
      startPosY: number;
    }
  | {
      type: "sidebar-resize";
      startMouseX: number;
      startW: number;
    };

export function FloatingChat() {
  const {
    isOpen,
    close,
    conversations,
    activeConversationId,
    messages,
    createNewChat,
    selectConversation,
    sendMessage,
    deleteConversation,
    renameConversation,
    shareConversation,
    unshareConversation,
    isSending,
    stopGeneration,
    streamingContent,
    windowSize,
    setWindowSize,
    windowPosition,
    setWindowPosition,
    isMaximized,
    toggleMaximize,
    isSharedChat,
    currentUserId,
    currentUserName,
    typingUsers,
    queuePosition,
    lastUsage,
    connectedAgents,
    lastMessageAgentUsed,
  } = useChat();

  const isMobile = useIsMobile();
  const [input, setInput] = useState("");
  const [showSidebar, setShowSidebar] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(200);
  const [contextMenuId, setContextMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [mobileShowHistory, setMobileShowHistory] = useState(false);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const modeRef = useRef<InteractionMode>({ type: "idle" });
  const typingDebounceRef = useRef<NodeJS.Timeout | null>(null);

  // Load stored sidebar width
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY);
      if (stored) setSidebarWidth(Math.min(MAX_SIDEBAR_W, Math.max(MIN_SIDEBAR_W, parseInt(stored))));
    } catch {}
  }, []);

  // Auto-scroll to bottom (only if user hasn't scrolled up)
  useEffect(() => {
    if (!userScrolledUp) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, streamingContent, userScrolledUp]);

  // Handle scroll to detect if user scrolled up
  const handleMessagesScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const threshold = 100;
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
    setUserScrolledUp(!isAtBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    setUserScrolledUp(false);
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Focus textarea when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Focus rename input
  useEffect(() => {
    if (renamingId) {
      setTimeout(() => renameInputRef.current?.focus(), 50);
    }
  }, [renamingId]);

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenuId) return;
    const handler = () => setContextMenuId(null);
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [contextMenuId]);

  // Typing indicator — send typing event for shared chats
  const sendTypingEvent = useCallback(() => {
    if (!isSharedChat || !activeConversationId) return;
    fetch("/api/pubby/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: `presence-chat-${activeConversationId}`,
        event: "chat-typing",
        data: { userId: currentUserId, userName: currentUserName },
      }),
    }).catch(() => {});
  }, [isSharedChat, activeConversationId, currentUserId, currentUserName]);

  const handleInputChange = useCallback(
    (value: string) => {
      setInput(value);
      if (value && isSharedChat) {
        if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current);
        typingDebounceRef.current = setTimeout(sendTypingEvent, 300);
      }
    },
    [isSharedChat, sendTypingEvent],
  );

  // --- Drag ---
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest("button")) return;
      e.preventDefault();
      modeRef.current = {
        type: "drag",
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startPosX: windowPosition.x,
        startPosY: windowPosition.y,
      };
    },
    [windowPosition],
  );

  // --- Resize ---
  const handleResizeStart = useCallback(
    (edge: "nw" | "n" | "w" | "ne" | "e" | "sw" | "s" | "se", e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      modeRef.current = {
        type: "resize",
        edge,
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startW: windowSize.width,
        startH: windowSize.height,
        startPosX: windowPosition.x,
        startPosY: windowPosition.y,
      };
    },
    [windowSize, windowPosition],
  );

  // --- Sidebar resize ---
  const handleSidebarResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      modeRef.current = {
        type: "sidebar-resize",
        startMouseX: e.clientX,
        startW: sidebarWidth,
      };
    },
    [sidebarWidth],
  );

  // Global mousemove / mouseup
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const m = modeRef.current;
      if (m.type === "idle") return;

      if (m.type === "drag") {
        const dx = e.clientX - m.startMouseX;
        const dy = e.clientY - m.startMouseY;
        setWindowPosition({
          x: Math.max(0, Math.min(window.innerWidth - 100, m.startPosX + dx)),
          y: Math.max(0, Math.min(window.innerHeight - 40, m.startPosY + dy)),
        });
        return;
      }

      if (m.type === "resize") {
        const dx = e.clientX - m.startMouseX;
        const dy = e.clientY - m.startMouseY;
        let newW = m.startW;
        let newH = m.startH;
        let newX = m.startPosX;
        let newY = m.startPosY;

        if (m.edge.includes("w")) {
          newW = Math.min(MAX_W, Math.max(MIN_W, m.startW - dx));
          newX = m.startPosX + (m.startW - newW);
        } else if (m.edge.includes("e")) {
          newW = Math.min(MAX_W, Math.max(MIN_W, m.startW + dx));
        }
        if (m.edge.includes("n")) {
          newH = Math.min(MAX_H, Math.max(MIN_H, m.startH - dy));
          newY = m.startPosY + (m.startH - newH);
        } else if (m.edge.includes("s")) {
          newH = Math.min(MAX_H, Math.max(MIN_H, m.startH + dy));
        }

        setWindowSize({ width: newW, height: newH });
        setWindowPosition({ x: newX, y: newY });
        return;
      }

      if (m.type === "sidebar-resize") {
        const dx = e.clientX - m.startMouseX;
        const newW = Math.min(MAX_SIDEBAR_W, Math.max(MIN_SIDEBAR_W, m.startW + dx));
        setSidebarWidth(newW);
        return;
      }
    };

    const handleMouseUp = () => {
      // Persist sidebar width
      if (modeRef.current.type === "sidebar-resize") {
        try { localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarWidth)); } catch {}
      }
      modeRef.current = { type: "idle" };
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [setWindowSize, setWindowPosition, sidebarWidth]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (input.trim() && !isSending) {
        setUserScrolledUp(false);
        sendMessage(input);
        setInput("");
      }
    }
  };

  const handleSend = () => {
    if (input.trim() && !isSending) {
      setUserScrolledUp(false);
      sendMessage(input);
      setInput("");
    }
  };

  const handleRenameSubmit = (id: string) => {
    if (renameValue.trim()) {
      renameConversation(id, renameValue.trim());
    }
    setRenamingId(null);
  };

  if (!isOpen) return null;

  const allMessages = [
    ...messages,
    ...(streamingContent
      ? [
          {
            id: "streaming",
            role: "assistant" as const,
            content: streamingContent,
            createdAt: new Date().toISOString(),
          },
        ]
      : []),
  ];

  // Show typing indicator when sending but no streaming content yet
  const showTyping = isSending && !streamingContent && allMessages[allMessages.length - 1]?.role === "user";

  // Split conversations into my chats and team chats
  const myChats = conversations.filter((c) => c.userId === currentUserId);
  const teamChats = conversations.filter((c) => c.isShared && c.userId !== currentUserId);

  // Can the current user share/unshare the active conversation?
  const activeConv = conversations.find((c) => c.id === activeConversationId);
  const isOwnChat = activeConv?.userId === currentUserId;

  const HANDLE = 6;

  // Shared message rendering helper
  const renderMessage = (msg: typeof allMessages[number]) => {
    const isOwnMessage = !msg.userId || msg.userId === currentUserId;
    const isUserMsg = msg.role === "user";
    const showSenderName = isSharedChat && isUserMsg && msg.userName;

    return (
      <div
        key={msg.id}
        className={cn("mb-3", isUserMsg ? (isOwnMessage ? "flex justify-end" : "flex justify-start") : "")}
      >
        <div
          className={cn(
            "max-w-[85%] rounded-lg px-3 py-2 text-sm",
            isUserMsg
              ? isOwnMessage
                ? "bg-primary text-primary-foreground"
                : "bg-blue-100 text-blue-900 dark:bg-blue-900/30 dark:text-blue-100"
              : "bg-muted",
          )}
        >
          {showSenderName && (
            <p className="text-[10px] text-muted-foreground mb-0.5">
              {isOwnMessage ? "You" : msg.userName}
            </p>
          )}
          {msg.role === "assistant" ? (
            <div className="prose prose-sm dark:prose-invert max-w-none [&_h1]:mt-4 [&_h1]:mb-2 [&_h2]:mt-3 [&_h2]:mb-1.5 [&_h3]:mt-2.5 [&_h3]:mb-1 [&_h4]:mt-2 [&_h4]:mb-1 [&_p]:my-1.5 [&_p]:leading-relaxed [&_ul]:my-1.5 [&_ol]:my-1.5 [&_li]:my-0.5 [&_blockquote]:my-2 [&_hr]:my-3 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-background/50 [&_pre]:p-2 [&_pre]:text-xs [&_code]:rounded [&_code]:bg-background/50 [&_code]:px-1 [&_code]:text-xs">
              <MessageContent content={msg.content} isStreaming={msg.id === "streaming"} />
            </div>
          ) : (
            <span className="whitespace-pre-wrap">{msg.content}</span>
          )}
          {msg.id === "streaming" && (
            <span className="ml-1 inline-block animate-pulse">|</span>
          )}
        </div>
      </div>
    );
  };

  // Conversation item for sidebar/history
  const renderConversationItem = (c: typeof conversations[number], showOwner = false) => (
    <div
      key={c.id}
      className={cn(
        "group relative flex items-center transition-colors hover:bg-muted",
        c.id === activeConversationId && "bg-muted",
      )}
    >
      {renamingId === c.id ? (
        <div className="flex w-full items-center gap-1 px-2 py-1.5">
          <input
            ref={renameInputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRenameSubmit(c.id);
              if (e.key === "Escape") setRenamingId(null);
            }}
            className="min-w-0 flex-1 rounded border bg-background px-1.5 py-0.5 text-xs outline-none focus:ring-1 focus:ring-ring"
          />
          <button onClick={() => handleRenameSubmit(c.id)} className="shrink-0 text-muted-foreground hover:text-foreground">
            <IconCheck className="size-3" />
          </button>
        </div>
      ) : (
        <>
          <button
            onClick={() => selectConversation(c.id)}
            className={cn(
              "min-w-0 flex-1 truncate px-3 py-2 text-left text-xs",
              c.id === activeConversationId && "font-medium",
            )}
          >
            <span className="flex items-center gap-1">
              {c.isShared && <IconUsers className="size-3 shrink-0 text-muted-foreground" />}
              <span className="truncate">{c.title}</span>
            </span>
            {showOwner && c.user?.name && (
              <span className="block truncate text-[10px] text-muted-foreground">{c.user.name}</span>
            )}
          </button>
          {c.userId === currentUserId && (
            <div className="relative shrink-0 pr-1 opacity-0 group-hover:opacity-100">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setContextMenuId(contextMenuId === c.id ? null : c.id);
                }}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted-foreground/10 hover:text-foreground"
              >
                <IconDots className="size-3" />
              </button>
              {contextMenuId === c.id && (
                <div
                  className="absolute right-0 top-full z-30 mt-1 w-32 rounded-md border bg-popover py-1 shadow-lg"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => {
                      setRenamingId(c.id);
                      setRenameValue(c.title);
                      setContextMenuId(null);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted"
                  >
                    <IconPencil className="size-3" />
                    Rename
                  </button>
                  <button
                    onClick={() => {
                      deleteConversation(c.id);
                      setContextMenuId(null);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-destructive hover:bg-muted"
                  >
                    <IconTrash className="size-3" />
                    Delete
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );

  // ===================== MOBILE: Full-screen Claude-style layout =====================
  if (isMobile) {
    // History view (conversation list)
    if (mobileShowHistory) {
      return (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          {/* Mobile history header */}
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <Button variant="ghost" size="icon-xs" onClick={() => setMobileShowHistory(false)}>
              <IconArrowLeft className="size-4" />
            </Button>
            <span className="flex-1 text-base font-medium">Conversations</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                createNewChat();
                setMobileShowHistory(false);
              }}
              className="gap-1 text-xs"
              title="New Chat"
            >
              <IconPlus className="size-3.5" /> New Chat
            </Button>
          </div>

          {/* Conversation list */}
          <div className="flex-1 overflow-y-auto">
            {/* My Chats */}
            <div className="border-b px-4 py-2 text-xs font-medium text-muted-foreground">My Chats</div>
            {myChats.map((c) => (
              <div
                key={c.id}
                className={cn(
                  "group relative flex items-center border-b transition-colors active:bg-muted",
                  c.id === activeConversationId && "bg-muted/60",
                )}
              >
                {renamingId === c.id ? (
                  <div className="flex w-full items-center gap-2 px-4 py-3">
                    <input
                      ref={renameInputRef}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRenameSubmit(c.id);
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-ring"
                    />
                    <button onClick={() => handleRenameSubmit(c.id)} className="text-muted-foreground active:text-foreground">
                      <IconCheck className="size-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        selectConversation(c.id);
                        setMobileShowHistory(false);
                      }}
                      className="min-w-0 flex-1 px-4 py-3 text-left"
                    >
                      <p className={cn("flex items-center gap-1 truncate text-sm", c.id === activeConversationId && "font-medium")}>
                        {c.isShared && <IconUsers className="size-3 shrink-0 text-muted-foreground" />}
                        {c.title}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {new Date(c.updatedAt).toLocaleDateString()}
                      </p>
                    </button>
                    <div className="flex shrink-0 items-center gap-1 pr-3">
                      <button
                        onClick={() => {
                          setRenamingId(c.id);
                          setRenameValue(c.title);
                        }}
                        className="rounded p-1.5 text-muted-foreground active:bg-muted-foreground/10"
                      >
                        <IconPencil className="size-3.5" />
                      </button>
                      <button
                        onClick={() => deleteConversation(c.id)}
                        className="rounded p-1.5 text-destructive active:bg-destructive/10"
                      >
                        <IconTrash className="size-3.5" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
            {myChats.length === 0 && (
              <div className="px-4 py-4 text-center text-xs text-muted-foreground">No chats yet</div>
            )}

            {/* Team Chats */}
            {teamChats.length > 0 && (
              <>
                <div className="border-b px-4 py-2 text-xs font-medium text-muted-foreground">Team Chats</div>
                {teamChats.map((c) => (
                  <div
                    key={c.id}
                    className={cn(
                      "group relative flex items-center border-b transition-colors active:bg-muted",
                      c.id === activeConversationId && "bg-muted/60",
                    )}
                  >
                    <button
                      onClick={() => {
                        selectConversation(c.id);
                        setMobileShowHistory(false);
                      }}
                      className="min-w-0 flex-1 px-4 py-3 text-left"
                    >
                      <p className={cn("flex items-center gap-1 truncate text-sm", c.id === activeConversationId && "font-medium")}>
                        <IconUsers className="size-3 shrink-0 text-muted-foreground" />
                        {c.title}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {c.user?.name ?? "Unknown"} &middot; {new Date(c.updatedAt).toLocaleDateString()}
                      </p>
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      );
    }

    // Chat view (full screen)
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-background">
        {/* Mobile chat header */}
        <div className="flex items-center gap-2 border-b px-3 py-2.5">
          <Button variant="ghost" size="icon-xs" onClick={() => setMobileShowHistory(true)} title="History">
            <IconClock className="size-4" />
          </Button>
          <IconMessageChatbot className="size-4 text-muted-foreground" />
          <span className="flex-1 truncate text-sm font-medium">Octopus Chat</span>
          {connectedAgents.length > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400" title={`${connectedAgents.length} local agent(s) connected`}>
              <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
              {connectedAgents.length}
            </span>
          )}
          {activeConversationId && isOwnChat && !isSharedChat && (
            <Button variant="ghost" size="icon-xs" onClick={() => shareConversation(activeConversationId)} title="Share with team">
              <IconShare className="size-3.5" />
            </Button>
          )}
          {activeConversationId && isOwnChat && isSharedChat && (
            <Button variant="ghost" size="icon-xs" onClick={() => unshareConversation(activeConversationId)} title="Unshare">
              <IconShareOff className="size-3.5" />
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={createNewChat} className="gap-1 text-xs" title="New Chat">
            <IconPlus className="size-3.5" /> New Chat
          </Button>
          <Button variant="ghost" size="icon-xs" onClick={close} title="Close">
            <IconX className="size-4" />
          </Button>
        </div>

        {/* Messages */}
        <div
          ref={messagesContainerRef}
          onScroll={handleMessagesScroll}
          className="relative flex-1 overflow-y-auto px-3 py-3"
        >
          {allMessages.length === 0 && !showTyping && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
              <IconMessageChatbot className="size-10 opacity-50" />
              <p className="text-sm">Ask anything about your codebase</p>
            </div>
          )}
          {allMessages.map(renderMessage)}

          {/* Token usage indicator + agent badge (mobile) */}
          {lastUsage && !streamingContent && allMessages.length > 0 && allMessages[allMessages.length - 1]?.role === "assistant" && (
            <div className="mb-2 flex items-center gap-2 justify-start px-1">
              {lastMessageAgentUsed && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-900/30 px-2 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-400">
                  <IconCpu className="size-2.5" />
                  Local agent
                </span>
              )}
              <div className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1 text-[10px] text-muted-foreground">
                <span>{(lastUsage.inputTokens / 1000).toFixed(1)}K in</span>
                <span className="text-muted-foreground/40">·</span>
                <span>{(lastUsage.outputTokens / 1000).toFixed(1)}K out</span>
                <span className="text-muted-foreground/40">·</span>
                <span className={lastUsage.remainingTokens < 30000 ? "text-orange-400" : ""}>
                  {(lastUsage.remainingTokens / 1000).toFixed(0)}K remaining
                </span>
              </div>
            </div>
          )}

          {showTyping && (
            <div className="mb-3">
              <div className="inline-flex items-center gap-1 rounded-lg bg-muted px-3 py-2">
                <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:0ms]" />
                <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:150ms]" />
                <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:300ms]" />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />

          {/* Scroll to bottom button */}
          {userScrolledUp && (
            <button
              onClick={scrollToBottom}
              className="sticky bottom-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 rounded-full border bg-background px-3 py-1.5 text-xs text-muted-foreground shadow-md hover:bg-muted"
            >
              <IconArrowDown className="size-3.5" />
              New messages
            </button>
          )}
        </div>

        {/* Typing indicator */}
        {typingUsers.length > 0 && (
          <div className="px-3 py-1 text-xs text-muted-foreground animate-pulse">
            {typingUsers.join(", ")} typing...
          </div>
        )}

        {/* Queue indicator */}
        {queuePosition != null && queuePosition > 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground bg-amber-50 dark:bg-amber-900/20">
            <IconLoader2 className="size-3.5 animate-spin" />
            Your message is #{queuePosition} in queue
          </div>
        )}

        {/* Mobile input */}
        <div className="border-t px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your code..."
              rows={1}
              className="max-h-24 min-h-[36px] flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
            {isSending ? (
              <Button size="icon-sm" onClick={stopGeneration} variant="destructive" title="Stop generating">
                <IconPlayerStop className="size-4" />
              </Button>
            ) : (
              <Button size="icon-sm" onClick={handleSend} disabled={!input.trim()}>
                <IconSend className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ===================== DESKTOP: Original floating window layout =====================
  return (
    <div
      className={cn(
        "fixed z-50 flex overflow-hidden border bg-background shadow-2xl",
        isMaximized ? "rounded-none" : "rounded-xl",
      )}
      style={
        isMaximized
          ? { inset: 0, width: "100%", height: "100%" }
          : {
              width: windowSize.width,
              height: windowSize.height,
              left: windowPosition.x,
              top: windowPosition.y,
            }
      }
    >
      {/* ---- Resize handles ---- */}
      {isMaximized ? null : <>
      <div className="absolute left-0 top-0 z-20 cursor-nw-resize" style={{ width: HANDLE * 2, height: HANDLE * 2 }} onMouseDown={(e) => handleResizeStart("nw", e)} />
      <div className="absolute top-0 z-20 cursor-n-resize" style={{ left: HANDLE * 2, right: HANDLE * 2, height: HANDLE }} onMouseDown={(e) => handleResizeStart("n", e)} />
      <div className="absolute right-0 top-0 z-20 cursor-ne-resize" style={{ width: HANDLE * 2, height: HANDLE * 2 }} onMouseDown={(e) => handleResizeStart("ne", e)} />
      <div className="absolute right-0 z-20 cursor-e-resize" style={{ top: HANDLE * 2, bottom: HANDLE * 2, width: HANDLE }} onMouseDown={(e) => handleResizeStart("e", e)} />
      <div className="absolute bottom-0 right-0 z-20 cursor-se-resize" style={{ width: HANDLE * 2, height: HANDLE * 2 }} onMouseDown={(e) => handleResizeStart("se", e)} />
      <div className="absolute bottom-0 z-20 cursor-s-resize" style={{ left: HANDLE * 2, right: HANDLE * 2, height: HANDLE }} onMouseDown={(e) => handleResizeStart("s", e)} />
      <div className="absolute bottom-0 left-0 z-20 cursor-sw-resize" style={{ width: HANDLE * 2, height: HANDLE * 2 }} onMouseDown={(e) => handleResizeStart("sw", e)} />
      <div className="absolute left-0 z-20 cursor-w-resize" style={{ top: HANDLE * 2, bottom: HANDLE * 2, width: HANDLE }} onMouseDown={(e) => handleResizeStart("w", e)} />
      </>}

      {/* Main chat area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header — draggable */}
        <div
          className={cn(
            "flex items-center gap-2 border-b px-3 py-2 select-none",
            !isMaximized && "cursor-grab active:cursor-grabbing",
          )}
          onMouseDown={isMaximized ? undefined : handleDragStart}
        >
          <Button variant="ghost" size="icon-xs" onClick={() => setShowSidebar((p) => !p)} title="Toggle conversations">
            <IconLayoutSidebar className="size-3.5" />
          </Button>
          <IconGripHorizontal className="size-3.5 text-muted-foreground/50" />
          <IconMessageChatbot className="size-4 text-muted-foreground" />
          <span className="flex-1 text-sm font-medium">Octopus Chat</span>
          {connectedAgents.length > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400" title={`${connectedAgents.length} local agent(s): ${connectedAgents.map((a) => a.name).join(", ")}`}>
              <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
              {connectedAgents.length} agent{connectedAgents.length > 1 ? "s" : ""}
            </span>
          )}
          {activeConversationId && isOwnChat && !isSharedChat && (
            <Button variant="ghost" size="icon-xs" onClick={() => shareConversation(activeConversationId)} title="Share with team">
              <IconShare className="size-3.5" />
            </Button>
          )}
          {activeConversationId && isOwnChat && isSharedChat && (
            <Button variant="ghost" size="icon-xs" onClick={() => unshareConversation(activeConversationId)} title="Unshare">
              <IconShareOff className="size-3.5" />
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={createNewChat} className="gap-1 text-xs" title="New Chat">
            <IconPlus className="size-3.5" /> New Chat
          </Button>
          <Button variant="ghost" size="icon-xs" onClick={toggleMaximize} title={isMaximized ? "Restore" : "Maximize"}>
            {isMaximized ? <IconMinimize className="size-3.5" /> : <IconMaximize className="size-3.5" />}
          </Button>
          <Button variant="ghost" size="icon-xs" onClick={close} title="Close">
            <IconX className="size-3.5" />
          </Button>
        </div>

        {/* Content area — relative container for sidebar overlay */}
        <div className="relative flex min-h-0 flex-1 flex-col">
          {/* Conversation sidebar — overlay */}
          {showSidebar && (
            <>
            {/* Backdrop — click to close */}
            <div className="absolute inset-0 z-20" onClick={() => setShowSidebar(false)} />
            <div className="absolute left-0 top-0 bottom-0 z-30 flex flex-col border-r bg-background shadow-lg" style={{ width: sidebarWidth }}>
              <div className="border-b px-3 py-2">
                <span className="text-xs font-medium text-muted-foreground">Conversations</span>
              </div>
              <div className="flex-1 overflow-y-auto">
                {/* My Chats */}
                <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">My Chats</div>
                {myChats.map((c) => renderConversationItem(c))}
                {myChats.length === 0 && (
                  <p className="px-3 py-2 text-center text-xs text-muted-foreground">No chats yet</p>
                )}

                {/* Team Chats */}
                {teamChats.length > 0 && (
                  <>
                    <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">Team Chats</div>
                    {teamChats.map((c) => renderConversationItem(c, true))}
                  </>
                )}
              </div>
              {/* Sidebar resize handle */}
              <div
                className="absolute right-0 top-0 bottom-0 z-10 w-1.5 cursor-col-resize hover:bg-primary/20"
                onMouseDown={handleSidebarResizeStart}
              />
            </div>
          </>
          )}

          {/* Messages */}
          <div
            ref={messagesContainerRef}
            onScroll={handleMessagesScroll}
            className="relative flex-1 overflow-y-auto px-3 py-3"
          >
            {allMessages.length === 0 && !showTyping && (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                <IconMessageChatbot className="size-8 opacity-50" />
                <p className="text-sm">Ask anything about your codebase</p>
              </div>
            )}
            {allMessages.map(renderMessage)}

            {/* Token usage indicator + agent badge — shown after last assistant message */}
            {lastUsage && !streamingContent && allMessages.length > 0 && allMessages[allMessages.length - 1]?.role === "assistant" && (
              <div className="mb-2 flex items-center gap-2 justify-start px-1">
                {lastMessageAgentUsed && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-900/30 px-2 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-400">
                    <IconCpu className="size-2.5" />
                    Local agent
                  </span>
                )}
                <div className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1 text-[10px] text-muted-foreground">
                  <span>{(lastUsage.inputTokens / 1000).toFixed(1)}K in</span>
                  <span className="text-muted-foreground/40">·</span>
                  <span>{(lastUsage.outputTokens / 1000).toFixed(1)}K out</span>
                  {lastUsage.cacheReadTokens > 0 && (
                    <>
                      <span className="text-muted-foreground/40">·</span>
                      <span>{(lastUsage.cacheReadTokens / 1000).toFixed(1)}K cached</span>
                    </>
                  )}
                  <span className="text-muted-foreground/40">·</span>
                  <span className={lastUsage.remainingTokens < 30000 ? "text-orange-400" : ""}>
                    {(lastUsage.remainingTokens / 1000).toFixed(0)}K remaining
                  </span>
                </div>
              </div>
            )}

            {/* Typing indicator (AI) */}
            {showTyping && (
              <div className="mb-3">
                <div className="inline-flex items-center gap-1 rounded-lg bg-muted px-3 py-2">
                  <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:0ms]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:150ms]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:300ms]" />
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />

            {/* Scroll to bottom button */}
            {userScrolledUp && (
              <button
                onClick={scrollToBottom}
                className="sticky bottom-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 rounded-full border bg-background px-3 py-1.5 text-xs text-muted-foreground shadow-md hover:bg-muted"
              >
                <IconArrowDown className="size-3.5" />
                New messages
              </button>
            )}
          </div>

          {/* Typing users indicator */}
          {typingUsers.length > 0 && (
            <div className="px-3 py-1 text-xs text-muted-foreground animate-pulse">
              {typingUsers.join(", ")} typing...
            </div>
          )}

          {/* Queue indicator */}
          {queuePosition != null && queuePosition > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground bg-amber-50 dark:bg-amber-900/20">
              <IconLoader2 className="size-3.5 animate-spin" />
              Your message is #{queuePosition} in queue
            </div>
          )}

          {/* Input */}
          <div className="border-t px-3 py-2">
            <div className="flex items-end gap-2">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => handleInputChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about your code..."
                rows={1}
                className="max-h-24 min-h-[36px] flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
              />
              {isSending ? (
                <Button size="icon-sm" onClick={stopGeneration} variant="destructive" title="Stop generating">
                  <IconPlayerStop className="size-4" />
                </Button>
              ) : (
                <Button size="icon-sm" onClick={handleSend} disabled={!input.trim()}>
                  <IconSend className="size-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const markdownComponents = {
  pre({ children, ...props }: React.ComponentProps<"pre"> & { children?: React.ReactNode }) {
    const child = Array.isArray(children) ? children[0] : children;
    if (
      child &&
      typeof child === "object" &&
      "props" in child &&
      (child as React.ReactElement<{ className?: string }>).props?.className === "language-mermaid"
    ) {
      const code = String((child as React.ReactElement<{ children?: React.ReactNode }>).props.children ?? "").replace(/\n$/, "");
      return <MermaidDiagram code={code} />;
    }
    return <pre className="overflow-x-auto rounded bg-background/50 p-2 text-xs">{children}</pre>;
  },
  code({ className, children, ...props }: React.ComponentProps<"code"> & { className?: string }) {
    const isBlock = className?.startsWith("language-");
    if (isBlock) {
      return <code className={className} {...props}>{children}</code>;
    }
    return (
      <code className="rounded bg-background/50 px-1 py-0.5 text-xs" {...props}>
        {children}
      </code>
    );
  },
  a({ href, children }: React.ComponentProps<"a">) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline">
        {children}
      </a>
    );
  },
  table({ children }: React.ComponentProps<"table">) {
    return (
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-xs">{children}</table>
      </div>
    );
  },
  th({ children }: React.ComponentProps<"th">) {
    return <th className="border border-border bg-muted px-2 py-1 text-left font-medium">{children}</th>;
  },
  td({ children }: React.ComponentProps<"td">) {
    return <td className="border border-border px-2 py-1">{children}</td>;
  },
};

const streamingMarkdownComponents = {
  ...markdownComponents,
  pre({ children, ...props }: React.ComponentProps<"pre"> & { children?: React.ReactNode }) {
    const child = Array.isArray(children) ? children[0] : children;
    if (
      child &&
      typeof child === "object" &&
      "props" in child &&
      (child as React.ReactElement<{ className?: string }>).props?.className === "language-mermaid"
    ) {
      return (
        <div className="flex items-center gap-2 rounded bg-background/50 p-4 text-xs text-muted-foreground">
          <IconLoader2 className="size-4 animate-spin" />
          Diyagram oluşturuluyor...
        </div>
      );
    }
    return <pre className="overflow-x-auto rounded bg-background/50 p-2 text-xs">{children}</pre>;
  },
};

function StreamingMessageContent({ content }: { content: string }) {
  const [displayedLength, setDisplayedLength] = useState(0);
  const targetLengthRef = useRef(content.length);
  const animFrameRef = useRef<number>(0);

  targetLengthRef.current = content.length;

  useEffect(() => {
    // Catch up animation — smoothly advances displayedLength toward content.length
    const step = () => {
      setDisplayedLength((prev) => {
        const target = targetLengthRef.current;
        if (prev >= target) return prev;
        // Accelerate based on gap — bigger gap = faster catch-up
        const gap = target - prev;
        const increment = Math.max(1, Math.ceil(gap * 0.35));
        return Math.min(prev + increment, target);
      });
      animFrameRef.current = requestAnimationFrame(step);
    };
    animFrameRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, []);

  const displayedContent = content.slice(0, displayedLength);

  return (
    <Markdown remarkPlugins={[remarkGfm]} components={streamingMarkdownComponents}>
      {displayedContent}
    </Markdown>
  );
}

const MessageContent = memo(function MessageContent({ content, isStreaming }: { content: string; isStreaming?: boolean }) {
  if (isStreaming) {
    return <StreamingMessageContent content={content} />;
  }

  return (
    <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {content}
    </Markdown>
  );
});
