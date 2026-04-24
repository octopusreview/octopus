import { IconCheck, IconX } from "@tabler/icons-react";

export type ComparisonValue = string | boolean;

export type ComparisonRow = {
  label: string;
  octopus: ComparisonValue;
  competitor: ComparisonValue;
};

export function Cell({ value }: { value: ComparisonValue }) {
  if (typeof value === "boolean") {
    return value ? (
      <IconCheck className="size-5 text-[#10D8BE]" aria-label="Yes" />
    ) : (
      <IconX className="size-5 text-[#555]" aria-label="No" />
    );
  }
  return <span className="text-sm text-[#cfcfcf]">{value}</span>;
}
