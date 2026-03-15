/**
 * StrategyRegistry contract wrapper.
 *
 * Permissionless registration — anyone can register a strategy.
 * Creator address is public (for future carry fees).
 */

import type { Address, Hex } from "viem";
import { getChain, getNetwork } from "./network.js";
import { getPublicClient, getWalletClient, getAccount } from "./client.js";
import { STRATEGY_REGISTRY_ABI } from "./abis.js";
import { getChainContracts } from "./config.js";

export interface StrategyRecord {
  id: bigint;
  implementation: Address;
  creator: Address;
  strategyTypeId: bigint;
  active: boolean;
  name: string;
  metadataURI: string;
}

function getRegistryAddress(): Address {
  // 1. Config (~/.sherwood/config.json)
  const chainId = getChain().id;
  const fromConfig = getChainContracts(chainId).registry;
  if (fromConfig) return fromConfig as Address;

  // 2. Env var fallback
  const envKey = getNetwork() === "base-sepolia" ? "REGISTRY_ADDRESS_TESTNET" : "REGISTRY_ADDRESS";
  const addr = process.env[envKey];
  if (addr) return addr as Address;

  throw new Error(
    `Registry address not found. Run 'sherwood config set --registry <addr>' or set ${envKey}.`,
  );
}

/**
 * Register a new strategy on-chain.
 */
export async function registerStrategy(
  implementation: Address,
  strategyTypeId: bigint,
  name: string,
  metadataURI: string,
): Promise<Hex> {
  const wallet = getWalletClient();
  return wallet.writeContract({
    account: getAccount(),
    chain: getChain(),
    address: getRegistryAddress(),
    abi: STRATEGY_REGISTRY_ABI,
    functionName: "registerStrategy",
    args: [implementation, strategyTypeId, name, metadataURI],
  });
}

/**
 * Get a strategy by ID.
 */
export async function getStrategy(id: bigint): Promise<StrategyRecord> {
  const client = getPublicClient();
  const result = (await client.readContract({
    address: getRegistryAddress(),
    abi: STRATEGY_REGISTRY_ABI,
    functionName: "getStrategy",
    args: [id],
  })) as {
    implementation: Address;
    creator: Address;
    strategyTypeId: bigint;
    active: boolean;
    name: string;
    metadataURI: string;
  };

  return {
    id,
    implementation: result.implementation,
    creator: result.creator,
    strategyTypeId: result.strategyTypeId,
    active: result.active,
    name: result.name,
    metadataURI: result.metadataURI,
  };
}

/**
 * List all strategies, optionally filtered by type.
 */
export async function listStrategies(typeId?: bigint): Promise<StrategyRecord[]> {
  const client = getPublicClient();
  const registryAddress = getRegistryAddress();

  let ids: readonly bigint[];

  if (typeId !== undefined) {
    ids = (await client.readContract({
      address: registryAddress,
      abi: STRATEGY_REGISTRY_ABI,
      functionName: "getStrategiesByType",
      args: [typeId],
    })) as readonly bigint[];
  } else {
    const count = (await client.readContract({
      address: registryAddress,
      abi: STRATEGY_REGISTRY_ABI,
      functionName: "strategyCount",
    })) as bigint;

    ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i + 1));
  }

  const strategies: StrategyRecord[] = [];
  for (const id of ids) {
    const s = await getStrategy(id);
    strategies.push(s);
  }

  return strategies;
}

/**
 * Get total number of registered strategies.
 */
export async function strategyCount(): Promise<bigint> {
  const client = getPublicClient();
  return client.readContract({
    address: getRegistryAddress(),
    abi: STRATEGY_REGISTRY_ABI,
    functionName: "strategyCount",
  }) as Promise<bigint>;
}
