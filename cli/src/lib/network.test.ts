import { describe, it, expect, beforeEach } from "vitest";
import { setNetwork, getNetwork, getChain, getRpcUrl, getExplorerUrl, isTestnet } from "./network.js";

describe("network", () => {
  beforeEach(() => {
    // Reset to default
    setNetwork("base");
  });

  describe("setNetwork / getNetwork", () => {
    it("defaults to base", () => {
      expect(getNetwork()).toBe("base");
    });

    it("can be set to base-sepolia", () => {
      setNetwork("base-sepolia");
      expect(getNetwork()).toBe("base-sepolia");
    });

    it("can be set back to base", () => {
      setNetwork("base-sepolia");
      setNetwork("base");
      expect(getNetwork()).toBe("base");
    });
  });

  describe("getChain", () => {
    it("returns base chain for mainnet", () => {
      setNetwork("base");
      const chain = getChain();
      expect(chain.id).toBe(8453);
      expect(chain.name).toBe("Base");
    });

    it("returns baseSepolia chain for testnet", () => {
      setNetwork("base-sepolia");
      const chain = getChain();
      expect(chain.id).toBe(84532);
      expect(chain.name).toBe("Base Sepolia");
    });
  });

  describe("getRpcUrl", () => {
    it("falls back to public base URL when no env var", () => {
      const originalEnv = process.env.BASE_RPC_URL;
      delete process.env.BASE_RPC_URL;
      setNetwork("base");
      expect(getRpcUrl()).toBe("https://mainnet.base.org");
      if (originalEnv) process.env.BASE_RPC_URL = originalEnv;
    });

    it("falls back to public sepolia URL when no env var", () => {
      const originalEnv = process.env.BASE_SEPOLIA_RPC_URL;
      delete process.env.BASE_SEPOLIA_RPC_URL;
      setNetwork("base-sepolia");
      expect(getRpcUrl()).toBe("https://sepolia.base.org");
      if (originalEnv) process.env.BASE_SEPOLIA_RPC_URL = originalEnv;
    });

    it("uses env var when set", () => {
      const originalEnv = process.env.BASE_RPC_URL;
      process.env.BASE_RPC_URL = "https://custom-rpc.example.com";
      setNetwork("base");
      expect(getRpcUrl()).toBe("https://custom-rpc.example.com");
      if (originalEnv) process.env.BASE_RPC_URL = originalEnv;
      else delete process.env.BASE_RPC_URL;
    });
  });

  describe("getExplorerUrl", () => {
    it("returns basescan URL for mainnet", () => {
      setNetwork("base");
      const url = getExplorerUrl("0xabc123");
      expect(url).toBe("https://basescan.org/tx/0xabc123");
    });

    it("returns sepolia basescan URL for testnet", () => {
      setNetwork("base-sepolia");
      const url = getExplorerUrl("0xabc123");
      expect(url).toBe("https://sepolia.basescan.org/tx/0xabc123");
    });
  });

  describe("isTestnet", () => {
    it("returns false for base", () => {
      setNetwork("base");
      expect(isTestnet()).toBe(false);
    });

    it("returns true for base-sepolia", () => {
      setNetwork("base-sepolia");
      expect(isTestnet()).toBe(true);
    });
  });
});
