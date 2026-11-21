import { CARD_SIZE, titleCard } from "@/lib/og-card";

export const alt = "Not a Rabbit. Review beyond the diff.";
export const size = CARD_SIZE;
export const contentType = "image/png";

export default function Image() {
  return titleCard("Review beyond the diff", "octopus-review.ai/not-a-rabbit");
}
