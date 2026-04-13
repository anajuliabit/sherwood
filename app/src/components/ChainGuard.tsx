"use client";

/**
 * ChainGuard — sticky banner shown when the connected wallet is on a chain
 * that isn't one of Sherwood's supported chains. Offers a one-click switch
 * to the first configured chain. Invisible when disconnected or already on
 * a supported chain.
 */

import { useEffect } from "react";
import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { CHAINS } from "@/lib/contracts";
import { useToast } from "@/components/ui/Toast";
import { trackChainSwitchRequired } from "@/lib/analytics";

export default function ChainGuard() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending } = useSwitchChain();
  const toast = useToast();

  const supported = Object.keys(CHAINS).map((n) => Number(n));
  const isWrongChain = isConnected && !supported.includes(chainId);

  const firstChain = Object.values(CHAINS)[0];
  const targetId = firstChain?.chain.id;
  const targetName = firstChain?.chain.name ?? "Base";

  // Telemetry: record exposure to the wrong-chain banner
  useEffect(() => {
    if (isWrongChain && targetId) {
      trackChainSwitchRequired(chainId, targetId);
    }
  }, [isWrongChain, chainId, targetId]);

  if (!isWrongChain) return null;

  return (
    <div className="chain-banner" role="alert">
      <div className="chain-banner__text">
        <span className="chain-banner__dot" aria-hidden="true" />
        <span>
          Wrong network detected. Sherwood is deployed on <strong>{targetName}</strong>.
        </span>
      </div>
      <button
        type="button"
        className="chain-banner__switch"
        disabled={isPending || !targetId}
        onClick={() => {
          if (!targetId) return;
          switchChain(
            { chainId: targetId },
            {
              onError: (err) =>
                toast.error("Network switch failed", err.message || "Please switch manually in your wallet."),
            },
          );
        }}
      >
        {isPending ? "Switching…" : `Switch to ${targetName}`}
      </button>
    </div>
  );
}
