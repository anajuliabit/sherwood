/**
 * Integration test setup — runs before all integration tests.
 * Loads .env, sets network to base-sepolia, and validates contract addresses
 * are reachable (via env vars or ~/.sherwood/config.json).
 */

import "dotenv/config";
import { beforeAll } from "vitest";
import { setNetwork, getChain } from "../lib/network.js";
import { resetClients } from "../lib/client.js";
import { getChainContracts } from "../lib/config.js";

beforeAll(() => {
  setNetwork("base-sepolia");
  resetClients();

  // RPC URL is always required from env
  if (!process.env.BASE_SEPOLIA_RPC_URL) {
    throw new Error(
      "BASE_SEPOLIA_RPC_URL is required for integration tests. " +
      "Set it in cli/.env or as an environment variable.",
    );
  }

  // Factory + registry can come from config or env
  const chainId = getChain().id;
  const contracts = getChainContracts(chainId);
  const hasFactory = contracts.factory || process.env.FACTORY_ADDRESS_TESTNET;
  const hasRegistry = contracts.registry || process.env.REGISTRY_ADDRESS_TESTNET;

  if (!hasFactory) {
    throw new Error(
      "Factory address not found. Run 'sherwood --testnet config set --factory <addr>' " +
      "or set FACTORY_ADDRESS_TESTNET in cli/.env.",
    );
  }
  if (!hasRegistry) {
    throw new Error(
      "Registry address not found. Run 'sherwood --testnet config set --registry <addr>' " +
      "or set REGISTRY_ADDRESS_TESTNET in cli/.env.",
    );
  }
});
