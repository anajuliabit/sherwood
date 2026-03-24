/**
 * Tests for nonce management: stuck detection, gas bumping, retry logic.
 *
 * Unit tests that mock viem at the transport layer.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Hex } from "viem";

// ── Test the pure logic extracted from client.ts ──
// We test the exported helpers by mocking the underlying viem client calls.

// Mock getPublicClient, getWalletClient, getAccount at module level
const mockGetTransactionCount = vi.fn<(args: { address: string; blockTag: string }) => Promise<number>>();
const mockEstimateFeesPerGas = vi.fn();
const mockWaitForTransactionReceipt = vi.fn();
const mockSendTransaction = vi.fn<(args: Record<string, unknown>) => Promise<Hex>>();
const mockWriteContract = vi.fn<(args: Record<string, unknown>) => Promise<Hex>>();

const TEST_ADDRESS = "0x1234567890AbcdEF1234567890aBcdef12345678" as const;

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: () => ({
      getTransactionCount: mockGetTransactionCount,
      estimateFeesPerGas: mockEstimateFeesPerGas,
      waitForTransactionReceipt: mockWaitForTransactionReceipt,
      chain: { id: 8453 },
    }),
    createWalletClient: () => ({
      sendTransaction: mockSendTransaction,
      writeContract: mockWriteContract,
      chain: { id: 8453 },
    }),
  };
});

vi.mock("viem/accounts", () => ({
  privateKeyToAccount: () => ({
    address: TEST_ADDRESS,
  }),
}));

vi.mock("./network.js", () => ({
  getChain: () => ({ id: 8453, name: "Base" }),
  getRpcUrl: () => "https://mainnet.base.org",
}));

vi.mock("./config.js", () => ({
  loadConfig: () => ({ privateKey: "0x" + "ab".repeat(32) }),
}));

// Import after mocks
const clientModule = await import("./client.js");

// ── Setup ──

const BASE_FEES = {
  maxFeePerGas: 1000000000n,
  maxPriorityFeePerGas: 100000000n,
};

beforeEach(() => {
  vi.clearAllMocks();
  clientModule.resetClients();
  mockEstimateFeesPerGas.mockResolvedValue(BASE_FEES);
  mockWaitForTransactionReceipt.mockResolvedValue({
    status: "success",
    transactionHash: "0xabc" as Hex,
  });
});

// ── detectStuckNonce ──

describe("detectStuckNonce", () => {
  it("returns null when pending == confirmed (no stuck tx)", async () => {
    mockGetTransactionCount.mockResolvedValue(5);
    const result = await clientModule.detectStuckNonce();
    expect(result).toBeNull();
  });

  it("returns stuck nonce when pending > confirmed", async () => {
    mockGetTransactionCount.mockImplementation(async (args) => {
      if (args.blockTag === "latest") return 5;
      if (args.blockTag === "pending") return 7;
      return 5;
    });
    const result = await clientModule.detectStuckNonce();
    expect(result).toBe(5);
  });
});

// ── unstickWallet ──

describe("unstickWallet", () => {
  it("sends a 0-value self-transfer at the stuck nonce", async () => {
    mockGetTransactionCount.mockImplementation(async (args) => {
      if (args.blockTag === "latest") return 3;
      if (args.blockTag === "pending") return 5;
      return 3;
    });
    mockSendTransaction.mockResolvedValue("0xunstick_hash" as Hex);

    const hash = await clientModule.unstickWallet();

    expect(hash).toBe("0xunstick_hash");
    expect(mockSendTransaction).toHaveBeenCalledOnce();

    const txParams = mockSendTransaction.mock.calls[0][0];
    expect(txParams.to).toBe(TEST_ADDRESS);
    expect(txParams.value).toBe(0n);
    expect(txParams.nonce).toBe(3);
  });

  it("throws when no stuck nonce is detected", async () => {
    mockGetTransactionCount.mockResolvedValue(5);
    await expect(clientModule.unstickWallet()).rejects.toThrow("No stuck nonce detected");
  });
});

// ── writeContractWithRetry ──

describe("writeContractWithRetry", () => {
  it("succeeds on first attempt", async () => {
    mockGetTransactionCount.mockResolvedValue(10);
    mockWriteContract.mockResolvedValue("0xsuccess" as Hex);

    const hash = await clientModule.writeContractWithRetry({ test: true });
    expect(hash).toBe("0xsuccess");
    expect(mockWriteContract).toHaveBeenCalledOnce();
  });

  it("retries and bumps gas on 'replacement transaction underpriced'", async () => {
    mockGetTransactionCount.mockResolvedValue(10);
    mockWriteContract
      .mockRejectedValueOnce(new Error("replacement transaction underpriced"))
      .mockResolvedValueOnce("0xretried" as Hex);

    const hash = await clientModule.writeContractWithRetry({ test: true });

    expect(hash).toBe("0xretried");
    expect(mockWriteContract).toHaveBeenCalledTimes(2);

    // Second call should have bumped fees (110% of buffered)
    const firstCall = mockWriteContract.mock.calls[0][0] as Record<string, bigint>;
    const secondCall = mockWriteContract.mock.calls[1][0] as Record<string, bigint>;
    expect(secondCall.maxFeePerGas).toBeGreaterThan(firstCall.maxFeePerGas);
    expect(secondCall.maxPriorityFeePerGas).toBeGreaterThan(firstCall.maxPriorityFeePerGas);
  });

  it("refreshes nonce on 'nonce too low'", async () => {
    let nonceCallCount = 0;
    mockGetTransactionCount.mockImplementation(async () => {
      nonceCallCount++;
      // First 2 calls are detectStuckNonce (latest + pending = both 10, not stuck)
      // Third call is the initial nonce fetch = 10
      // Fourth call is the refreshed nonce after "nonce too low" = 11
      if (nonceCallCount <= 3) return 10;
      return 11;
    });

    mockWriteContract
      .mockRejectedValueOnce(new Error("nonce too low"))
      .mockResolvedValueOnce("0xfresh_nonce" as Hex);

    const hash = await clientModule.writeContractWithRetry({ test: true });

    expect(hash).toBe("0xfresh_nonce");
    const secondCall = mockWriteContract.mock.calls[1][0] as Record<string, number>;
    expect(secondCall.nonce).toBe(11);
  });

  it("auto-unsticks wallet before sending", async () => {
    let callCount = 0;
    mockGetTransactionCount.mockImplementation(async (args) => {
      callCount++;
      // detectStuckNonce in withRetry: latest=5, pending=7 (stuck!)
      // detectStuckNonce in unstickWallet: latest=5, pending=7 (still stuck)
      // After unstick receipt, nonce fetch for the actual tx
      if (callCount <= 4) {
        // Promise.all calls are interleaved — use blockTag to distinguish
        return args.blockTag === "latest" ? 5 : 7;
      }
      // Post-unstick nonce fetch
      return 6;
    });

    mockSendTransaction.mockResolvedValue("0xunstick" as Hex);
    mockWriteContract.mockResolvedValue("0xactual_tx" as Hex);

    const hash = await clientModule.writeContractWithRetry({ test: true });

    expect(hash).toBe("0xactual_tx");
    expect(mockSendTransaction).toHaveBeenCalledOnce(); // unstick self-transfer
  });

  it("throws after exhausting retries", async () => {
    mockGetTransactionCount.mockResolvedValue(10);
    mockWriteContract.mockRejectedValue(new Error("replacement transaction underpriced"));

    await expect(clientModule.writeContractWithRetry({ test: true }))
      .rejects.toThrow("replacement transaction underpriced");

    // MAX_RETRIES = 3, so 4 total attempts (0,1,2,3)
    expect(mockWriteContract).toHaveBeenCalledTimes(4);
  });

  it("does not retry on non-retryable errors", async () => {
    mockGetTransactionCount.mockResolvedValue(10);
    mockWriteContract.mockRejectedValue(new Error("execution reverted: UNAUTHORIZED"));

    await expect(clientModule.writeContractWithRetry({ test: true }))
      .rejects.toThrow("execution reverted: UNAUTHORIZED");

    expect(mockWriteContract).toHaveBeenCalledOnce();
  });
});

// ── sendTxWithRetry ──

describe("sendTxWithRetry", () => {
  it("succeeds on first attempt", async () => {
    mockGetTransactionCount.mockResolvedValue(10);
    mockSendTransaction.mockResolvedValue("0xtx_hash" as Hex);

    const hash = await clientModule.sendTxWithRetry({ test: true });
    expect(hash).toBe("0xtx_hash");
  });

  it("retries on NONCE_EXPIRED", async () => {
    mockGetTransactionCount.mockResolvedValue(10);
    mockSendTransaction
      .mockRejectedValueOnce(new Error("NONCE_EXPIRED"))
      .mockResolvedValueOnce("0xretried" as Hex);

    const hash = await clientModule.sendTxWithRetry({ test: true });

    expect(hash).toBe("0xretried");
    expect(mockSendTransaction).toHaveBeenCalledTimes(2);
  });
});

// ── estimateFeesWithBuffer ──

describe("estimateFeesWithBuffer", () => {
  it("applies 20% buffer to gas fees", async () => {
    const fees = await clientModule.estimateFeesWithBuffer();
    expect(fees.maxFeePerGas).toBe(1200000000n);
    expect(fees.maxPriorityFeePerGas).toBe(120000000n);
  });
});

// ── waitForReceipt ──

describe("waitForReceipt", () => {
  it("returns receipt on success", async () => {
    const receipt = await clientModule.waitForReceipt("0xabc" as Hex);
    expect(receipt.status).toBe("success");
  });

  it("detects stuck nonce on timeout and attempts unstick", async () => {
    mockWaitForTransactionReceipt.mockRejectedValue(new Error("Timed out while waiting"));
    mockGetTransactionCount.mockImplementation(async (args) => {
      if (args.blockTag === "latest") return 5;
      if (args.blockTag === "pending") return 7;
      return 5;
    });
    mockSendTransaction.mockResolvedValue("0xunstick" as Hex);

    // Still throws (the original tx is lost), but unstick was attempted
    await expect(clientModule.waitForReceipt("0xstuck" as Hex)).rejects.toThrow("Timed out");
    expect(mockSendTransaction).toHaveBeenCalledOnce(); // unstick attempt
  });
});
