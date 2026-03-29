"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getPubbyClient } from "@/lib/pubby-client";

export function StatusListener() {
  const router = useRouter();

  useEffect(() => {
    const pubby = getPubbyClient();
    const channel = pubby.subscribe("status-updates");

    channel.bind("status:changed", () => {
      router.refresh();
    });

    return () => {
      channel.unbindAll();
      pubby.unsubscribe("status-updates");
    };
  }, [router]);

  return null;
}
