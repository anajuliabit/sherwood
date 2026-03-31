/**
 * Unit tests for contract error decoding.
 * Tests decodeContractError and formatContractError from errors.ts.
 */

import { describe, it, expect } from "vitest";
import { toFunctionSelector } from "viem";
import { decodeContractError, formatContractError } from "./errors.js";

// ── decodeContractError ──

describe("decodeContractError", () => {
  it("decodes RedemptionsLocked selector", () => {
    const selector = toFunctionSelector("RedemptionsLocked()") as `0x${string}`;
    const result = decodeContractError(selector);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("RedemptionsLocked");
    expect(result!.message.toLowerCase()).toMatch(/lock/);
  });

  it("decodes NotApprovedDepositor selector", () => {
    const selector = toFunctionSelector("NotApprovedDepositor()") as `0x${string}`;
    const result = decodeContractError(selector);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("NotApprovedDepositor");
    expect(result!.message.length).toBeGreaterThan(0);
  });

  it("decodes AgentAlreadyRegistered selector", () => {
    const selector = toFunctionSelector("AgentAlreadyRegistered()") as `0x${string}`;
    const result = decodeContractError(selector);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("AgentAlreadyRegistered");
  });

  it("returns null for unknown selector", () => {
    expect(decodeContractError("0xdeadbeef")).toBeNull();
  });

  it("returns null for a selector that is all zeros", () => {
    expect(decodeContractError("0x00000000")).toBeNull();
  });
});

// ── formatContractError ──

describe("formatContractError", () => {
  it("handles ERC20: insufficient allowance", () => {
    const err = new Error("ERC20: insufficient allowance");
    const msg = formatContractError(err);
    expect(msg.toLowerCase()).toMatch(/allowance/);
  });

  it("handles ERC20: transfer amount exceeds balance", () => {
    const err = new Error("ERC20: transfer amount exceeds balance");
    const msg = formatContractError(err);
    expect(msg.toLowerCase()).toMatch(/balance|transfer/);
  });

  it("handles ERC20: transfer amount exceeds allowance", () => {
    const err = new Error("ERC20: transfer amount exceeds allowance");
    const msg = formatContractError(err);
    expect(msg.toLowerCase()).toMatch(/allowance/);
  });

  it("handles replacement transaction underpriced — rephrases message", () => {
    const err = new Error("replacement transaction underpriced");
    const msg = formatContractError(err);
    // Should produce a different, user-friendly string — not the raw error
    expect(msg).not.toBe("replacement transaction underpriced");
    expect(typeof msg).toBe("string");
    expect(msg.length).toBeGreaterThan(10);
  });

  it("handles nonce too low", () => {
    const err = new Error("nonce too low");
    const msg = formatContractError(err);
    expect(msg.toLowerCase()).toMatch(/nonce/);
  });

  it("handles NONCE_EXPIRED", () => {
    const err = new Error("NONCE_EXPIRED");
    const msg = formatContractError(err);
    expect(msg.toLowerCase()).toMatch(/nonce/);
  });

  it("handles insufficient funds for gas", () => {
    const err = new Error("insufficient funds for gas");
    const msg = formatContractError(err);
    expect(msg.toLowerCase()).toMatch(/eth|gas|fund/);
  });

  it("returns a non-empty string for completely unknown errors", () => {
    const err = new Error("completely unknown error xyz789abc");
    const msg = formatContractError(err);
    expect(typeof msg).toBe("string");
    expect(msg.length).toBeGreaterThan(0);
  });

  it("does not throw for non-Error inputs", () => {
    expect(() => formatContractError("raw string error")).not.toThrow();
    expect(() => formatContractError(null)).not.toThrow();
    expect(() => formatContractError(undefined)).not.toThrow();
    expect(() => formatContractError({ message: "obj error" })).not.toThrow();
  });

  it("decodes a known contract error embedded in the message string", () => {
    // Simulate a viem error where the message contains the signature
    const selector = toFunctionSelector("RedemptionsLocked()");
    const err = new Error(`Contract call reverted with signature "${selector}"`);
    const msg = formatContractError(err);
    expect(msg.toLowerCase()).toMatch(/lock/);
  });
});
