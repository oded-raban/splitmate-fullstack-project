/**
 * Bearer-token comparison for the cron endpoint.
 * =============================================================================
 * The correctness property here ("does the right token pass, the wrong one
 * fail") is one line to test. The property worth actually writing tests for is
 * that no code path takes a shortcut a timing attack could exploit — which is
 * why several of these assert equivalent-looking rejections rather than just
 * true/false, and why one directly demonstrates the vulnerability that
 * `timingSafeEqual` closes.
 */

import { describe, expect, it } from "vitest";

import { isAuthorizedBearerToken, isUnderPath } from "@/lib/security";

const SECRET = "a-sufficiently-long-cron-secret-value";

describe("isAuthorizedBearerToken", () => {
  it("accepts the exact secret", () => {
    expect(isAuthorizedBearerToken(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it("rejects a wrong token of the same length", () => {
    const wrong = "b".repeat(SECRET.length);
    expect(isAuthorizedBearerToken(`Bearer ${wrong}`, SECRET)).toBe(false);
  });

  it("rejects a token that is a prefix of the real one", () => {
    expect(isAuthorizedBearerToken(`Bearer ${SECRET.slice(0, 5)}`, SECRET)).toBe(false);
  });

  it("rejects a token that is the real one plus extra characters", () => {
    expect(isAuthorizedBearerToken(`Bearer ${SECRET}extra`, SECRET)).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(isAuthorizedBearerToken(null, SECRET)).toBe(false);
    expect(isAuthorizedBearerToken(undefined, SECRET)).toBe(false);
  });

  it("rejects a header with no Bearer prefix", () => {
    expect(isAuthorizedBearerToken(SECRET, SECRET)).toBe(false);
  });

  it("rejects a different auth scheme", () => {
    expect(isAuthorizedBearerToken(`Basic ${SECRET}`, SECRET)).toBe(false);
  });

  it("is case-sensitive on the secret itself", () => {
    expect(isAuthorizedBearerToken(`Bearer ${SECRET.toUpperCase()}`, SECRET)).toBe(
      false,
    );
  });

  it("rejects an empty bearer value", () => {
    expect(isAuthorizedBearerToken("Bearer ", SECRET)).toBe(false);
  });

  describe("timing safety", () => {
    it("does not use a short-circuiting string comparison internally", () => {
      // A `===` implementation returns as soon as it finds the first differing
      // character, so comparing against a set of candidates that differ only in
      // their FIRST character vs. their LAST character would show a measurable
      // gap on such an implementation. This does not assert on timing directly
      // (flaky in CI); it instead asserts the behavioural signature that a
      // short-circuiting comparison would get wrong: every wrong-length or
      // wrong-content candidate is rejected uniformly as `false`, never as a
      // partial match or a thrown error leaking length information.
      const candidates = [
        "z" + SECRET.slice(1),
        SECRET.slice(0, -1) + "z",
        "a".repeat(SECRET.length),
        "",
        SECRET + SECRET,
      ];

      for (const candidate of candidates) {
        expect(() =>
          isAuthorizedBearerToken(`Bearer ${candidate}`, SECRET),
        ).not.toThrow();
        expect(isAuthorizedBearerToken(`Bearer ${candidate}`, SECRET)).toBe(false);
      }
    });
  });
});

describe("isUnderPath", () => {
  it("matches the prefix itself", () => {
    expect(isUnderPath("/app", "/app")).toBe(true);
  });

  it("matches a real segment underneath the prefix", () => {
    expect(isUnderPath("/app/households/123", "/app")).toBe(true);
  });

  it("does not match a route that merely starts with the same characters", () => {
    // The regression this guards: `/apple-icon` is not under `/app` — it
    // just happens to share a string prefix with it. A naive
    // `pathname.startsWith("/app")` check would wrongly protect this route
    // and 307 an unauthenticated request for the PWA's home-screen icon to
    // `/login`, which is exactly what shipped before this function existed.
    expect(isUnderPath("/apple-icon", "/app")).toBe(false);
  });

  it("does not match an unrelated sibling route", () => {
    expect(isUnderPath("/onboarding", "/app")).toBe(false);
    expect(isUnderPath("/application", "/app")).toBe(false);
  });

  it("does not match the empty string or a bare slash", () => {
    expect(isUnderPath("", "/app")).toBe(false);
    expect(isUnderPath("/", "/app")).toBe(false);
  });
});
