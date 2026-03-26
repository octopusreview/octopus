"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  IconPlus,
  IconPencil,
  IconTrash,
  IconEye,
  IconEyeOff,
  IconKey,
  IconCopy,
  IconCheck,
  IconApi,
  IconChevronLeft,
  IconChevronRight,
} from "@tabler/icons-react";
import {
  publishBlogPost,
  unpublishBlogPost,
  deleteBlogPost,
  generateBlogApiToken,
  deleteBlogApiToken,
} from "./actions";
import { toast } from "sonner";

interface BlogPostItem {
  id: string;
  title: string;
  slug: string;
  status: string;
  authorName: string;
  publishedAt: string | null;
  createdAt: string;
}

interface BlogApiTokenItem {
  id: string;
  name: string;
  tokenPrefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

function CopyBlock({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group relative">
      <pre className="rounded bg-muted px-4 py-3 pr-12 text-sm font-mono overflow-x-auto whitespace-pre-wrap">{children}</pre>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard.writeText(children);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
        className="absolute right-2 top-2 rounded border border-border bg-background p-1.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
      >
        {copied ? <IconCheck className="size-3.5" /> : <IconCopy className="size-3.5" />}
      </button>
    </div>
  );
}

export function BlogAdmin({
  posts,
  tokens,
  page,
  totalPages,
}: {
  posts: BlogPostItem[];
  tokens: BlogApiTokenItem[];
  page: number;
  totalPages: number;
}) {
  const [isPending, startTransition] = useTransition();
  const [tokenName, setTokenName] = useState("");
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [showApiDocs, setShowApiDocs] = useState(false);

  function handlePublish(id: string) {
    startTransition(async () => {
      const result = await publishBlogPost(id);
      if ("error" in result) toast.error(String(result.error));
      else toast.success("Post published");
    });
  }

  function handleUnpublish(id: string) {
    startTransition(async () => {
      const result = await unpublishBlogPost(id);
      if ("error" in result) toast.error(String(result.error));
      else toast.success("Post unpublished");
    });
  }

  function handleDelete(id: string) {
    if (!confirm("Are you sure you want to delete this post?")) return;
    startTransition(async () => {
      const result = await deleteBlogPost(id);
      if ("error" in result) toast.error(String(result.error));
      else toast.success("Post deleted");
    });
  }

  function handleGenerateToken() {
    if (!tokenName.trim()) return;
    startTransition(async () => {
      const result = await generateBlogApiToken(tokenName.trim());
      if ("error" in result) {
        toast.error(String(result.error));
      } else {
        setRevealedToken(result.token);
        setTokenName("");
        toast.success("Token generated. Copy it now, it won't be shown again.");
      }
    });
  }

  function handleDeleteToken(id: string) {
    if (!confirm("Are you sure you want to revoke this token?")) return;
    startTransition(async () => {
      const result = await deleteBlogApiToken(id);
      if ("error" in result) toast.error(String(result.error));
      else toast.success("Token revoked");
    });
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  }

  return (
    <div className="space-y-10">
      {/* Posts Section */}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Blog Posts</h1>
          <Button asChild>
            <Link href="/admin/blog/new">
              <IconPlus className="mr-2 size-4" />
              New Post
            </Link>
          </Button>
        </div>

        {posts.length === 0 ? (
          <p className="text-muted-foreground">No blog posts yet.</p>
        ) : (
          <div className="rounded-lg border">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-sm text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Title</th>
                  <th className="px-4 py-3 font-medium">Slug</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {posts.map((post) => (
                  <tr key={post.id} className="border-b last:border-0">
                    <td className="px-4 py-3 font-medium">{post.title}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      /blog/{post.slug}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={post.status === "published" ? "default" : "secondary"}>
                        {post.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {post.publishedAt
                        ? new Date(post.publishedAt).toLocaleDateString()
                        : new Date(post.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" asChild>
                          <Link href={`/admin/blog/${post.id}/edit`}>
                            <IconPencil className="size-4" />
                          </Link>
                        </Button>
                        {post.status === "draft" ? (
                          <Button variant="ghost" size="icon" disabled={isPending} onClick={() => handlePublish(post.id)}>
                            <IconEye className="size-4" />
                          </Button>
                        ) : (
                          <Button variant="ghost" size="icon" disabled={isPending} onClick={() => handleUnpublish(post.id)}>
                            <IconEyeOff className="size-4" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" disabled={isPending} onClick={() => handleDelete(post.id)}>
                          <IconTrash className="size-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              asChild={page > 1}
            >
              {page > 1 ? (
                <Link href={page === 2 ? "/admin/blog" : `/admin/blog?page=${page - 1}`}>
                  <IconChevronLeft className="mr-1 size-4" />
                  Previous
                </Link>
              ) : (
                <span>
                  <IconChevronLeft className="mr-1 size-4" />
                  Previous
                </span>
              )}
            </Button>
            <span className="text-sm text-muted-foreground">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              asChild={page < totalPages}
            >
              {page < totalPages ? (
                <Link href={`/admin/blog?page=${page + 1}`}>
                  Next
                  <IconChevronRight className="ml-1 size-4" />
                </Link>
              ) : (
                <span>
                  Next
                  <IconChevronRight className="ml-1 size-4" />
                </span>
              )}
            </Button>
          </div>
        )}
      </div>

      {/* API Tokens Section */}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <IconKey className="size-5" />
            API Tokens
          </h2>
          <Button variant="outline" onClick={() => setShowApiDocs(!showApiDocs)}>
            <IconApi className="mr-2 size-4" />
            {showApiDocs ? "Hide" : "Show"} API Docs
          </Button>
        </div>

        {/* Generate Token */}
        <div className="flex items-center gap-3">
          <Input
            value={tokenName}
            onChange={(e) => setTokenName(e.target.value)}
            placeholder="Token name (e.g. blog-agent)"
            className="max-w-xs"
            onKeyDown={(e) => e.key === "Enter" && handleGenerateToken()}
          />
          <Button disabled={isPending || !tokenName.trim()} onClick={handleGenerateToken}>
            <IconPlus className="mr-2 size-4" />
            Generate Token
          </Button>
        </div>

        {/* Revealed Token */}
        {revealedToken && (
          <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4">
            <p className="mb-2 text-sm font-medium text-yellow-500">
              Copy this token now. It won&apos;t be shown again.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded bg-muted px-3 py-2 text-sm font-mono break-all">
                {revealedToken}
              </code>
              <Button variant="outline" size="icon" onClick={() => copyToClipboard(revealedToken)}>
                <IconCopy className="size-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Token List */}
        {tokens.length > 0 && (
          <div className="rounded-lg border">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-sm text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Token</th>
                  <th className="px-4 py-3 font-medium">Last Used</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((t) => (
                  <tr key={t.id} className="border-b last:border-0">
                    <td className="px-4 py-3 font-medium">{t.name}</td>
                    <td className="px-4 py-3 text-sm font-mono text-muted-foreground">{t.tokenPrefix}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleDateString() : "Never"}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {new Date(t.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="ghost" size="icon" disabled={isPending} onClick={() => handleDeleteToken(t.id)}>
                        <IconTrash className="size-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* API Documentation */}
        {showApiDocs && (
          <div className="rounded-lg border bg-muted/30 p-6 space-y-6">
            <h3 className="text-lg font-bold">Blog API Documentation</h3>

            <div className="space-y-4">
              <div>
                <h4 className="font-semibold mb-2">Endpoints</h4>
                <div className="space-y-1">
                  <a href="#api-get" className="block rounded bg-muted px-3 py-2 text-sm font-mono hover:bg-muted/80 transition-colors cursor-pointer">
                    GET  /api/blog — Search & list posts
                  </a>
                  <a href="#api-get-search" className="block rounded bg-muted px-3 py-2 text-sm font-mono hover:bg-muted/80 transition-colors cursor-pointer">
                    GET  /api/blog/search — Quick search (public, no auth)
                  </a>
                  <a href="#api-post" className="block rounded bg-muted px-3 py-2 text-sm font-mono hover:bg-muted/80 transition-colors cursor-pointer">
                    POST /api/blog — Create a new post
                  </a>
                </div>
              </div>

              <div>
                <h4 className="font-semibold mb-2">AI Agent Prompt Example</h4>
                <CopyBlock>{`You are a blog content agent for Octopus Review (octopus-review.ai), an open source AI code review tool.

Write a blog post about [TOPIC]. The post should be:
- Written in markdown format
- Technical but accessible
- 800-1500 words
- Include code examples where relevant

STEP 1: Search existing posts to avoid duplicate topics.

GET https://octopus-review.ai/api/blog?q=[TOPIC_KEYWORDS]&status=published
Authorization: Bearer [YOUR_TOKEN]

Response:
{
  "posts": [{ "title": "...", "slug": "...", "excerpt": "..." }],
  "pagination": { "page": 1, "limit": 10, "total": 0, "totalPages": 0 }
}

If similar posts exist, choose a different angle or skip.

STEP 2: Create the blog post.

POST https://octopus-review.ai/api/blog
Authorization: Bearer [YOUR_TOKEN]
Content-Type: application/json

{
  "title": "Your Post Title",
  "content": "[markdown content]",
  "slug": "your-post-slug",
  "authorName": "Octopus Team",
  "status": "draft",
  "generateSeo": true
}

Response:
{
  "success": true,
  "id": "clx...",
  "slug": "your-post-slug",
  "status": "draft",
  "excerpt": "AI-generated excerpt...",
  "url": "/blog/your-post-slug"
}

Error responses:
- 401: { "error": "Unauthorized" }
- 400: { "error": "title and content are required" }
- 409: { "error": "A post with this slug already exists" }`}</CopyBlock>
              </div>

              <div>
                <h4 className="font-semibold mb-2">Headers (all requests)</h4>
                <code className="block rounded bg-muted px-3 py-2 text-sm font-mono">
                  Authorization: Bearer blog_xxxxxxxxxxxxx
                </code>
              </div>

              <hr className="border-border" />

              <h4 id="api-get" className="font-bold text-base scroll-mt-4">GET /api/blog — Search & List</h4>

              <div>
                <h4 className="font-semibold mb-2">Query Parameters</h4>
                <div className="rounded border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50 text-left">
                        <th className="px-3 py-2 font-medium">Param</th>
                        <th className="px-3 py-2 font-medium">Type</th>
                        <th className="px-3 py-2 font-medium">Default</th>
                        <th className="px-3 py-2 font-medium">Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b"><td className="px-3 py-2 font-mono">q</td><td className="px-3 py-2">string</td><td className="px-3 py-2">—</td><td className="px-3 py-2">Search query (searches title, excerpt, content)</td></tr>
                      <tr className="border-b"><td className="px-3 py-2 font-mono">status</td><td className="px-3 py-2">string</td><td className="px-3 py-2">all</td><td className="px-3 py-2">&quot;draft&quot; or &quot;published&quot;</td></tr>
                      <tr className="border-b"><td className="px-3 py-2 font-mono">page</td><td className="px-3 py-2">number</td><td className="px-3 py-2">1</td><td className="px-3 py-2">Page number</td></tr>
                      <tr><td className="px-3 py-2 font-mono">limit</td><td className="px-3 py-2">number</td><td className="px-3 py-2">10</td><td className="px-3 py-2">Results per page (max 50)</td></tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h4 className="font-semibold mb-2">Search Example (curl)</h4>
                <CopyBlock>{`curl "https://octopus-review.ai/api/blog?q=vector+search&status=published&limit=5" \\
  -H "Authorization: Bearer blog_xxxxxxxxxxxxx"`}</CopyBlock>
              </div>

              <div>
                <h4 className="font-semibold mb-2">Search Response</h4>
                <CopyBlock>{`{
  "posts": [
    {
      "id": "clx...",
      "title": "Building an AI Code Review Tool",
      "slug": "building-an-ai-code-review-tool",
      "excerpt": "How we built...",
      "coverImageUrl": "https://...",
      "status": "published",
      "authorName": "Ferit",
      "publishedAt": "2026-03-24T20:19:14.375Z",
      "createdAt": "2026-03-24T20:19:14.378Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 5,
    "total": 1,
    "totalPages": 1
  }
}`}</CopyBlock>
              </div>

              <hr className="border-border" />

              <h4 id="api-get-search" className="font-bold text-base scroll-mt-4">GET /api/blog/search — Quick Search</h4>

              <p className="text-sm text-muted-foreground">
                Public endpoint (no auth required). Used by the blog search UI. Returns only published posts.
              </p>

              <div>
                <h4 className="font-semibold mb-2">Query Parameters</h4>
                <div className="rounded border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50 text-left">
                        <th className="px-3 py-2 font-medium">Param</th>
                        <th className="px-3 py-2 font-medium">Type</th>
                        <th className="px-3 py-2 font-medium">Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr><td className="px-3 py-2 font-mono">q</td><td className="px-3 py-2">string</td><td className="px-3 py-2">Search query (required)</td></tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h4 className="font-semibold mb-2">Example</h4>
                <CopyBlock>{`curl "https://octopus-review.ai/api/blog/search?q=vector+search"`}</CopyBlock>
              </div>

              <div>
                <h4 className="font-semibold mb-2">Response</h4>
                <CopyBlock>{`{
  "posts": [
    {
      "title": "Building an AI Code Review Tool",
      "slug": "building-an-ai-code-review-tool",
      "excerpt": "How we built..."
    }
  ]
}`}</CopyBlock>
              </div>

              <hr className="border-border" />

              <h4 id="api-post" className="font-bold text-base scroll-mt-4">POST /api/blog — Create Post</h4>

              <div>
                <h4 className="font-semibold mb-2">Body Parameters</h4>
                <div className="rounded border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50 text-left">
                        <th className="px-3 py-2 font-medium">Field</th>
                        <th className="px-3 py-2 font-medium">Type</th>
                        <th className="px-3 py-2 font-medium">Required</th>
                        <th className="px-3 py-2 font-medium">Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b"><td className="px-3 py-2 font-mono">title</td><td className="px-3 py-2">string</td><td className="px-3 py-2">Yes</td><td className="px-3 py-2">Post title</td></tr>
                      <tr className="border-b"><td className="px-3 py-2 font-mono">content</td><td className="px-3 py-2">string</td><td className="px-3 py-2">Yes</td><td className="px-3 py-2">Markdown content</td></tr>
                      <tr className="border-b"><td className="px-3 py-2 font-mono">slug</td><td className="px-3 py-2">string</td><td className="px-3 py-2">No</td><td className="px-3 py-2">URL slug (auto-generated from title if not provided)</td></tr>
                      <tr className="border-b"><td className="px-3 py-2 font-mono">excerpt</td><td className="px-3 py-2">string</td><td className="px-3 py-2">No</td><td className="px-3 py-2">Short summary for SEO</td></tr>
                      <tr className="border-b"><td className="px-3 py-2 font-mono">coverImageUrl</td><td className="px-3 py-2">string</td><td className="px-3 py-2">No</td><td className="px-3 py-2">Cover image URL (1200x628px recommended)</td></tr>
                      <tr className="border-b"><td className="px-3 py-2 font-mono">authorName</td><td className="px-3 py-2">string</td><td className="px-3 py-2">No</td><td className="px-3 py-2">Author name (default: &quot;Octopus Team&quot;)</td></tr>
                      <tr className="border-b"><td className="px-3 py-2 font-mono">status</td><td className="px-3 py-2">string</td><td className="px-3 py-2">No</td><td className="px-3 py-2">&quot;draft&quot; or &quot;published&quot; (default: &quot;draft&quot;)</td></tr>
                      <tr><td className="px-3 py-2 font-mono">generateSeo</td><td className="px-3 py-2">boolean</td><td className="px-3 py-2">No</td><td className="px-3 py-2">Auto-generate excerpt with AI if not provided (default: false)</td></tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h4 className="font-semibold mb-2">Manual Usage (curl)</h4>
                <CopyBlock>{`curl -X POST https://octopus-review.ai/api/blog \\
  -H "Authorization: Bearer blog_xxxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "My Blog Post",
    "content": "# Hello World\\n\\nThis is my **first** post.",
    "status": "draft",
    "generateSeo": true
  }'`}</CopyBlock>
              </div>

              <div>
                <h4 className="font-semibold mb-2">Response</h4>
                <CopyBlock>{`{
  "success": true,
  "id": "clx...",
  "slug": "my-blog-post",
  "status": "draft",
  "excerpt": "AI-generated excerpt...",
  "url": "/blog/my-blog-post"
}`}</CopyBlock>
              </div>

            </div>
          </div>
        )}
      </div>
    </div>
  );
}
