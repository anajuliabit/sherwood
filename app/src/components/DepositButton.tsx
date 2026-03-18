"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import dynamic from "next/dynamic";
import type { Address } from "viem";
import DepositModal from "./DepositModal";

const Wallet = dynamic(() => import("@coinbase/onchainkit/wallet").then((m) => ({ default: m.Wallet })), { ssr: false });
const ConnectWallet = dynamic(() => import("@coinbase/onchainkit/wallet").then((m) => ({ default: m.ConnectWallet })), { ssr: false });

interface DepositButtonProps {
  vault: Address;
  vaultName: string;
  openDeposits: boolean;
  paused: boolean;
}

export default function DepositButton({ vault, vaultName, openDeposits, paused }: DepositButtonProps) {
  const { isConnected } = useAccount();
  const [showDeposit, setShowDeposit] = useState(false);

  if (!isConnected) {
    // Render the connect wallet trigger styled as deposit button
    return (
      <Wallet>
        <ConnectWallet className="btn-action">
          <span>[ DEPOSIT ]</span>
        </ConnectWallet>
      </Wallet>
    );
  }

  return (
    <>
      <button className="btn-action" onClick={() => setShowDeposit(true)}>
        [ DEPOSIT ]
      </button>
      {showDeposit && (
        <DepositModal
          vault={vault}
          vaultName={vaultName}
          openDeposits={openDeposits}
          paused={paused}
          onClose={() => setShowDeposit(false)}
        />
      )}
    </>
  );
}
