import { ImageResponse } from "next/og";

import { AppIconMark } from "@/lib/branding/app-icon";

export const contentType = "image/png";

/**
 * Browsers request several favicon sizes from one tab, one bookmark, one
 * shortcut. `generateImageMetadata` lets a single file answer all of them
 * instead of hand-exporting three near-identical PNGs.
 */
export function generateImageMetadata() {
  return [
    { id: "16", size: { width: 16, height: 16 } },
    { id: "32", size: { width: 32, height: 32 } },
    { id: "48", size: { width: 48, height: 48 } },
  ];
}

export default async function Icon({ id }: { id: Promise<string> }) {
  // Next resolves `id` lazily — it is a Promise, not a plain string, so that
  // an `id` nobody ends up needing (a request for a size this file never
  // declared) never forces the framework to await it. Passing it straight to
  // `Number()` without awaiting silently produces `NaN`, which Satori then
  // fails to render with an opaque "inputValue.trim is not a function" error
  // deep inside its CSS parser — a genuinely confusing failure for what is,
  // underneath, a missing `await`.
  const size = Number(await id);

  return new ImageResponse(<AppIconMark size={size} padding={0.16} />, {
    width: size,
    height: size,
  });
}
