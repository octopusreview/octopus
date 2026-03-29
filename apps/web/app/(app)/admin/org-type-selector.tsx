"use client";

import { useTransition } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { changeOrgType } from "./actions";
import { ORG_TYPE_LABELS } from "./org-types";

export function OrgTypeSelector({
  orgId,
  currentType,
}: {
  orgId: string;
  currentType: number;
}) {
  const [isPending, startTransition] = useTransition();

  function handleChange(value: string) {
    const newType = parseInt(value, 10);
    if (newType === currentType) return;
    startTransition(async () => {
      await changeOrgType(orgId, newType);
    });
  }

  return (
    <Select
      value={String(currentType)}
      onValueChange={handleChange}
      disabled={isPending}
    >
      <SelectTrigger className="h-7 w-[110px] text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(ORG_TYPE_LABELS).map(([value, label]) => (
          <SelectItem key={value} value={value} className="text-xs">
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
