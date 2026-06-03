import type { Metadata } from "next";
import { Geist, Geist_Mono, Public_Sans } from "next/font/google";
import Script from "next/script";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { VersionChecker } from "@/components/version-checker";
import { GlobalErrorHandler } from "@/components/global-error-handler";
import { TopLoader } from "@/components/top-loader";
import "./globals.css";

const publicSans = Public_Sans({subsets:['latin'],variable:'--font-sans'});

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_URL = "https://octopus-review.ai";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "AI Code Review | Octopus | Every PR, Reviewed in Minutes",
    template: "%s | Octopus",
  },
  description:
    "Octopus reviews every pull request in minutes with AI. Works with GitHub, GitLab, and Bitbucket. Indexes your codebase, analyzes diffs, and posts severity-rated findings to catch bugs before they merge.",
  keywords: [
    "code review",
    "AI code review",
    "pull request review",
    "automated code review",
    "GitHub code review",
    "GitLab code review",
    "Bitbucket code review",
    "codebase indexing",
    "severity-rated findings",
    "Claude",
    "OpenAI",
    "code quality",
  ],
  authors: [{ name: "Octopus" }],
  creator: "Octopus",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: "Octopus",
    title: "AI Code Review | Octopus | Every PR, Reviewed in Minutes",
    description:
      "Octopus reviews every pull request in minutes with AI. Works with GitHub, GitLab, and Bitbucket. Indexes your codebase, analyzes diffs, and posts severity-rated findings to catch bugs before they merge.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Octopus — AI-Powered Automated Code Review",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Code Review | Octopus | Every PR, Reviewed in Minutes",
    description:
      "Octopus reviews every pull request in minutes with AI. Works with GitHub, GitLab, and Bitbucket. Catch bugs before they merge.",
    images: ["/og-image.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  alternates: {
    canonical: SITE_URL,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={publicSans.variable} suppressHydrationWarning>
      <head>
        <meta name="apple-mobile-web-app-title" content="Octopus" />
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-BNFCHLD0BY"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-BNFCHLD0BY');
          `}
        </Script>
        <Script id="twitter-pixel" strategy="afterInteractive">
          {`
            !function(e,t,n,s,u,a){e.twq||(s=e.twq=function(){s.exe?s.exe.apply(s,arguments):s.queue.push(arguments);
            },s.version='1.1',s.queue=[],u=t.createElement(n),u.async=!0,u.src='https://static.ads-twitter.com/uwt.js',
            a=t.getElementsByTagName(n)[0],a.parentNode.insertBefore(u,a))}(window,document,'script');
            twq('config','rc11o');
          `}
        </Script>
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <TopLoader />
          <TooltipProvider>
            {children}
          </TooltipProvider>
          <VersionChecker />
          <GlobalErrorHandler />
          <Toaster richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}
