// src/services/rewardService.ts
// Last Updated: 2025-06-14 19:46:58 UTC by jake1318

import scallopService from "../scallop/ScallopService";
import type { WalletAdapter } from "@suiet/wallet-kit";

export interface ClaimResult {
  success: boolean;
  digest?: string;
  txLink?: string;
  error?: string;
  timestamp?: string;
}

/**
 * Claim all outstanding supply + borrow rewards (SCA, SCA incentives).
 */
export async function claimAllRewards(
  wallet: WalletAdapter
): Promise<ClaimResult> {
  console.log("Calling claimRewards from scallopService");
  return await scallopService.claimRewards(wallet);
}
