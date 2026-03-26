"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconSearch, IconLoader2, IconFileText } from "@tabler/icons-react";

type SearchResult = {
  title: string;
  slug: string;
  excerpt: string | null;
};

export function BlogSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cmd+K shortcut
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 10);
    } else {
      setQuery("");
      setResults([]);
      setActiveIndex(0);
    }
  }, [open]);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/blog/search?q=${encodeURIComponent(q.trim())}`);
      if (res.ok) {
        const data = await res.json();
        setResults(data.posts ?? []);
        setActiveIndex(0);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  function handleQueryChange(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), 300);
  }

  function handleSelect(slug: string) {
    setOpen(false);
    router.push(`/blog/${slug}`);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results.length > 0) {
      e.preventDefault();
      handleSelect(results[activeIndex].slug);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex shrink-0 items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm text-[#555] transition-colors hover:border-white/[0.15] hover:bg-white/[0.05]"
      >
        <IconSearch className="size-3.5" />
        <span>Search</span>
        <kbd className="hidden rounded border border-white/[0.1] bg-white/[0.05] px-1.5 py-0.5 text-[10px] text-[#555] sm:inline-block">
          ⌘K
        </kbd>
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs animate-in fade-in-0 duration-100"
            onClick={() => setOpen(false)}
          />

          {/* Dialog */}
          <div className="fixed left-1/2 top-[20%] z-50 w-full max-w-lg -translate-x-1/2 animate-in fade-in-0 zoom-in-95 duration-100">
            <div className="rounded-xl border border-white/[0.1] bg-[#161616] shadow-2xl">
              {/* Input */}
              <div className="flex items-center gap-3 border-b border-white/[0.06] px-4">
                <IconSearch className="size-4 shrink-0 text-[#555]" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => handleQueryChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Search blog posts..."
                  className="flex-1 bg-transparent py-3.5 text-sm text-white placeholder-[#555] outline-none"
                />
                {loading && <IconLoader2 className="size-4 animate-spin text-[#555]" />}
              </div>

              {/* Results */}
              <div className="max-h-72 overflow-y-auto p-2">
                {!loading && query.trim() && results.length === 0 && (
                  <p className="py-6 text-center text-sm text-[#555]">No posts found.</p>
                )}

                {results.map((post, i) => (
                  <button
                    key={post.slug}
                    type="button"
                    onClick={() => handleSelect(post.slug)}
                    onMouseEnter={() => setActiveIndex(i)}
                    className={`flex w-full flex-col items-start gap-1 rounded-lg px-3 py-2.5 text-left transition-colors ${
                      i === activeIndex ? "bg-white/[0.06]" : ""
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <IconFileText className="size-4 shrink-0 text-[#555]" />
                      <span className="text-sm font-medium text-white">{post.title}</span>
                    </div>
                    {post.excerpt && (
                      <span className="pl-6 text-xs text-[#666] line-clamp-1">{post.excerpt}</span>
                    )}
                  </button>
                ))}

                {!loading && !query.trim() && (
                  <p className="py-6 text-center text-sm text-[#555]">
                    Start typing to search...
                  </p>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
