"use client";

import { http, createConfig } from "wagmi";
import { coinbaseWallet, walletConnect, injected } from "wagmi/connectors";
import { CHAINS, getRpcUrl } from "@/lib/contracts";
import type { Chain } from "viem";

const chains = Object.values(CHAINS).map((e) => e.chain) as [
  Chain,
  ...Chain[],
];

const transports = Object.fromEntries(
  Object.keys(CHAINS).map((id) => [Number(id), http(getRpcUrl(Number(id)))]),
);

export const wagmiConfig = createConfig({
  chains,
  connectors: [
    coinbaseWallet({
      appName: "Sherwood",
      preference: "all", // smart wallet + EOA
    }),
    walletConnect({
      projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "",
    }),
    injected(),
  ],
  transports,
});
