"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { getPubbyClient } from "@/lib/pubby-client";

type Conversation = {
  id: string;
  title: string;
  updatedAt: string;
  isShared?: boolean;
  userId?: string;
  user?: { name: string; image?: string | null };
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  userId?: string | null;
  userName?: string | null;
};

type WindowSize = { width: number; height: number };
type WindowPosition = { x: number; y: number };

type ConnectedAgent = {
  id: string;
  name: string;
  repos: string[];
  capabilities: string[];
};

type ChatContextValue = {
  isOpen: boolean;
  toggle: () => void;
  open: () => void;
  close: () => void;
  conversations: Conversation[];
  activeConversationId: string | null;
  messages: Message[];
  loadConversations: () => Promise<void>;
  createNewChat: () => void;
  selectConversation: (id: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  shareConversation: (id: string) => Promise<void>;
  unshareConversation: (id: string) => Promise<void>;
  isSending: boolean;
  stopGeneration: () => void;
  streamingContent: string;
  lastUsage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; totalTokens: number; maxContextTokens: number; remainingTokens: number } | null;
  windowSize: WindowSize;
  setWindowSize: (size: WindowSize) => void;
  windowPosition: WindowPosition;
  setWindowPosition: (pos: WindowPosition) => void;
  isMaximized: boolean;
  toggleMaximize: () => void;
  isSharedChat: boolean;
  currentUserId: string;
  currentUserName: string;
  typingUsers: string[];
  queuePosition: number | null;
  connectedAgents: ConnectedAgent[];
  lastMessageAgentUsed: boolean;
  openWithRepoContext: (repoFullName: string) => void;
};

const ChatContext = createContext<ChatContextValue | null>(null);

const SIZE_STORAGE_KEY = "octopus-chat-window-size";
const POS_STORAGE_KEY = "octopus-chat-window-pos";
const DEFAULT_SIZE: WindowSize = { width: 480, height: 600 };

function getDefaultPosition(): WindowPosition {
  if (typeof window === "undefined") return { x: 0, y: 0 };
  return {
    x: window.innerWidth - DEFAULT_SIZE.width - 16,
    y: window.innerHeight - DEFAULT_SIZE.height - 16,
  };
}

function loadStored<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = localStorage.getItem(key);
    if (stored) return JSON.parse(stored);
  } catch {}
  return fallback;
}

export function ChatProvider({
  children,
  orgId,
  userId,
  userName,
}: {
  children: ReactNode;
  orgId: string;
  userId: string;
  userName: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [lastUsage, setLastUsage] = useState<ChatContextValue["lastUsage"]>(null);
  const [windowSize, setWindowSizeState] = useState<WindowSize>(DEFAULT_SIZE);
  const [windowPosition, setWindowPositionState] = useState<WindowPosition>({ x: 0, y: 0 });
  const [isMaximized, setIsMaximized] = useState(false);
  const [preMaxState, setPreMaxState] = useState<{ size: WindowSize; pos: WindowPosition } | null>(null);
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [typingUsersMap, setTypingUsersMap] = useState<Map<string, { name: string; timeout: NodeJS.Timeout }>>(new Map());
  // Track which conversation the current stream belongs to
  const [streamingConversationId, setStreamingConversationId] = useState<string | null>(null);
  // Local agent state
  const [connectedAgents, setConnectedAgents] = useState<ConnectedAgent[]>([]);
  const [lastMessageAgentUsed, setLastMessageAgentUsed] = useState(false);

  // Track which conversation is currently subscribed to pubby
  const pubbyChannelRef = useRef<string | null>(null);
  // Abort controller for active SSE stream — cancel on conversation switch
  const streamAbortRef = useRef<AbortController | null>(null);

  // Determine if active conversation is shared
  const activeConversation = conversations.find((c) => c.id === activeConversationId);
  const isSharedChat = activeConversation?.isShared ?? false;

  const typingUsers = Array.from(typingUsersMap.values()).map((v) => v.name);

  useEffect(() => {
    setWindowSizeState(loadStored(SIZE_STORAGE_KEY, DEFAULT_SIZE));
    setWindowPositionState(loadStored(POS_STORAGE_KEY, getDefaultPosition()));
  }, []);

  const setWindowSize = useCallback((size: WindowSize) => {
    setWindowSizeState(size);
    try {
      localStorage.setItem(SIZE_STORAGE_KEY, JSON.stringify(size));
    } catch {}
  }, []);

  const setWindowPosition = useCallback((pos: WindowPosition) => {
    setWindowPositionState(pos);
    try {
      localStorage.setItem(POS_STORAGE_KEY, JSON.stringify(pos));
    } catch {}
  }, []);

  const toggle = useCallback(() => setIsOpen((p) => !p), []);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  const toggleMaximize = useCallback(() => {
    if (isMaximized) {
      if (preMaxState) {
        setWindowSizeState(preMaxState.size);
        setWindowPositionState(preMaxState.pos);
      }
      setIsMaximized(false);
    } else {
      setPreMaxState({ size: windowSize, pos: windowPosition });
      setWindowSizeState({ width: window.innerWidth, height: window.innerHeight });
      setWindowPositionState({ x: 0, y: 0 });
      setIsMaximized(true);
    }
  }, [isMaximized, preMaxState, windowSize, windowPosition]);

  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch(`/api/chat/conversations?orgId=${orgId}`);
      if (res.ok) {
        const data = await res.json();
        setConversations(data);
      }
    } catch {}
  }, [orgId]);

  useEffect(() => {
    if (isOpen) {
      loadConversations();
    }
  }, [isOpen, loadConversations]);

  // Pubby subscription for shared chats
  useEffect(() => {
    if (!activeConversationId || !isSharedChat) {
      // Unsubscribe from previous channel
      if (pubbyChannelRef.current) {
        try {
          const pubbyClient = getPubbyClient();
          pubbyClient.unsubscribe(pubbyChannelRef.current);
        } catch {}
        pubbyChannelRef.current = null;
      }
      return;
    }

    const channelName = `presence-chat-${activeConversationId}`;

    // Already subscribed to this channel
    if (pubbyChannelRef.current === channelName) return;

    // Unsubscribe from previous
    if (pubbyChannelRef.current) {
      try {
        const pubbyClient = getPubbyClient();
        pubbyClient.unsubscribe(pubbyChannelRef.current);
      } catch {}
    }

    const pubbyClient = getPubbyClient();
    const channel = pubbyClient.subscribe(channelName);
    pubbyChannelRef.current = channelName;

    channel.bind("chat-message", (raw: unknown) => {
      const data = raw as { id: string; role: string; content: string; userId: string; userName: string };
      // Skip own messages (already added locally)
      if (data.userId === userId) return;
      setMessages((prev) => {
        // Prevent duplicates
        if (prev.some((m) => m.id === data.id)) return prev;
        return [...prev, {
          id: data.id,
          role: data.role as "user" | "assistant",
          content: data.content,
          createdAt: new Date().toISOString(),
          userId: data.userId,
          userName: data.userName,
        }];
      });
    });

    channel.bind("chat-stream-start", () => {
      setIsSending(true);
    });

    channel.bind("chat-stream-delta", (raw: unknown) => {
      const data = raw as { text: string };
      setStreamingContent((prev) => prev + data.text);
    });

    channel.bind("chat-message-complete", (raw: unknown) => {
      const data = raw as { id: string; role: string; content: string };
      setStreamingContent("");
      setMessages((prev) => {
        if (prev.some((m) => m.id === data.id)) return prev;
        return [...prev, {
          id: data.id,
          role: data.role as "user" | "assistant",
          content: data.content,
          createdAt: new Date().toISOString(),
        }];
      });
      setIsSending(false);
    });

    channel.bind("chat-queue-update", (raw: unknown) => {
      const data = raw as { queueLength: number; nextUserId: string };
      // If I have a queued message, calculate my position
      if (data.nextUserId === userId) {
        setQueuePosition(null);
      } else {
        setQueuePosition(data.queueLength);
      }
    });

    channel.bind("chat-title-update", (raw: unknown) => {
      const data = raw as { title: string };
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeConversationId ? { ...c, title: data.title } : c,
        ),
      );
    });

    channel.bind("chat-typing", (raw: unknown) => {
      const data = raw as { userId: string; userName: string };
      if (data.userId === userId) return;
      setTypingUsersMap((prev) => {
        const next = new Map(prev);
        const existing = next.get(data.userId);
        if (existing) clearTimeout(existing.timeout);
        const timeout = setTimeout(() => {
          setTypingUsersMap((p) => {
            const n = new Map(p);
            n.delete(data.userId);
            return n;
          });
        }, 3000);
        next.set(data.userId, { name: data.userName, timeout });
        return next;
      });
    });

    return () => {
      try {
        pubbyClient.unsubscribe(channelName);
      } catch {}
      pubbyChannelRef.current = null;
      // Clear typing timeouts
      setTypingUsersMap((prev) => {
        prev.forEach((v) => clearTimeout(v.timeout));
        return new Map();
      });
    };
  }, [activeConversationId, isSharedChat, userId]);

  // Subscribe to org channel for chat-shared and agent events
  useEffect(() => {
    const pubbyClient = getPubbyClient();
    const orgChannel = pubbyClient.subscribe(`presence-org-${orgId}`);
    orgChannel.bind("chat-shared", () => {
      loadConversations();
    });
    orgChannel.bind("agent-online", (raw: unknown) => {
      const data = raw as { agentId: string; name: string; repos: string[]; capabilities: string[] };
      setConnectedAgents((prev) => {
        if (prev.some((a) => a.id === data.agentId)) return prev;
        return [...prev, { id: data.agentId, name: data.name, repos: data.repos, capabilities: data.capabilities }];
      });
    });
    orgChannel.bind("agent-offline", (raw: unknown) => {
      const data = raw as { agentId: string };
      setConnectedAgents((prev) => prev.filter((a) => a.id !== data.agentId));
    });
    return () => {
      try {
        pubbyClient.unsubscribe(`presence-org-${orgId}`);
      } catch {}
    };
  }, [orgId, loadConversations]);

  // Fetch connected agents on mount and periodically
  useEffect(() => {
    const fetchAgents = async () => {
      try {
        const res = await fetch(`/api/agent/status?orgId=${orgId}`);
        if (res.ok) {
          const data = await res.json();
          setConnectedAgents(
            data.agents.map((a: { id: string; name: string; repoFullNames: string[]; capabilities: string[] }) => ({
              id: a.id,
              name: a.name,
              repos: a.repoFullNames,
              capabilities: a.capabilities,
            })),
          );
        }
      } catch {}
    };
    fetchAgents();
    const interval = setInterval(fetchAgents, 30_000);
    return () => clearInterval(interval);
  }, [orgId]);

  const createNewChat = useCallback(() => {
    // Abort any active stream
    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
      streamAbortRef.current = null;
    }
    setActiveConversationId(null);
    setMessages([]);
    setStreamingContent("");
    setStreamingConversationId(null);
    setQueuePosition(null);
    setIsSending(false);
  }, []);

  const pendingRepoMessageRef = useRef<string | null>(null);

  const openWithRepoContext = useCallback(
    (repoFullName: string) => {
      // Reset to new chat state
      if (streamAbortRef.current) {
        streamAbortRef.current.abort();
        streamAbortRef.current = null;
      }
      setActiveConversationId(null);
      setMessages([]);
      setStreamingContent("");
      setStreamingConversationId(null);
      setQueuePosition(null);
      setIsSending(false);
      // Open the chat window and queue the initial message
      setIsOpen(true);
      pendingRepoMessageRef.current = `Tell me about the ${repoFullName} repository. Give me an overview of its purpose, architecture, tech stack, recent activity, and any notable patterns or issues you can find.`;
    },
    [],
  );

  // Send the pending repo message once state is reset
  useEffect(() => {
    if (pendingRepoMessageRef.current && !isSending && !activeConversationId && messages.length === 0) {
      const msg = pendingRepoMessageRef.current;
      pendingRepoMessageRef.current = null;
      sendMessage(msg);
    }
  }, [isSending, activeConversationId, messages.length, sendMessage]);

  const selectConversation = useCallback(
    async (id: string) => {
      // Abort any active stream when switching conversations
      if (streamAbortRef.current) {
        streamAbortRef.current.abort();
        streamAbortRef.current = null;
      }
      setActiveConversationId(id);
      setStreamingContent("");
      setStreamingConversationId(null);
      setQueuePosition(null);
      setIsSending(false);
      try {
        const res = await fetch(`/api/chat/conversations/${id}?orgId=${orgId}`);
        if (res.ok) {
          const data = await res.json();
          setMessages(data.messages);
        }
      } catch {}
    },
    [orgId],
  );

  const deleteConversation = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/chat/conversations/${id}?orgId=${orgId}`, {
          method: "DELETE",
        });
        if (res.ok) {
          setConversations((prev) => prev.filter((c) => c.id !== id));
          if (activeConversationId === id) {
            setActiveConversationId(null);
            setMessages([]);
          }
        }
      } catch {}
    },
    [orgId, activeConversationId],
  );

  const renameConversation = useCallback(
    async (id: string, title: string) => {
      try {
        const res = await fetch(`/api/chat/conversations/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, orgId }),
        });
        if (res.ok) {
          setConversations((prev) =>
            prev.map((c) => (c.id === id ? { ...c, title } : c)),
          );
        }
      } catch {}
    },
    [orgId],
  );

  const shareConversation = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/chat/conversations/${id}/share`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orgId }),
        });
        if (res.ok) {
          setConversations((prev) =>
            prev.map((c) => (c.id === id ? { ...c, isShared: true } : c)),
          );
        }
      } catch {}
    },
    [orgId],
  );

  const unshareConversation = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/chat/conversations/${id}/share`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orgId }),
        });
        if (res.ok) {
          setConversations((prev) =>
            prev.map((c) => (c.id === id ? { ...c, isShared: false } : c)),
          );
        }
      } catch {}
    },
    [orgId],
  );

  const sendMessage = useCallback(
    async (content: string) => {
      if (isSending || !content.trim()) return;

      setIsSending(true);
      setStreamingContent("");
      setQueuePosition(null);
      setLastMessageAgentUsed(false);

      const userMsg: Message = {
        id: `temp-${Date.now()}`,
        role: "user",
        content: content.trim(),
        createdAt: new Date().toISOString(),
        userId,
        userName,
      };
      setMessages((prev) => [...prev, userMsg]);

      // Create abort controller for this stream
      const abortController = new AbortController();
      streamAbortRef.current = abortController;

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: content.trim(),
            conversationId: activeConversationId,
            orgId,
          }),
          signal: abortController.signal,
        });

        if (!res.ok || !res.body) {
          // Check if response is JSON (queued)
          const contentType = res.headers.get("Content-Type") ?? "";
          if (contentType.includes("application/json")) {
            const data = await res.json();
            if (data.queued) {
              setQueuePosition(data.position);
              setIsSending(false);
              return;
            }
          }
          throw new Error("Failed to send message");
        }

        // Check if response is JSON (queued for shared chats)
        const contentType = res.headers.get("Content-Type") ?? "";
        if (contentType.includes("application/json")) {
          const data = await res.json();
          if (data.queued) {
            setQueuePosition(data.position);
            setIsSending(false);
            // For new conversations, set the ID
            if (data.conversationId) {
              setActiveConversationId(data.conversationId);
            }
            return;
          }
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let fullContent = "";
        let newConversationId = activeConversationId;

        // Track which conversation this stream belongs to
        setStreamingConversationId(newConversationId);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6);

            if (data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data);
              if (parsed.type === "conversation_id") {
                newConversationId = parsed.id;
                setActiveConversationId(parsed.id);
                setStreamingConversationId(parsed.id);
              } else if (parsed.type === "agent_used") {
                setLastMessageAgentUsed(true);
              } else if (parsed.type === "delta") {
                fullContent += parsed.text;
                setStreamingContent(fullContent);
              } else if (parsed.type === "usage") {
                setLastUsage({
                  inputTokens: parsed.inputTokens,
                  outputTokens: parsed.outputTokens,
                  cacheReadTokens: parsed.cacheReadTokens,
                  totalTokens: parsed.totalTokens,
                  maxContextTokens: parsed.maxContextTokens,
                  remainingTokens: parsed.remainingTokens,
                });
              } else if (parsed.type === "title") {
                setConversations((prev) =>
                  prev.map((c) =>
                    c.id === newConversationId ? { ...c, title: parsed.title } : c,
                  ),
                );
              }
            } catch {}
          }
        }

        if (fullContent) {
          setMessages((prev) => [
            ...prev,
            {
              id: `assistant-${Date.now()}`,
              role: "assistant",
              content: fullContent,
              createdAt: new Date().toISOString(),
            },
          ]);
          setStreamingContent("");
          setStreamingConversationId(null);
        }

        await loadConversations();
      } catch (err) {
        // Don't show error if we aborted intentionally
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        setMessages((prev) => [
          ...prev,
          {
            id: `error-${Date.now()}`,
            role: "assistant",
            content: "Sorry, there was an error processing your message. Please try again.",
            createdAt: new Date().toISOString(),
          },
        ]);
      } finally {
        // Only clear isSending if this is still the active abort controller
        if (streamAbortRef.current === abortController) {
          streamAbortRef.current = null;
          setIsSending(false);
        }
      }
    },
    [isSending, activeConversationId, orgId, userId, userName, loadConversations],
  );

  const stopGeneration = useCallback(() => {
    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
      streamAbortRef.current = null;
      setIsSending(false);
      // Keep whatever was streamed so far as the assistant message
      setStreamingContent((prev) => {
        if (prev) {
          setMessages((msgs) => [
            ...msgs,
            {
              id: `stopped-${Date.now()}`,
              role: "assistant",
              content: prev,
              createdAt: new Date().toISOString(),
            },
          ]);
        }
        return "";
      });
      setStreamingConversationId(null);
    }
  }, []);

  return (
    <ChatContext.Provider
      value={{
        isOpen,
        toggle,
        open,
        close,
        conversations,
        activeConversationId,
        messages,
        loadConversations,
        createNewChat,
        selectConversation,
        sendMessage,
        deleteConversation,
        renameConversation,
        shareConversation,
        unshareConversation,
        isSending,
        stopGeneration,
        streamingContent: streamingConversationId === activeConversationId || streamingConversationId === null
          ? streamingContent
          : "",
        lastUsage,
        windowSize,
        setWindowSize,
        windowPosition,
        setWindowPosition,
        isMaximized,
        toggleMaximize,
        isSharedChat,
        currentUserId: userId,
        currentUserName: userName,
        typingUsers,
        queuePosition,
        connectedAgents,
        lastMessageAgentUsed,
        openWithRepoContext,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used within ChatProvider");
  return ctx;
}
