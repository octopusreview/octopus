import { CARD_SIZE, titleCard } from "@/lib/og-card";

export const alt = "Self-hosted AI code review";
export const size = CARD_SIZE;
export const contentType = "image/png";

export default function Image() {
  return titleCard("Self-hosted AI code review", "octopus-review.ai/self-hosted-ai-code-review");
}
