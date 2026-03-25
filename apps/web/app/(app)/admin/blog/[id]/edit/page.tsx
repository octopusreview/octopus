import { notFound } from "next/navigation";
import { prisma } from "@octopus/db";
import { BlogEditor } from "../../blog-editor";

export default async function EditBlogPostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const post = await prisma.blogPost.findUnique({
    where: { id, deletedAt: null },
  });

  if (!post) notFound();

  return (
    <BlogEditor
      post={{
        id: post.id,
        title: post.title,
        slug: post.slug,
        excerpt: post.excerpt,
        content: post.content,
        coverImageUrl: post.coverImageUrl,
        status: post.status,
      }}
    />
  );
}
