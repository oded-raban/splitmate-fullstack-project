import { ImageResponse } from "next/og";

import { AppIconMark } from "@/lib/branding/app-icon";

/**
 * Android's adaptive-icon system crops a "maskable" icon to a shape the
 * launcher chooses (circle, squircle, rounded square) and can legally clip
 * anywhere outside the centre ~40% radius "safe zone" (W3C's maskable icon
 * spec). A generous 30% padding on every side keeps the wallet glyph well
 * inside that circle regardless of which shape a given launcher picks,
 * unlike `icon-512`'s tighter padding, which assumes the full square is shown.
 */
export async function GET() {
  return new ImageResponse(<AppIconMark size={512} padding={0.3} />, {
    width: 512,
    height: 512,
  });
}
