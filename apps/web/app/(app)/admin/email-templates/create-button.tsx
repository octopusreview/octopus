"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { IconPlus } from "@tabler/icons-react";
import { createTemplateAction } from "./actions";

export function CreateTemplateButton() {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  return (
    <form
      action={async () => {
        setLoading(true);
        const result = await createTemplateAction();
        if (result?.slug) {
          router.push(`/admin/email-templates/${result.slug}`);
        }
        setLoading(false);
      }}
    >
      <Button type="submit" size="sm" disabled={loading}>
        <IconPlus className="mr-1.5 size-4" />
        {loading ? "Creating..." : "New Template"}
      </Button>
    </form>
  );
}
