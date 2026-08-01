import type { NextConfig } from "next";

/**
 * Security response headers.
 * -----------------------------------------------------------------------------
 * Applied to every route. These are the headers that are safe to set statically;
 * a Content-Security-Policy needs per-request nonces to work with Next.js's
 * inline bootstrap scripts, so it is added in the proxy layer during the
 * hardening phase rather than being weakened here with 'unsafe-inline'.
 */
const securityHeaders = [
  {
    // Stops a browser from second-guessing a declared Content-Type. Without it,
    // an uploaded receipt served as an image could be sniffed as HTML and
    // executed in our origin.
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    // Blocks framing, which defeats clickjacking — an invisible overlay of our
    // "settle up" button on someone else's page.
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    // Send the full URL only to ourselves. Household and expense IDs live in our
    // paths, and there is no reason to leak them to a third-party host.
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    // We use none of these APIs; denying them means a future dependency cannot
    // quietly start using one.
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  {
    // Force HTTPS for two years, including subdomains. Vercel serves HTTPS
    // anyway; this stops the very first request of a session going out in clear
    // text, which is the one that carries the session cookie.
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },

  images: {
    // Receipts are served from Supabase Storage via short-lived signed URLs.
    // `remotePatterns` (not the deprecated `domains`) restricts the optimizer to
    // our own project, so it cannot be used as an open image proxy for arbitrary
    // third-party URLs.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/**",
      },
    ],
  },
};

export default nextConfig;
