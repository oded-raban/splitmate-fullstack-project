import type { MetadataRoute } from "next";

import { BRAND_BACKGROUND } from "@/lib/branding/app-icon";

/**
 * The Web App Manifest — what turns "a website" into "something a phone
 * offers to install."
 * =============================================================================
 * Next.js serves this file's return value at `/manifest.webmanifest` and
 * links it from every page automatically; nothing in `app/layout.tsx` needs
 * to reference it by hand.
 *
 * `start_url: "/app"` rather than `/`, deliberately: `/` for a signed-out
 * visitor is the login screen, and for a signed-in one it 307-redirects to
 * `/app` anyway (`lib/supabase/proxy.ts`). Launching an installed icon
 * straight at the real destination skips a redirect hop on literally every
 * open, which matters far more for an icon someone taps ten times a day than
 * it would for a one-off page load.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SplitMate — shared household expenses",
    short_name: "SplitMate",
    description:
      "Track shared household expenses, split them fairly, see who owes what, and settle up in the fewest possible payments.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    // Matches the header's near-black wallet badge (components/layout/app-header.tsx)
    // and the icon artwork itself (lib/branding/app-icon.tsx), so the launch
    // splash screen a phone briefly shows never clashes with the icon above it.
    background_color: "#ffffff",
    theme_color: BRAND_BACKGROUND,
    orientation: "portrait-primary",
    icons: [
      { src: "/icon-192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon-512-maskable",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
