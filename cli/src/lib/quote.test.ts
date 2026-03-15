import { describe, it, expect } from "vitest";
import { applySlippage, encodeSwapPath } from "./quote.js";
import type { Address } from "viem";

describe("applySlippage", () => {
  it("applies 1% slippage (100 bps)", () => {
    expect(applySlippage(1000n, 100)).toBe(990n);
  });

  it("applies 0.5% slippage (50 bps)", () => {
    expect(applySlippage(10000n, 50)).toBe(9950n);
  });

  it("returns 0 for zero amount", () => {
    expect(applySlippage(0n, 100)).toBe(0n);
  });

  it("returns unchanged amount for 0 slippage", () => {
    expect(applySlippage(12345n, 0)).toBe(12345n);
  });

  it("returns 0 for 100% slippage (10000 bps)", () => {
    expect(applySlippage(12345n, 10000)).toBe(0n);
  });

  it("handles large amounts correctly", () => {
    const amount = 1000000000000000000n; // 1e18
    const result = applySlippage(amount, 100); // 1%
    expect(result).toBe(990000000000000000n); // 0.99e18
  });
});

describe("encodeSwapPath", () => {
  const tokenA = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address;
  const tokenB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address;
  const tokenC = "0xcccccccccccccccccccccccccccccccccccccccc" as Address;

  it("encodes 2-token path (single hop) as 43 bytes", () => {
    const path = encodeSwapPath([tokenA, tokenB], [500]);
    // 20 bytes (address) + 3 bytes (uint24 fee) + 20 bytes (address) = 43 bytes
    // hex: 0x prefix + 43*2 = 86 hex chars = 88 total
    expect(path.length).toBe(2 + 43 * 2);
  });

  it("encodes 3-token path (multi hop) as 66 bytes", () => {
    const path = encodeSwapPath([tokenA, tokenB, tokenC], [500, 3000]);
    // 20 + 3 + 20 + 3 + 20 = 66 bytes
    expect(path.length).toBe(2 + 66 * 2);
  });

  it("throws on single token", () => {
    expect(() => encodeSwapPath([tokenA], [])).toThrow("Invalid path");
  });

  it("throws on mismatched fees length", () => {
    expect(() => encodeSwapPath([tokenA, tokenB], [500, 3000])).toThrow("Invalid path");
  });

  it("throws on empty tokens", () => {
    expect(() => encodeSwapPath([], [])).toThrow("Invalid path");
  });

  it("includes token addresses in output", () => {
    const path = encodeSwapPath([tokenA, tokenB], [500]);
    // Token addresses should appear (without 0x prefix, lowercase)
    expect(path.toLowerCase()).toContain("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(path.toLowerCase()).toContain("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  });
});
