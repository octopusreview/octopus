import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ReviewRecordView } from "@/components/review-record";
import { loadReviewRecordPage } from "@/lib/review-record-page";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review history", robots: { index: false, follow: false } };

export default async function ReviewRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await loadReviewRecordPage(id, await headers());
  if (result.state === "signed-out") redirect(`/login?callbackUrl=${encodeURIComponent(`/review-attempts/${id}`)}`);
  if (result.state === "blocked") redirect("/blocked");
  if (result.state === "password-change") redirect("/change-password");
  if (result.state === "not-found") notFound();
  return <ReviewRecordView record={result.record} />;
}
