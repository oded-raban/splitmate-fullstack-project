import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { Toaster } from "@/components/ui/sonner";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // The template appends the product name to every page's own title, so tabs
  // read "Expenses · SplitMate" without each page repeating the suffix.
  title: {
    default: "SplitMate — shared expenses without the awkward conversation",
    template: "%s · SplitMate",
  },
  description:
    "Track shared household expenses, split them fairly, see who owes what, and settle up in the fewest possible payments.",
  applicationName: "SplitMate",
  // `app/manifest.ts` supplies the PWA manifest itself (Next.js links it
  // automatically); this block covers the one platform that ignores the
  // manifest for these specifics — iOS reads its own home-screen title, status
  // bar style and "this is an installed app" flag from meta tags, not from
  // `manifest.webmanifest`, which Safari on iOS has never fully supported.
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "SplitMate",
  },
  // Stops iOS auto-linking anything that looks like a phone number in an
  // expense description or note — a "note: call 050-1234567 first" should
  // stay plain text, not become a tappable dialer link nobody asked for.
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  // The primary context for this app is a phone held in one hand in a shop, so
  // the mobile viewport is configured deliberately rather than left to default.
  width: "device-width",
  initialScale: 1,
  // Deliberately NOT disabling pinch-zoom (`userScalable: false`) here, even
  // though that is common in PWA boilerplate: it is a WCAG 1.4.4 accessibility
  // violation (Lighthouse and axe both flag it) because it stops anyone who
  // needs to zoom text beyond this layout's fixed sizing from doing so. An
  // installed icon and a standalone display mode are enough to "feel native"
  // without taking away a browser capability some users depend on.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        {children}
        {/* Mounted once at the root so any Server Action result, from any page,
            can raise a toast without each page wiring up its own container. */}
        <Toaster position="top-center" richColors />
      </body>
    </html>
  );
}
