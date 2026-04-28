import Image from "next/image";
import {
  IconBrandDiscord,
  IconBrandGithub,
  IconBrandLinkedin,
  IconBrandReddit,
  IconBrandBluesky,
  IconBrandX,
  IconBrandYoutube,
  IconBug,
} from "@tabler/icons-react";
import { TrackedLink, TrackedAnchor } from "@/components/tracked-link";
import { GetInTouchModal } from "@/components/get-in-touch-modal";
import { DISCORD_INVITE_URL } from "@/lib/constants";
const LINKEDIN_URL = "https://www.linkedin.com/company/octopus-review";
const REDDIT_URL = "https://www.reddit.com/r/octopusreview/";

export function LandingFooter() {
  return (
    <footer className="border-t border-white/[0.06] px-6 py-12 md:px-8 md:py-16">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {/* Brand */}
          <div className="sm:col-span-2 lg:col-span-1">
            <div className="flex items-center gap-2.5">
              <Image src="/logo.svg" alt="Octopus" width={22} height={22} />
              <span className="text-sm font-semibold text-white">Octopus</span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-[#555]">
              AI-powered code review automation. Open source, self-hostable.
            </p>
            <div className="mt-4 flex items-center gap-3">
              <TrackedAnchor
                href="https://github.com/octopusreview"
                target="_blank"
                rel="noopener noreferrer"
                event="footer_click"
                eventParams={{ label: "github" }}
                aria-label="GitHub"
                className="text-[#555] transition-colors hover:text-white"
              >
                <IconBrandGithub className="size-4" />
              </TrackedAnchor>
              <TrackedAnchor
                href={REDDIT_URL}
                target="_blank"
                rel="noopener noreferrer"
                event="footer_click"
                eventParams={{ label: "reddit" }}
                aria-label="Reddit"
                className="text-[#555] transition-colors hover:text-white"
              >
                <IconBrandReddit className="size-4" />
              </TrackedAnchor>
              <TrackedAnchor
                href="https://bsky.app/profile/octopus-review.ai"
                target="_blank"
                rel="noopener noreferrer"
                event="footer_click"
                eventParams={{ label: "bluesky" }}
                aria-label="Bluesky"
                className="text-[#555] transition-colors hover:text-white"
              >
                <IconBrandBluesky className="size-4" />
              </TrackedAnchor>
              <TrackedAnchor
                href="https://x.com/octopus_review"
                target="_blank"
                rel="noopener noreferrer"
                event="footer_click"
                eventParams={{ label: "twitter" }}
                aria-label="X (Twitter)"
                className="text-[#555] transition-colors hover:text-white"
              >
                <IconBrandX className="size-4" />
              </TrackedAnchor>
              <TrackedAnchor
                href={DISCORD_INVITE_URL}
                target="_blank"
                rel="noopener noreferrer"
                event="footer_click"
                eventParams={{ label: "discord" }}
                aria-label="Discord"
                className="text-[#555] transition-colors hover:text-white"
              >
                <IconBrandDiscord className="size-4" />
              </TrackedAnchor>
              <TrackedAnchor
                href={LINKEDIN_URL}
                target="_blank"
                rel="noopener noreferrer"
                event="footer_click"
                eventParams={{ label: "linkedin" }}
                aria-label="LinkedIn"
                className="text-[#555] transition-colors hover:text-white"
              >
                <IconBrandLinkedin className="size-4" />
              </TrackedAnchor>
              <TrackedAnchor
                href="https://www.youtube.com/@OctopusReview"
                target="_blank"
                rel="noopener noreferrer"
                event="footer_click"
                eventParams={{ label: "youtube" }}
                aria-label="YouTube"
                className="text-[#555] transition-colors hover:text-white"
              >
                <IconBrandYoutube className="size-4" />
              </TrackedAnchor>
            </div>
          </div>

          {/* Product */}
          <div>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-[0.15em] text-[#555]">
              Product
            </h4>
            <ul className="space-y-2">
              <li>
                <TrackedAnchor
                  href="/#features"
                  event="footer_click"
                  eventParams={{ label: "features" }}
                  className="text-sm text-[#666] transition-colors hover:text-white"
                >
                  Features
                </TrackedAnchor>
              </li>
              <li>
                <TrackedAnchor
                  href="/#how-it-works"
                  event="footer_click"
                  eventParams={{ label: "how_it_works" }}
                  className="text-sm text-[#666] transition-colors hover:text-white"
                >
                  How It Works
                </TrackedAnchor>
              </li>
              <li>
                <TrackedLink
                  href="/brand"
                  event="footer_click"
                  eventParams={{ label: "brand" }}
                  className="text-sm text-[#666] transition-colors hover:text-white"
                >
                  Brand Guidelines
                </TrackedLink>
              </li>
              <li>
                <TrackedLink
                  href="/blog"
                  event="footer_click"
                  eventParams={{ label: "blog" }}
                  className="text-sm text-[#666] transition-colors hover:text-white"
                >
                  Blog
                </TrackedLink>
              </li>
              <li>
                <TrackedLink
                  href="/compare"
                  event="footer_click"
                  eventParams={{ label: "compare" }}
                  className="text-sm text-[#666] transition-colors hover:text-white"
                >
                  Compare
                </TrackedLink>
              </li>
              <li>
                <TrackedLink
                  href="/not-a-rabbit"
                  event="footer_click"
                  eventParams={{ label: "not_a_rabbit" }}
                  className="text-sm text-[#666] transition-colors hover:text-white"
                >
                  Not a Rabbit
                </TrackedLink>
              </li>
              <li>
                <TrackedLink
                  href="/docs/about"
                  event="footer_click"
                  eventParams={{ label: "about" }}
                  className="text-sm text-[#666] transition-colors hover:text-white"
                >
                  About
                </TrackedLink>
              </li>
              <li>
                <TrackedLink
                  href="/status"
                  event="footer_click"
                  eventParams={{ label: "status" }}
                  className="text-sm text-[#666] transition-colors hover:text-white"
                >
                  System Status
                </TrackedLink>
              </li>
              <li>
                <TrackedLink
                  href="/bug-bounty"
                  event="footer_click"
                  eventParams={{ label: "bug_bounty" }}
                  className="flex items-center gap-1.5 text-sm text-[#666] transition-colors hover:text-white"
                >
                  <IconBug className="size-3 text-orange-400" />
                  Bug Bounty
                </TrackedLink>
              </li>
            </ul>
          </div>

          {/* Docs */}
          <div>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-[0.15em] text-[#555]">
              Docs
            </h4>
            <ul className="space-y-2">
              <li>
                <TrackedLink
                  href="/docs/self-hosting"
                  event="footer_click"
                  eventParams={{ label: "docs_self_hosting" }}
                  className="text-sm text-[#666] transition-colors hover:text-white"
                >
                  Self-Hosting
                </TrackedLink>
              </li>
              <li>
                <TrackedLink
                  href="/docs/integrations"
                  event="footer_click"
                  eventParams={{ label: "docs_integrations" }}
                  className="text-sm text-[#666] transition-colors hover:text-white"
                >
                  Integrations
                </TrackedLink>
              </li>
              <li>
                <TrackedLink
                  href="/docs/cli"
                  event="footer_click"
                  eventParams={{ label: "docs_cli" }}
                  className="text-sm text-[#666] transition-colors hover:text-white"
                >
                  CLI
                </TrackedLink>
              </li>
              <li>
                <TrackedLink
                  href="/docs/faq"
                  event="footer_click"
                  eventParams={{ label: "docs_faq" }}
                  className="text-sm text-[#666] transition-colors hover:text-white"
                >
                  FAQ
                </TrackedLink>
              </li>
              <li>
                <TrackedLink
                  href="/docs/pricing"
                  event="footer_click"
                  eventParams={{ label: "docs_pricing" }}
                  className="text-sm text-[#666] transition-colors hover:text-white"
                >
                  Pricing
                </TrackedLink>
              </li>
              <li>
                <TrackedLink
                  href="/docs/changelog"
                  event="footer_click"
                  eventParams={{ label: "docs_changelog" }}
                  className="text-sm text-[#666] transition-colors hover:text-white"
                >
                  Changelog
                </TrackedLink>
              </li>
            </ul>
          </div>

          {/* Community */}
          <div>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-[0.15em] text-[#555]">
              Community
            </h4>
            <ul className="space-y-2">
              <li>
                <TrackedAnchor
                  href="https://github.com/octopusreview"
                  target="_blank"
                  rel="noopener noreferrer"
                  event="footer_click"
                  eventParams={{ label: "github" }}
                  className="flex items-center gap-1.5 text-sm text-[#666] transition-colors hover:text-white"
                >
                  <IconBrandGithub className="size-3.5" />
                  GitHub
                </TrackedAnchor>
              </li>
              <li>
                <TrackedAnchor
                  href={REDDIT_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  event="footer_click"
                  eventParams={{ label: "reddit" }}
                  className="flex items-center gap-1.5 text-sm text-[#666] transition-colors hover:text-white"
                >
                  <IconBrandReddit className="size-3.5" />
                  Reddit
                </TrackedAnchor>
              </li>
              <li>
                <TrackedAnchor
                  href="https://bsky.app/profile/octopus-review.ai"
                  target="_blank"
                  rel="noopener noreferrer"
                  event="footer_click"
                  eventParams={{ label: "bluesky" }}
                  className="flex items-center gap-1.5 text-sm text-[#666] transition-colors hover:text-white"
                >
                  <IconBrandBluesky className="size-3.5" />
                  Bluesky
                </TrackedAnchor>
              </li>
              <li>
                <TrackedAnchor
                  href="https://x.com/octopus_review"
                  target="_blank"
                  rel="noopener noreferrer"
                  event="footer_click"
                  eventParams={{ label: "twitter" }}
                  className="flex items-center gap-1.5 text-sm text-[#666] transition-colors hover:text-white"
                >
                  <IconBrandX className="size-3.5" />
                  X (Twitter)
                </TrackedAnchor>
              </li>
              <li>
                <TrackedAnchor
                  href={DISCORD_INVITE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  event="footer_click"
                  eventParams={{ label: "discord" }}
                  className="flex items-center gap-1.5 text-sm text-[#666] transition-colors hover:text-white"
                >
                  <IconBrandDiscord className="size-3.5" />
                  Discord
                </TrackedAnchor>
              </li>
              <li>
                <TrackedAnchor
                  href={LINKEDIN_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  event="footer_click"
                  eventParams={{ label: "linkedin" }}
                  className="flex items-center gap-1.5 text-sm text-[#666] transition-colors hover:text-white"
                >
                  <IconBrandLinkedin className="size-3.5" />
                  LinkedIn
                </TrackedAnchor>
              </li>
              <li>
                <TrackedAnchor
                  href="https://www.youtube.com/@OctopusReview"
                  target="_blank"
                  rel="noopener noreferrer"
                  event="footer_click"
                  eventParams={{ label: "youtube" }}
                  className="flex items-center gap-1.5 text-sm text-[#666] transition-colors hover:text-white"
                >
                  <IconBrandYoutube className="size-3.5" />
                  YouTube
                </TrackedAnchor>
              </li>
              <li>
                <TrackedAnchor
                  href="https://github.com/octopusreview/octopus/issues"
                  target="_blank"
                  rel="noopener noreferrer"
                  event="footer_click"
                  eventParams={{ label: "report_issue" }}
                  className="text-sm text-[#666] transition-colors hover:text-white"
                >
                  Report an Issue
                </TrackedAnchor>
              </li>
              <li>
                <GetInTouchModal className="text-sm text-[#666] transition-colors hover:text-white">
                  Get in Touch
                </GetInTouchModal>
              </li>
            </ul>
            <div className="shimmer-border mt-4 inline-block">
              <TrackedAnchor
                href="https://www.producthunt.com/products/octopus-5?utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-octopus-4"
                target="_blank"
                rel="noopener noreferrer"
                event="footer_click"
                eventParams={{ label: "product_hunt" }}
              >
                <Image
                  src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1102575&theme=dark"
                  alt="Octopus on Product Hunt"
                  width={180}
                  height={39}
                  unoptimized
                  loading="lazy"
                />
              </TrackedAnchor>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-10 flex flex-col items-center gap-3 border-t border-white/[0.06] pt-6 sm:flex-row sm:justify-between">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-[#333]">
              &copy; {new Date().getFullYear()} Octopus. Open source code review
              automation.
            </span>
            <span className="text-xs text-[#333]">
              3D model{" "}
              <a
                href="https://sketchfab.com/3d-models/octopus-lowpoly-rigged-52870f0c8cec4b29992bfda0854c7a30"
                target="_blank"
                rel="noopener noreferrer"
                className="underline transition-colors hover:text-white"
              >
                &quot;Octopus Lowpoly Rigged&quot;
              </a>{" "}
              by MushyDay,{" "}
              <a
                href="https://creativecommons.org/licenses/by/4.0/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline transition-colors hover:text-white"
              >
                CC BY 4.0
              </a>
            </span>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="https://claude.ai/code"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-[#444] transition-colors hover:text-white"
            >
              Powered by
              <Image src="/claude-color.svg" alt="" width={14} height={14} />
              <Image src="/claude-text.svg" alt="Claude" width={56} height={14} className="brightness-0 invert" />
            </a>
            <TrackedLink
              href="/docs/privacy"
              event="footer_click"
              eventParams={{ label: "privacy" }}
              className="text-xs text-[#444] transition-colors hover:text-white"
            >
              Privacy
            </TrackedLink>
            <TrackedLink
              href="/docs/terms"
              event="footer_click"
              eventParams={{ label: "terms" }}
              className="text-xs text-[#444] transition-colors hover:text-white"
            >
              Terms
            </TrackedLink>
            <TrackedLink
              href="/docs/cookies"
              event="footer_click"
              eventParams={{ label: "cookies" }}
              className="text-xs text-[#444] transition-colors hover:text-white"
            >
              Cookies
            </TrackedLink>
          </div>
        </div>
      </div>
    </footer>
  );
}
