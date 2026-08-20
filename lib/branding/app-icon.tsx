/**
 * The app icon, drawn once and reused everywhere Next.js needs an image.
 * =============================================================================
 * `app/icon.tsx`, `app/apple-icon.tsx` and the PWA manifest's 192/512/maskable
 * icon routes (`app/icon-192`, `app/icon-512`, `app/icon-512-maskable`) all
 * render this same shape at different sizes,
 * rather than shipping five hand-exported PNGs that could drift out of sync
 * with each other or with the wallet mark already used in
 * `components/layout/app-header.tsx`. One definition, five call sites.
 *
 * The path data is copied from `lucide-react`'s `Wallet` icon rather than
 * imported from the package, because `next/og`'s renderer (Satori) works from
 * a restricted JSX-to-SVG subset and does not execute arbitrary React
 * component trees — it needs the raw `<path>` markup, not a component that
 * produces it at runtime.
 */

const WALLET_PATHS = [
  "M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1",
  "M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4",
];

export interface AppIconOptions {
  /** Overall canvas size, in pixels. The icon is drawn centred within it. */
  size: number;
  /**
   * Fraction of `size` reserved as empty margin on every side. iOS and
   * Android both crop maskable/adaptive icons to their own shape (a circle,
   * a squircle, a rounded square depending on the launcher), so content
   * placed too close to the edge gets clipped unpredictably. A generous
   * margin keeps the wallet glyph inside every platform's safe zone.
   */
  padding?: number;
  background?: string;
  foreground?: string;
}

/** Matches the near-black badge behind the wallet glyph in the app header. */
export const BRAND_BACKGROUND = "#111111";
export const BRAND_FOREGROUND = "#ffffff";

export function AppIconMark({
  size,
  padding = 0.22,
  background = BRAND_BACKGROUND,
  foreground = BRAND_FOREGROUND,
}: AppIconOptions) {
  const glyphSize = Math.round(size * (1 - padding * 2));

  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background,
      }}
    >
      <svg
        width={glyphSize}
        height={glyphSize}
        viewBox="0 0 24 24"
        fill="none"
        stroke={foreground}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {WALLET_PATHS.map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    </div>
  );
}
