-- AlterTable
ALTER TABLE "blog_posts" ADD COLUMN     "category" TEXT,
ADD COLUMN     "readingTime" INTEGER,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "blog_posts_status_category_idx" ON "blog_posts"("status", "category");

