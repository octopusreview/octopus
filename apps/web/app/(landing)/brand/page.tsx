import Image from "next/image";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { LandingFooter } from "@/components/landing-footer";
import { LandingMobileNav } from "@/components/landing-mobile-nav";
import { LandingDesktopNav } from "@/components/landing-desktop-nav";

export const metadata: Metadata = {
  title: "Brand Guidelines",
  description:
    "The Octopus green brand kit: mascot downloads, Geist typography, colors, and usage guidelines.",
  alternates: {
    canonical: "https://octopus-review.ai/brand",
  },
};

/* ------------------------------------------------------------------ */
/* Color data                                                          */
/* ------------------------------------------------------------------ */

const brandColors = [
  { name: "Octopus Green", hex: "#15BA81", rgb: "21, 186, 129", description: "Accent and buttons on dark backgrounds. Pair with Ink text." },
  { name: "Deep Green", hex: "#087F5B", rgb: "8, 127, 91", description: "Accent and buttons on light backgrounds. Pair with White text." },
  { name: "Ink", hex: "#0C0A09", rgb: "12, 10, 9", description: "Dark background and text on bright green buttons." },
  { name: "Warm White", hex: "#FAFAF9", rgb: "250, 250, 249", description: "Primary text on dark backgrounds." },
  { name: "White", hex: "#FFFFFF", rgb: "255, 255, 255", description: "Light background and text on deep green buttons." },
];

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default async function BrandPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  return (
    <div className="dark relative min-h-screen bg-background text-[#a0a0a0] selection:bg-white/20">
      {/* Grain overlay */}
      <div
        className="pointer-events-none fixed inset-0 z-50 opacity-[0.025]"
        aria-hidden="true"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
        }}
      />

      {/* Mobile nav */}
      <LandingMobileNav isLoggedIn={!!session} />

      {/* Desktop nav */}
      <LandingDesktopNav isLoggedIn={!!session} />

      {/* Hero */}
      <section className="relative z-10 px-6 pb-16 pt-28 md:px-8 md:pb-24 md:pt-40">
        <div className="mx-auto max-w-4xl text-center">
          <h1 className="animate-fade-in text-4xl font-bold tracking-tight text-white sm:text-5xl md:text-6xl">
            Brand Guidelines
          </h1>
          <p className="animate-fade-in mt-4 text-lg text-[#666] [animation-delay:100ms]">
            Resources for presenting the Octopus brand consistently and professionally.
          </p>
        </div>
      </section>

      {/* Naming */}
      <Section>
        <SectionHeader
          label="Naming"
          title="How to write Octopus"
          description={`The brand name is "Octopus", one word, always capitalized. When additional context is needed, use "Octopus Code Review" as the descriptive form.`}
        />
        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          <GuidelineCard
            title="Brand name"
            description={`"Octopus" is the primary brand name. Use it standalone whenever the context is clear.`}
            doText="Octopus"
            dontText="octopus, OCTOPUS, Octo-pus"
          />
          <GuidelineCard
            title="Descriptive form"
            description={`When you need to clarify what the product does, in SEO, directory listings, or first mentions, use "Octopus Code Review".`}
            doText="Octopus Code Review"
            dontText="Octopus CR, OctopusCR, OCR"
          />
        </div>
        <div className="mt-6">
          <GuidelineCard
            title="In sentences"
            description={`"Octopus" refers to both the product and the company. Don't prefix it with "the" in product context.`}
            doText="Octopus reviews your PRs"
            dontText="The Octopus reviews your PRs"
          />
        </div>
      </Section>

      {/* Logo */}
      <Section>
        <SectionHeader
          label="Logo"
          title="Logo assets"
          description="The approved green mascot is available as PNG artwork. Keep its proportions and leave clear space around it."
        />
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          <LogoCard
            label="Transparent mascot"
            sublabel="For app navigation and flexible layouts"
            bg="bg-background"
            pngHref="/brand/octopus-mark.png"
          >
            <Image src="/brand/octopus-mark.png" alt="Octopus green mascot" width={112} height={112} />
          </LogoCard>
          <LogoCard
            label="Light artwork"
            sublabel="For light backgrounds"
            bg="bg-white"
            pngHref="/brand/octopus-light.png"
          >
            <Image src="/brand/octopus-light.png" alt="Octopus green mascot on white" width={144} height={144} />
          </LogoCard>
          <LogoCard
            label="Dark artwork"
            sublabel="For dark backgrounds"
            bg="bg-background"
            pngHref="/brand/octopus-dark.png"
          >
            <Image src="/brand/octopus-dark.png" alt="Octopus green mascot on Ink" width={144} height={144} />
          </LogoCard>
        </div>

        <p className="mt-6 text-sm text-[#a0a0a0]">
          <a href="https://ads.weezboo.com/brand-kit/octopus/index.html" className="text-primary underline underline-offset-4">Browse the complete brand kit</a>
          {" "}or{" "}
          <a href="https://ads.weezboo.com/brand-kit/octopus/octopus-brand-kit-v1.0.0.zip" className="text-primary underline underline-offset-4">download the ZIP</a>
          {" "}for social layouts, banners, editable layouts, and licensed font files. The mascot is raster artwork; there is no vector master.
        </p>

        {/* Usage do / don't */}
        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          <div className="rounded-xl border border-white/[0.06] p-6">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-400">Do</span>
            <ul className="mt-4 space-y-2 text-sm text-[#888]">
              <li>Use the logo with ample clear space around it</li>
              <li>Use official files from this page</li>
              <li>Keep the logo proportional when resizing</li>
            </ul>
          </div>
          <div className="rounded-xl border border-white/[0.06] p-6">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-red-400">Don&apos;t</span>
            <ul className="mt-4 space-y-2 text-sm text-[#888]">
              <li>Alter, distort, or rotate the logo</li>
              <li>Recolor the approved artwork</li>
              <li>Add effects like shadows or outlines</li>
              <li>Place the logo on busy or low-contrast backgrounds</li>
            </ul>
          </div>
        </div>
      </Section>

      {/* Colors */}
      <Section>
        <SectionHeader
          label="Colors"
          title="Color palette"
          description="Use bright green on Ink and deep green on White. These button and text pairs meet WCAG AA contrast for normal text."
        />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {brandColors.map((color) => (
            <ColorCard key={color.hex} {...color} />
          ))}
        </div>
      </Section>

      {/* Typography */}
      <Section>
        <SectionHeader
          label="Typography"
          title="Typeface"
          description="Use Geist Sans for interface text and headings, and Geist Mono for code and technical labels. Both are open source under the SIL Open Font License."
        />
        <div className="mt-10 rounded-xl border border-white/[0.06] bg-white/[0.02] p-8 md:p-12">
          <p className="text-5xl font-bold tracking-tight text-white md:text-7xl">
            Aa
          </p>
          <p className="mt-4 text-2xl font-semibold text-white">Geist Sans</p>
          <p className="mt-4 font-mono text-sm text-primary">Geist Mono · octp review</p>
          <p className="mt-4 break-all text-sm text-[#888] sm:text-lg">
            ABCDEFGHIJKLMNOPQRSTUVWXYZ
          </p>
          <p className="break-all text-sm text-[#888] sm:text-lg">
            abcdefghijklmnopqrstuvwxyz
          </p>
          <p className="break-all text-sm text-[#888] sm:text-lg">
            0123456789 !@#$%^&*()
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            {(["Regular", "Medium", "Semibold", "Bold"] as const).map((w) => (
              <span
                key={w}
                className={`text-sm text-[#888] ${
                  w === "Regular"
                    ? "font-normal"
                    : w === "Medium"
                      ? "font-medium"
                      : w === "Semibold"
                        ? "font-semibold"
                        : "font-bold"
                }`}
              >
                {w}
              </span>
            ))}
          </div>
        </div>
      </Section>

      {/* Disclaimer */}
      <section className="relative z-10 px-6 py-16 md:px-8 md:py-24">
        <div className="mx-auto max-w-4xl text-center">
          <p className="text-sm text-[#444]">
            Please don&apos;t use our brand assets in ways that are confusing, misleading, or harmful.
            <br />
            For questions, reach out at{" "}
            <a href="mailto:hello@octopus-review.ai" className="text-[#666] underline transition-colors hover:text-white">
              hello@octopus-review.ai
            </a>
          </p>
        </div>
      </section>

      <LandingFooter />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                      */
/* ------------------------------------------------------------------ */

function Section({ children }: { children: React.ReactNode }) {
  return (
    <section className="relative z-10 px-4 py-4 sm:px-8 md:px-12">
      <div className="mx-auto max-w-4xl overflow-hidden rounded-3xl border border-white/[0.06] bg-[#161616] px-6 py-16 md:px-12 md:py-20">
        {children}
      </div>
    </section>
  );
}

function SectionHeader({
  label,
  title,
  description,
}: {
  label: string;
  title: string;
  description?: string;
}) {
  return (
    <div>
      <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[#555]">{label}</span>
      <h2 className="mt-3 text-2xl font-bold tracking-tight text-white sm:text-3xl">{title}</h2>
      {description && <p className="mt-3 max-w-2xl text-[#888]">{description}</p>}
    </div>
  );
}

function LogoCard({
  label,
  sublabel,
  bg,
  pngHref,
  children,
}: {
  label: string;
  sublabel: string;
  bg: string;
  pngHref?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-white/[0.06]">
      <div className={`relative flex h-48 items-center justify-center ${bg}`}>
        {pngHref && (
          <div className="absolute right-3 top-3 flex gap-1.5">
            {pngHref && (
              <a
                href={pngHref}
                download
                className="rounded-lg border border-white/[0.1] bg-black/60 px-2.5 py-1.5 text-xs font-medium text-white backdrop-blur-sm transition-colors hover:border-white/[0.2] hover:text-white"
              >
                PNG
              </a>
            )}
          </div>
        )}
        {children}
      </div>
      <div className="border-t border-white/[0.06] px-5 py-4">
        <p className="text-sm font-medium text-white">{label}</p>
        <p className="mt-0.5 text-xs text-[#666]">{sublabel}</p>
      </div>
    </div>
  );
}

function ColorCard({
  name,
  hex,
  rgb,
  description,
}: {
  name: string;
  hex: string;
  rgb: string;
  description: string;
}) {
  return (
    <div className="group overflow-hidden rounded-xl border border-white/[0.06] transition-colors hover:border-white/[0.12]">
      <div className="h-24" style={{ backgroundColor: hex }} />
      <div className="px-5 py-4">
        <p className="text-sm font-medium text-white">{name}</p>
        <p className="mt-1 font-mono text-xs text-[#888]">{hex}</p>
        <p className="font-mono text-xs text-[#666]">rgb({rgb})</p>
        <p className="mt-2 text-xs text-[#555]">{description}</p>
      </div>
    </div>
  );
}

function GuidelineCard({
  title,
  description,
  doText,
  dontText,
}: {
  title: string;
  description: string;
  doText: string;
  dontText: string;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] p-6">
      <h3 className="text-base font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm text-[#888]">{description}</p>
      <div className="mt-4 space-y-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-emerald-400">Do:</span>
          <code className="rounded bg-white/[0.04] px-2 py-0.5 text-xs text-white">{doText}</code>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-red-400">Don&apos;t:</span>
          <code className="rounded bg-white/[0.04] px-2 py-0.5 text-xs text-[#888]">{dontText}</code>
        </div>
      </div>
    </div>
  );
}
