// src/components/ClaimRewardsModal.tsx
// Last Updated: 2025-06-14 21:53:29 UTC by jake1318

import React, { useState } from "react";
import { useWallet } from "@suiet/wallet-kit";
import { claimAllRewards } from "../scallop/rewardService";
import type { ClaimResult } from "../scallop/rewardService";
import "../styles/ClaimRewardsModal.scss";

// Minimum claimable amount in USD value to prevent dust-level claims
const MIN_CLAIM_USD = 0.001;

interface RewardInfo {
  symbol: string;
  amount: number;
  valueUSD: number;
}

interface Props {
  /** List of pending rewards from your lending page state */
  pendingRewards: RewardInfo[];
  /** Called when the modal should be closed */
  onClose: () => void;
  /** Called after a successful or failed claim */
  onClaimed: (result: ClaimResult) => void;
}

export default function ClaimRewardsModal({
  pendingRewards,
  onClose,
  onClaimed,
}: Props) {
  const wallet = useWallet();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // total USD across all pending rewards
  const totalUsd = pendingRewards.reduce((sum, r) => sum + r.valueUSD, 0);
  const belowThreshold = totalUsd < MIN_CLAIM_USD;

  const handleClaim = async () => {
    setLoading(true);
    setError(null);
    console.log("Initiating claim rewards transaction");
    try {
      const result = await claimAllRewards(wallet);
      console.log("Claim result:", result);

      if (result.success) {
        onClaimed(result);
        onClose();
      } else {
        setError(result.error || "Transaction failed");
        onClaimed(result);
      }
    } catch (err) {
      console.error("Error claiming rewards:", err);
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(errorMsg);
      onClaimed({ success: false, error: errorMsg });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rewards-modal-overlay">
      <div className="rewards-modal">
        <div className="rewards-modal-header">
          <h2>Claim Rewards</h2>
        </div>

        {pendingRewards.length > 0 ? (
          <div className="rewards-list">
            {pendingRewards.map((r) => (
              <div key={r.symbol} className="reward-item">
                <span className="reward-amount">
                  {r.amount.toFixed(6)} {r.symbol}
                </span>
                <span className="reward-value">
                  (~${r.valueUSD.toFixed(4)})
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="no-rewards">No pending rewards to claim</div>
        )}

        {error && <div className="error-message">{error}</div>}

        <div className="rewards-modal-actions">
          <button
            className="claim-all-btn"
            onClick={handleClaim}
            disabled={loading || pendingRewards.length === 0 || belowThreshold}
          >
            {loading ? (
              <>
                <span className="spinner"></span>
                Claiming...
              </>
            ) : (
              "Claim All"
            )}
          </button>
          {belowThreshold && pendingRewards.length > 0 && (
            <div className="warning-message">
              You need at least ${MIN_CLAIM_USD.toFixed(3)} in rewards to claim.
            </div>
          )}
          <button className="cancel-btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
