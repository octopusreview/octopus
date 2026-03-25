"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createBlogPost, updateBlogPost, generateExcerpt } from "./actions";
import { BlogContent } from "@/components/blog-content";
import { IconSparkles } from "@tabler/icons-react";
import { toast } from "sonner";

interface BlogEditorProps {
  post?: {
    id: string;
    title: string;
    slug: string;
    excerpt: string | null;
    content: string;
    coverImageUrl: string | null;
    status: string;
  };
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function BlogEditor({ post }: BlogEditorProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [title, setTitle] = useState(post?.title ?? "");
  const [slug, setSlug] = useState(post?.slug ?? "");
  const [excerpt, setExcerpt] = useState(post?.excerpt ?? "");
  const [content, setContent] = useState(post?.content ?? "");
  const [coverImageUrl, setCoverImageUrl] = useState(post?.coverImageUrl ?? "");
  const [showPreview, setShowPreview] = useState(false);
  const [isGeneratingExcerpt, setIsGeneratingExcerpt] = useState(false);

  async function handleGenerateExcerpt() {
    setIsGeneratingExcerpt(true);
    try {
      const result = await generateExcerpt(content);
      if ("error" in result) {
        toast.error(String(result.error));
      } else {
        setExcerpt(result.excerpt);
        toast.success("Excerpt generated");
      }
    } catch {
      toast.error("Failed to generate excerpt");
    } finally {
      setIsGeneratingExcerpt(false);
    }
  }

  function handleTitleChange(value: string) {
    setTitle(value);
    if (!post) {
      setSlug(slugify(value));
    }
  }

  function handleSubmit(publish: boolean) {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("title", title);
      formData.set("slug", slug);
      formData.set("excerpt", excerpt);
      formData.set("content", content);
      formData.set("coverImageUrl", coverImageUrl);

      let result;
      if (post) {
        result = await updateBlogPost(post.id, formData);
      } else {
        formData.set("publish", publish ? "true" : "false");
        result = await createBlogPost(formData);
      }

      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(post ? "Post updated" : publish ? "Post published" : "Draft saved");
        router.push("/admin/blog");
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{post ? "Edit Post" : "New Post"}</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setShowPreview(!showPreview)}
          >
            {showPreview ? "Edit" : "Preview"}
          </Button>
          <Button
            variant="outline"
            disabled={isPending}
            onClick={() => handleSubmit(false)}
          >
            {post ? "Save" : "Save Draft"}
          </Button>
          {(!post || post.status === "draft") && (
            <Button
              disabled={isPending}
              onClick={() => handleSubmit(true)}
            >
              Publish
            </Button>
          )}
        </div>
      </div>

      {showPreview ? (
        <div className="rounded-lg border p-8">
          <h1 className="mb-4 text-3xl font-bold">{title || "Untitled"}</h1>
          {excerpt && (
            <p className="mb-6 text-lg text-muted-foreground">{excerpt}</p>
          )}
          <BlogContent content={content} />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder="Post title"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="slug">Slug</Label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">/blog/</span>
              <Input
                id="slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="post-slug"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="excerpt">Excerpt</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!content.trim() || isGeneratingExcerpt}
                onClick={handleGenerateExcerpt}
              >
                <IconSparkles className="mr-1.5 size-3.5" />
                {isGeneratingExcerpt ? "Generating..." : "Generate with AI"}
              </Button>
            </div>
            <Textarea
              id="excerpt"
              value={excerpt}
              onChange={(e) => setExcerpt(e.target.value)}
              placeholder="Short summary for SEO and blog cards"
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="coverImageUrl">Cover Image URL</Label>
            <Input
              id="coverImageUrl"
              value={coverImageUrl}
              onChange={(e) => setCoverImageUrl(e.target.value)}
              placeholder="https://... (recommended: 1200x630px)"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="content">Content (Markdown)</Label>
            <Textarea
              id="content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Write your blog post in markdown..."
              rows={24}
              className="font-mono text-sm"
            />
          </div>
        </div>
      )}
    </div>
  );
}
