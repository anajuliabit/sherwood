import { describe, it, expect } from "vitest";
import { formatBatch, type BatchCall } from "./batch.js";
import type { Address, Hex } from "viem";

describe("formatBatch", () => {
  const target = "0x1234567890abcdef1234567890abcdef12345678" as Address;

  it("formats a single call with selector and no value", () => {
    const calls: BatchCall[] = [
      { target, data: "0x095ea7b3000000000000" as Hex, value: 0n },
    ];
    const output = formatBatch(calls);
    expect(output).toContain("1.");
    expect(output).toContain(target);
    expect(output).toContain("0x095ea7b3");
    expect(output).toContain("no value");
  });

  it("formats multiple calls with sequential numbering", () => {
    const calls: BatchCall[] = [
      { target, data: "0xaaaaaaaa00" as Hex, value: 0n },
      { target, data: "0xbbbbbbbb00" as Hex, value: 0n },
      { target, data: "0xcccccccc00" as Hex, value: 0n },
    ];
    const output = formatBatch(calls);
    expect(output).toContain("1.");
    expect(output).toContain("2.");
    expect(output).toContain("3.");
  });

  it("shows wei amount for non-zero value calls", () => {
    const calls: BatchCall[] = [
      { target, data: "0xaaaaaaaa00" as Hex, value: 1000000000000000000n },
    ];
    const output = formatBatch(calls);
    expect(output).toContain("1000000000000000000 wei");
  });
});
