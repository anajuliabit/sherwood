"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import type { Address } from "viem";
import DepositModal from "./DepositModal";

interface DepositButtonProps {
  vault: Address;
  vaultName: string;
  openDeposits: boolean;
  paused: boolean;
  assetAddress: Address;
  assetDecimals: number;
  assetSymbol: string;
}

export default function DepositButton({
  vault,
  vaultName,
  openDeposits,
  paused,
  assetAddress,
  assetDecimals,
  assetSymbol,
}: DepositButtonProps) {
  const { isConnected } = useAccount();
  const [showDeposit, setShowDeposit] = useState(false);

  // When not connected, don't render a duplicate Connect button —
  // the header WalletButton already handles wallet connection.
  if (!isConnected) {
    return null;
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
          assetAddress={assetAddress}
          assetDecimals={assetDecimals}
          assetSymbol={assetSymbol}
          onClose={() => setShowDeposit(false)}
        />
      )}
    </>
  );
}
