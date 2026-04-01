"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { IconDatabasePlus } from "@tabler/icons-react";
import { seedTemplatesAction } from "./actions";

export function SeedTemplatesButton({
  hasTemplates,
}: {
  hasTemplates: boolean;
}) {
  const [loading, setLoading] = useState(false);

  return (
    <form
      action={async () => {
        setLoading(true);
        await seedTemplatesAction();
        setLoading(false);
      }}
    >
      <Button type="submit" variant="outline" size="sm" disabled={loading}>
        <IconDatabasePlus className="mr-1.5 size-4" />
        {loading
          ? "Seeding..."
          : hasTemplates
            ? "Seed Missing Templates"
            : "Seed Default Templates"}
      </Button>
    </form>
  );
}
