"use client";

import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function BlogContent({ content }: { content: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => (
          <h1 className="mb-4 mt-8 text-3xl font-bold first:mt-0">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="mb-3 mt-8 text-2xl font-semibold">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="mb-2 mt-6 text-xl font-semibold">{children}</h3>
        ),
        p: ({ children }) => (
          <p className="mb-4 leading-relaxed">{children}</p>
        ),
        ul: ({ children }) => (
          <ul className="mb-4 list-disc space-y-1 pl-6">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="mb-4 list-decimal space-y-1 pl-6">{children}</ol>
        ),
        li: ({ children }) => (
          <li className="leading-relaxed">{children}</li>
        ),
        a: ({ href, children }) => (
          <a
            href={href}
            target={href?.startsWith("http") ? "_blank" : undefined}
            rel={href?.startsWith("http") ? "noopener noreferrer" : undefined}
            className="text-primary underline underline-offset-4 hover:opacity-80"
          >
            {children}
          </a>
        ),
        blockquote: ({ children }) => (
          <blockquote className="mb-4 border-l-4 border-primary/30 pl-4 italic text-muted-foreground">
            {children}
          </blockquote>
        ),
        code: ({ className, children }) => {
          const isInline = !className;
          if (isInline) {
            return (
              <code className="rounded bg-muted px-1.5 py-0.5 text-sm font-mono">
                {children}
              </code>
            );
          }
          return (
            <code className={className}>{children}</code>
          );
        },
        pre: ({ children }) => (
          <pre className="mb-4 overflow-x-auto rounded-lg bg-muted p-4 text-sm">
            {children}
          </pre>
        ),
        img: ({ src, alt }) => (
          <img
            src={src}
            alt={alt ?? ""}
            className="mb-4 rounded-lg"
            loading="lazy"
          />
        ),
        table: ({ children }) => (
          <div className="mb-4 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              {children}
            </table>
          </div>
        ),
        th: ({ children }) => (
          <th className="border border-border px-3 py-2 text-left font-semibold">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="border border-border px-3 py-2">{children}</td>
        ),
        hr: () => <hr className="my-8 border-border" />,
        strong: ({ children }) => (
          <strong className="font-semibold">{children}</strong>
        ),
      }}
    >
      {content}
    </Markdown>
  );
}
