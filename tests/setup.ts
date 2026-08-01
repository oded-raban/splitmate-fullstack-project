/**
 * Test setup for the jsdom (component) project.
 * -----------------------------------------------------------------------------
 * Registers the jest-dom matchers (`toBeInTheDocument`, `toHaveAccessibleName`,
 * ...) and guarantees a clean DOM between tests. Testing Library auto-cleans
 * when `globals: true` is set, but the explicit call documents the intent and
 * keeps the suite correct if that option ever changes.
 *
 * It also stubs the browser APIs that jsdom does not implement but that Radix
 * primitives call during render. Without these stubs, opening a dialog or a
 * select in a test throws — a failure that has nothing to do with our code.
 */

import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
});

// Radix uses ResizeObserver for positioning popovers, dropdowns and selects.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Radix checks these before locking scroll / animating overlays.
if (typeof window !== "undefined") {
  window.HTMLElement.prototype.scrollIntoView ??= () => {};
  window.HTMLElement.prototype.hasPointerCapture ??= () => false;
  window.HTMLElement.prototype.releasePointerCapture ??= () => {};

  // `matchMedia` is used by the theme switcher and by responsive components.
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}
