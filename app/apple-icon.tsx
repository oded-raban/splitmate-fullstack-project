import { ImageResponse } from "next/og";

import { AppIconMark } from "@/lib/branding/app-icon";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/**
 * iOS's "Add to Home Screen" reads this file by convention — no manifest
 * entry needed. iOS also applies its own corner-rounding mask on top of
 * whatever square is served here, which is why this is a plain filled
 * square rather than a pre-rounded one: a device that rounds an
 * already-rounded icon a second time doubles the effect at the corners.
 */
export default function AppleIcon() {
  return new ImageResponse(<AppIconMark size={180} padding={0.2} />, size);
}
