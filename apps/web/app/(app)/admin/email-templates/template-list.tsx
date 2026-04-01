"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import Link from "next/link";

interface Template {
  id: string;
  slug: string;
  name: string;
  subject: string;
  category: string;
  variables: string[];
  enabled: boolean;
  system: boolean;
}

const tabs = [
  { key: "transactional", label: "Transactional" },
  { key: "notification", label: "Notification" },
  { key: "marketing", label: "Marketing" },
] as const;

type TabKey = (typeof tabs)[number]["key"];

const categoryColors: Record<string, string> = {
  transactional:
    "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  notification:
    "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
  marketing:
    "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300",
};

const categoryDescriptions: Record<string, string> = {
  transactional: "Required emails that cannot be disabled by users",
  notification: "System events, controllable per org member",
  marketing: "Product updates and tips, users can opt out",
};

export function TemplateList({
  systemTemplates,
  customTemplates,
}: {
  systemTemplates: Template[];
  customTemplates: Template[];
}) {
  const all = [...systemTemplates, ...customTemplates];
  const [tab, setTab] = useState<TabKey>("transactional");

  const grouped = {
    transactional: all.filter((t) => t.category === "transactional"),
    notification: all.filter((t) => t.category === "notification"),
    marketing: all.filter((t) => t.category === "marketing"),
  };

  const templates = grouped[tab];

  return (
    <>
      <div className="flex gap-1 border-b">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "px-4 py-2 text-sm font-medium transition-colors",
              tab === t.key
                ? "border-b-2 border-foreground text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label} ({grouped[t.key].length})
          </button>
        ))}
      </div>

      <p className="text-muted-foreground text-xs">
        {categoryDescriptions[tab]}
      </p>

      {templates.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground text-sm">
              No templates in this category.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {templates.map((t) => (
            <Link
              key={t.id}
              href={`/admin/email-templates/${t.slug}`}
              className="block"
            >
              <Card className="transition-colors hover:bg-muted/30">
                <CardContent className="flex items-center justify-between p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{t.name}</span>
                      <Badge
                        variant="secondary"
                        className={`text-[10px] ${t.enabled ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300" : "bg-stone-100 text-stone-800 dark:bg-stone-900 dark:text-stone-300"}`}
                      >
                        {t.enabled ? "Active" : "Disabled"}
                      </Badge>
                      {t.system && (
                        <Badge variant="outline" className="text-[10px]">
                          system
                        </Badge>
                      )}
                    </div>
                    <p className="text-muted-foreground mt-0.5 truncate text-sm">
                      {t.subject}
                    </p>
                  </div>
                  <div className="text-muted-foreground ml-4 flex flex-wrap gap-1">
                    {t.variables.map((v) => (
                      <Badge
                        key={v}
                        variant="outline"
                        className="text-[10px]"
                      >
                        {`{{${v}}}`}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
