/**
 * Unit tests for syndicate membership config functions.
 * Tests addSyndicate, getSyndicates, setPrimarySyndicate, getPrimarySyndicate.
 *
 * Mocks node:fs to avoid touching ~/.sherwood/config.json.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ── In-memory store (created before vi.mock is registered) ──

const { store } = vi.hoisted(() => {
  const store: Record<string, string> = {};
  return { store };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();

  // config.ts uses `import fs from "node:fs"` (default import).
  // For CJS modules in vitest, the default export is the module.exports object.
  // We must override both named exports AND default to intercept all import styles.
  const existsSync = (p: unknown) => (p as string) in store;
  const readFileSync = (p: unknown, _enc?: unknown) => store[p as string] ?? "";
  const writeFileSync = (p: unknown, data: unknown, _opts?: unknown) => {
    store[p as string] = String(data);
  };
  const mkdirSync = (_p: unknown, _opts?: unknown) => undefined;

  const overrides = { existsSync, readFileSync, writeFileSync, mkdirSync };
  const cjsDefault = (actual as unknown as { default: Record<string, unknown> }).default;

  return {
    ...actual,
    ...overrides,
    default: { ...cjsDefault, ...overrides },
  };
});

import path from "node:path";
import os from "node:os";
import {
  addSyndicate,
  getSyndicates,
  setPrimarySyndicate,
  getPrimarySyndicate,
  saveConfig,
} from "./config.js";

// Mirrors the path that config.ts computes
const CONFIG_PATH = path.join(os.homedir(), ".sherwood", "config.json");

// Reset in-memory store before each test so tests are isolated
beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
});

// ── addSyndicate ──

describe("addSyndicate", () => {
  it("stores a syndicate membership for a chain", () => {
    addSyndicate(8453, { subdomain: "test-fund", vault: "0x1234", role: "creator" });
    const members = getSyndicates(8453);
    expect(members).toHaveLength(1);
    expect(members[0].subdomain).toBe("test-fund");
    expect(members[0].vault).toBe("0x1234");
    expect(members[0].role).toBe("creator");
  });

  it("deduplicates by subdomain (upserts on second add)", () => {
    addSyndicate(8453, { subdomain: "test-fund", vault: "0x1234", role: "creator" });
    addSyndicate(8453, { subdomain: "test-fund", vault: "0x9999", role: "creator" });
    const members = getSyndicates(8453);
    expect(members).toHaveLength(1);
    expect(members[0].vault).toBe("0x9999"); // updated
  });

  it("stores multiple different syndicates", () => {
    addSyndicate(8453, { subdomain: "fund-a", vault: "0x1111", role: "creator" });
    addSyndicate(8453, { subdomain: "fund-b", vault: "0x2222", role: "agent" });
    expect(getSyndicates(8453)).toHaveLength(2);
  });

  it("auto-sets first syndicate as primary", () => {
    addSyndicate(8453, { subdomain: "first-fund", vault: "0x1234", role: "creator" });
    const primary = getPrimarySyndicate(8453);
    expect(primary?.subdomain).toBe("first-fund");
  });

  it("does not overwrite primary when a second syndicate is added", () => {
    addSyndicate(8453, { subdomain: "first-fund", vault: "0x1111", role: "creator" });
    addSyndicate(8453, { subdomain: "second-fund", vault: "0x2222", role: "agent" });
    const primary = getPrimarySyndicate(8453);
    expect(primary?.subdomain).toBe("first-fund");
  });

  it("isolates memberships by chainId", () => {
    addSyndicate(8453, { subdomain: "mainnet-fund", vault: "0x1111", role: "creator" });
    addSyndicate(84532, { subdomain: "testnet-fund", vault: "0x2222", role: "creator" });
    expect(getSyndicates(8453)).toHaveLength(1);
    expect(getSyndicates(84532)).toHaveLength(1);
    expect(getSyndicates(8453)[0].subdomain).toBe("mainnet-fund");
    expect(getSyndicates(84532)[0].subdomain).toBe("testnet-fund");
  });
});

// ── getSyndicates ──

describe("getSyndicates", () => {
  it("returns empty array when no syndicates stored", () => {
    expect(getSyndicates(8453)).toEqual([]);
  });

  it("returns empty array for unknown chainId", () => {
    addSyndicate(8453, { subdomain: "fund-a", vault: "0x1111", role: "creator" });
    expect(getSyndicates(999)).toEqual([]);
  });
});

// ── setPrimarySyndicate / getPrimarySyndicate ──

describe("setPrimarySyndicate", () => {
  it("sets the active syndicate", () => {
    addSyndicate(8453, { subdomain: "fund-a", vault: "0x1111", role: "creator" });
    addSyndicate(8453, { subdomain: "fund-b", vault: "0x2222", role: "creator" });
    setPrimarySyndicate(8453, "fund-b");
    expect(getPrimarySyndicate(8453)?.subdomain).toBe("fund-b");
  });

  it("does not affect other chains", () => {
    addSyndicate(8453, { subdomain: "mainnet-fund", vault: "0x1111", role: "creator" });
    addSyndicate(84532, { subdomain: "testnet-fund", vault: "0x2222", role: "creator" });
    setPrimarySyndicate(8453, "mainnet-fund");
    expect(getPrimarySyndicate(84532)?.subdomain).toBe("testnet-fund");
  });
});

describe("getPrimarySyndicate", () => {
  it("returns the explicitly set primary", () => {
    addSyndicate(8453, { subdomain: "fund-a", vault: "0x1111", role: "creator" });
    addSyndicate(8453, { subdomain: "fund-b", vault: "0x2222", role: "agent" });
    setPrimarySyndicate(8453, "fund-b");
    expect(getPrimarySyndicate(8453)?.subdomain).toBe("fund-b");
  });

  it("falls back to first syndicate in list when no explicit primary set", () => {
    // Write a config with syndicates but no primarySyndicate key
    saveConfig({
      groupCache: {},
      syndicates: {
        "8453": [
          { subdomain: "fund-first", vault: "0x1111", role: "creator" },
          { subdomain: "fund-second", vault: "0x2222", role: "agent" },
        ],
      },
    });
    expect(getPrimarySyndicate(8453)?.subdomain).toBe("fund-first");
  });

  it("returns undefined when no syndicates and no legacy vault", () => {
    expect(getPrimarySyndicate(8453)).toBeUndefined();
  });

  it("falls back to legacy contracts.vault for old configs (backwards compat)", () => {
    // Legacy config: only has contracts[chainId].vault, no syndicates field
    saveConfig({
      groupCache: {},
      contracts: {
        "8453": { vault: "0xlegacyvault" },
      },
    });
    const primary = getPrimarySyndicate(8453);
    expect(primary).not.toBeUndefined();
    expect(primary!.vault).toBe("0xlegacyvault");
    expect(primary!.subdomain).toBe(""); // legacy compat returns empty subdomain
  });
});
