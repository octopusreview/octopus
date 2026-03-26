import { AskOctopus } from "@/components/ask-octopus";

export default function LandingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {children}
      <AskOctopus />
    </>
  );
}
