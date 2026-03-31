/**
 * Unit tests for EAS referral helper functions.
 * Tests formatMessageWithRef, parseReferrer, stripReferrerPrefix from eas.ts.
 *
 * These are pure string functions — no mocks needed.
 */

import { describe, it, expect } from "vitest";
import { formatMessageWithRef, parseReferrer, stripReferrerPrefix } from "./eas.js";

// ── formatMessageWithRef ──

describe("formatMessageWithRef", () => {
  it("prepends [ref:N] prefix when referrerAgentId is provided", () => {
    expect(formatMessageWithRef("Hello world", 42)).toBe("[ref:42] Hello world");
  });

  it("returns message unchanged when referrerAgentId is undefined", () => {
    expect(formatMessageWithRef("Hello world", undefined)).toBe("Hello world");
  });

  it("returns message unchanged when referrerAgentId is null (cast)", () => {
    // null coerces to null in the null check — should not add prefix
    expect(formatMessageWithRef("Hello", null as unknown as number)).toBe("Hello");
  });

  it("handles agent ID 0 (falsy but valid)", () => {
    // 0 == null is false, so it should prepend
    expect(formatMessageWithRef("msg", 0)).toBe("[ref:0] msg");
  });

  it("handles large agent IDs", () => {
    expect(formatMessageWithRef("text", 99999)).toBe("[ref:99999] text");
  });

  it("handles empty message string", () => {
    expect(formatMessageWithRef("", 5)).toBe("[ref:5] ");
  });

  it("does not double-prefix an already-prefixed message", () => {
    // formatMessageWithRef doesn't check for existing prefix — that's fine
    // just confirm it prepends another
    const once = formatMessageWithRef("msg", 10);
    const twice = formatMessageWithRef(once, 20);
    expect(twice).toBe("[ref:20] [ref:10] msg");
  });
});

// ── parseReferrer ──

describe("parseReferrer", () => {
  it("extracts agent ID from [ref:42] prefix", () => {
    expect(parseReferrer("[ref:42] Hello")).toBe(42);
  });

  it("returns null when no ref prefix", () => {
    expect(parseReferrer("No ref here")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseReferrer("")).toBeNull();
  });

  it("handles large agent IDs", () => {
    expect(parseReferrer("[ref:9999] test message")).toBe(9999);
  });

  it("returns null for malformed prefix (missing brackets)", () => {
    expect(parseReferrer("ref:42 message")).toBeNull();
  });

  it("returns null when prefix is in the middle of the message", () => {
    // The regex is anchored to the start with ^
    expect(parseReferrer("some text [ref:42] at end")).toBeNull();
  });

  it("handles agent ID 0", () => {
    expect(parseReferrer("[ref:0] msg")).toBe(0);
  });
});

// ── stripReferrerPrefix ──

describe("stripReferrerPrefix", () => {
  it("removes [ref:N] prefix and trailing space", () => {
    expect(stripReferrerPrefix("[ref:42] Hello")).toBe("Hello");
  });

  it("returns message unchanged when no prefix", () => {
    expect(stripReferrerPrefix("No ref here")).toBe("No ref here");
  });

  it("returns empty string when message is only the prefix", () => {
    expect(stripReferrerPrefix("[ref:42] ")).toBe("");
  });

  it("handles multiword message after prefix", () => {
    expect(stripReferrerPrefix("[ref:1] Join this syndicate today")).toBe("Join this syndicate today");
  });

  it("is consistent with formatMessageWithRef (round-trip)", () => {
    const original = "Let me join your fund";
    const withRef = formatMessageWithRef(original, 7);
    const stripped = stripReferrerPrefix(withRef);
    expect(stripped).toBe(original);

    const parsed = parseReferrer(withRef);
    expect(parsed).toBe(7);
  });
});
