import { ImageResponse } from "next/og";

import { AppIconMark } from "@/lib/branding/app-icon";

/** See `app/icon-192/route.tsx` for why this is a route handler. */
export async function GET() {
  return new ImageResponse(<AppIconMark size={512} padding={0.18} />, {
    width: 512,
    height: 512,
  });
}
