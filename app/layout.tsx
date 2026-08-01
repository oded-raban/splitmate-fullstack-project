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
};

export const viewport: Viewport = {
  // The primary context for this app is a phone held in one hand in a shop, so
  // the mobile viewport is configured deliberately rather than left to default.
  width: "device-width",
  initialScale: 1,
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
