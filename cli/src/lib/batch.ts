/**
 * Types and helpers for BatchExecutor interaction.
 */

import type { Address, Hex } from "viem";

export interface BatchCall {
  target: Address;
  data: Hex;
  value: bigint;
}

/**
 * Encode a batch of calls for the BatchExecutor contract.
 * Returns the ABI-encoded calldata for executeBatch(Call[]).
 */
export function encodeBatchExecute(calls: BatchCall[]): Hex {
  // The BatchExecutor.executeBatch takes Call[] where Call = (address, bytes, uint256)
  // We use viem's encodeFunctionData in the caller; this helper is for the outer call
  // TODO: Wire up with actual BatchExecutor ABI for the vault.executeStrategy() call
  throw new Error("Not implemented — wire up with viem client and BatchExecutor ABI");
}

/**
 * Format a batch for human-readable display (CLI output before simulation).
 */
export function formatBatch(calls: BatchCall[]): string {
  return calls
    .map((call, i) => {
      const selector = call.data.slice(0, 10);
      return `  ${i + 1}. ${call.target} :: ${selector}... (${call.value > 0n ? call.value + " wei" : "no value"})`;
    })
    .join("\n");
}
