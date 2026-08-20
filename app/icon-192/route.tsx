import { ImageResponse } from "next/og";

import { AppIconMark } from "@/lib/branding/app-icon";

/**
 * Referenced from `app/manifest.ts`. A route handler rather than the
 * `icon.tsx`/`apple-icon.tsx` file convention because those two are reserved
 * for the browser-tab favicon and the iOS home-screen icon respectively —
 * the PWA manifest's `icons` array needs its own, explicitly-sized URLs, and
 * a route handler is the most direct way to serve one without checking a
 * static PNG into the repository that could drift from `AppIconMark`.
 */
export async function GET() {
  return new ImageResponse(<AppIconMark size={192} padding={0.18} />, {
    width: 192,
    height: 192,
  });
}
