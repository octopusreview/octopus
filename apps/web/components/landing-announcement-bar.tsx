"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import {
  IconHeartHandshake,
  IconRocket,
  IconSparkles,
  IconBell,
  IconSpeakerphone,
  IconInfoCircle,
  IconGift,
  IconFlame,
  IconArrowRight,
} from "@tabler/icons-react";
import { trackEvent } from "@/lib/analytics";
import type { Announcement, AnnouncementIcon, AnnouncementTone } from "@/lib/announcements";

const ICON_MAP: Record<AnnouncementIcon, typeof IconBell> = {
  "heart-handshake": IconHeartHandshake,
  rocket: IconRocket,
  sparkles: IconSparkles,
  bell: IconBell,
  megaphone: IconSpeakerphone,
  info: IconInfoCircle,
  gift: IconGift,
  flame: IconFlame,
};

interface ToneStyle {
  bg: string;
  border: string;
  accent: string;
  text: string;
  hover: string;
}

const TONE_MAP: Record<AnnouncementTone, ToneStyle> = {
  teal: {
    bg: "linear-gradient(to right, rgb(16 216 190 / 0.08), rgb(16 216 190 / 0.14), rgb(16 216 190 / 0.08))",
    border: "rgb(16 216 190 / 0.20)",
    accent: "#10D8BE",
    text: "#d8fffa",
    hover: "rgb(16 216 190 / 0.12)",
  },
  amber: {
    bg: "linear-gradient(to right, rgb(245 185 74 / 0.08), rgb(245 185 74 / 0.16), rgb(245 185 74 / 0.08))",
    border: "rgb(245 185 74 / 0.25)",
    accent: "#F5B94A",
    text: "#fff1d4",
    hover: "rgb(245 185 74 / 0.14)",
  },
  violet: {
    bg: "linear-gradient(to right, rgb(167 139 250 / 0.08), rgb(167 139 250 / 0.16), rgb(167 139 250 / 0.08))",
    border: "rgb(167 139 250 / 0.25)",
    accent: "#C4B5FD",
    text: "#ece9ff",
    hover: "rgb(167 139 250 / 0.14)",
  },
  rose: {
    bg: "linear-gradient(to right, rgb(244 114 182 / 0.08), rgb(244 114 182 / 0.16), rgb(244 114 182 / 0.08))",
    border: "rgb(244 114 182 / 0.25)",
    accent: "#F9A8D4",
    text: "#ffe4f1",
    hover: "rgb(244 114 182 / 0.14)",
  },
  emerald: {
    bg: "linear-gradient(to right, rgb(52 211 153 / 0.08), rgb(52 211 153 / 0.16), rgb(52 211 153 / 0.08))",
    border: "rgb(52 211 153 / 0.22)",
    accent: "#34D399",
    text: "#d6fbe8",
    hover: "rgb(52 211 153 / 0.14)",
  },
  sky: {
    bg: "linear-gradient(to right, rgb(56 189 248 / 0.08), rgb(56 189 248 / 0.16), rgb(56 189 248 / 0.08))",
    border: "rgb(56 189 248 / 0.25)",
    accent: "#7DD3FC",
    text: "#dbf3ff",
    hover: "rgb(56 189 248 / 0.14)",
  },
};

const ROTATE_INTERVAL_MS = 5000;
const SLIDE_DURATION_MS = 500;

export function LandingAnnouncementBar({
  announcements,
}: {
  announcements: Announcement[];
}) {
  const [index, setIndex] = useState(0);
  const [animating, setAnimating] = useState(false);

  const count = announcements.length;
  const multiple = count > 1;

  useEffect(() => {
    if (!multiple) return;
    const tick = setInterval(() => {
      setAnimating(true);
      setTimeout(() => {
        setIndex((i) => (i + 1) % count);
        setAnimating(false);
      }, SLIDE_DURATION_MS);
    }, ROTATE_INTERVAL_MS);
    return () => clearInterval(tick);
  }, [multiple, count]);

  if (count === 0) return null;

  const current = announcements[index];
  const next = announcements[(index + 1) % count];
  const currentTone = TONE_MAP[current.tone] ?? TONE_MAP.teal;

  const outerStyle: CSSProperties = {
    borderColor: currentTone.border,
    transition: `border-color ${SLIDE_DURATION_MS}ms cubic-bezier(0.65, 0, 0.35, 1)`,
  };

  if (!multiple) {
    return (
      <div
        className="fixed inset-x-0 top-0 z-[55] overflow-hidden border-b backdrop-blur-md"
        style={outerStyle}
      >
        <div className="relative h-9 sm:h-10">
          <AnnouncementRow announcement={current} />
        </div>
      </div>
    );
  }

  const transition = animating
    ? `transform ${SLIDE_DURATION_MS}ms cubic-bezier(0.65, 0, 0.35, 1)`
    : "none";

  return (
    <div
      className="fixed inset-x-0 top-0 z-[55] overflow-hidden border-b backdrop-blur-md"
      style={outerStyle}
    >
      <div className="relative h-9 sm:h-10">
        <div
          className="absolute inset-0"
          style={{
            transform: animating ? "translateY(-100%)" : "translateY(0)",
            transition,
          }}
        >
          <AnnouncementRow announcement={current} />
        </div>
        <div
          className="absolute inset-0"
          style={{
            transform: animating ? "translateY(0)" : "translateY(100%)",
            transition,
          }}
        >
          <AnnouncementRow announcement={next} />
        </div>
      </div>
    </div>
  );
}

function AnnouncementRow({ announcement }: { announcement: Announcement }) {
  const Icon = ICON_MAP[announcement.icon] ?? IconSpeakerphone;
  const tone = TONE_MAP[announcement.tone] ?? TONE_MAP.teal;
  const inner = (
    <div
      className="flex h-9 w-full items-center justify-center gap-2 px-4 text-xs font-medium sm:h-10 sm:text-sm"
      style={{ background: tone.bg, color: tone.text }}
    >
      <Icon className="size-4 shrink-0" style={{ color: tone.accent }} />
      <span className="truncate">
        {announcement.prefix && (
          <span className="hidden sm:inline">{announcement.prefix} </span>
        )}
        {announcement.message}
      </span>
      {announcement.ctaLabel && (
        <span className="inline-flex shrink-0 items-center gap-1 font-semibold text-white">
          {announcement.ctaLabel}
          <IconArrowRight className="size-3.5" />
        </span>
      )}
    </div>
  );

  if (!announcement.href) return inner;

  const isExternal = /^https?:\/\//.test(announcement.href);
  const onClick = () =>
    trackEvent("cta_click", {
      location: "announcement_bar",
      label: announcement.id,
    });

  if (isExternal) {
    return (
      <a
        href={announcement.href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onClick}
        className="group block"
      >
        {inner}
      </a>
    );
  }

  return (
    <Link href={announcement.href} onClick={onClick} className="group block">
      {inner}
    </Link>
  );
}
