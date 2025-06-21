// src/scallop/ScallopIncentiveService.ts
// Last updated: 2025-06-21 01:31:22 UTC by jake1318Why

import { extractWalletAddress, SUIVISION_URL } from "./ScallopService";
import { scallop } from "./ScallopService"; // Import from local service file
import * as scallopBorrowService from "./ScallopBorrowService";
// Updated import using the correct path structure from @mysten/sui
import type { SignerWithProvider } from "@mysten/sui/signers";

/**
 * Ensures the Scallop client is initialized and sets the signer to the connected wallet
 * @param wallet Connected wallet from Suiet wallet-kit
 */
async function ensureClient(wallet?: any) {
  if (!scallop.client) {
    console.log("[ensureClient] Initializing Scallop client...");
    await scallop.init();
  }

  // Keep signer in sync with Suiet
  if (wallet?.adapter) {
    console.log("[ensureClient] Setting Scallop signer to wallet adapter");
    // FIXED: Use suiKit.useSigner instead of non-existent setSigner method
    scallop.suiKit.useSigner(wallet.adapter as SignerWithProvider);
  }
}

/**
 * Unlock an obligation
 * @param wallet Connected wallet
 * @param obligationId ID of the obligation to unlock
 * @returns Transaction result
 */
export async function unlockObligation(
  wallet: any,
  obligationId: string,
  lockType: "boost" | "borrow-incentive" | null = null
) {
  try {
    console.log(`[unlockObligation] Starting for obligation ${obligationId}`);

    // Get wallet address
    const sender = await extractWalletAddress(wallet);
    if (!sender) throw new Error("Wallet not connected");

    // Verify the obligation exists for this user
    const userObligations = await scallopBorrowService.getUserObligations(
      sender
    );
    const matchingObligation = userObligations.find(
      (ob) => ob.obligationId === obligationId
    );

    if (!matchingObligation) {
      console.error(
        `[unlockObligation] Obligation ${obligationId} not found in user obligations`
      );
      throw new Error(
        "Obligation not found for this wallet address - cannot unlock"
      );
    }

    await ensureClient(wallet); // Pass the wallet to set the signer

    // Use the client API directly for unlocking
    const transactionBlock = await scallop.client.unstakeObligation({
      obligationId,
    });

    // Execute transaction through wallet
    console.log("[unlockObligation] Sending transaction...");
    const result = await wallet.signAndExecuteTransactionBlock({
      transactionBlock,
      options: {
        showEffects: true,
        showObjectChanges: true,
      },
    });

    console.log("[unlockObligation] Transaction submitted:", result);

    // Return success response
    return {
      success: true,
      digest: result.digest,
      txLink: `${SUIVISION_URL}${result.digest}`,
    };
  } catch (err) {
    console.error("[unlockObligation] Failed:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Repay an unlocked obligation using client.repay
 * @param wallet Connected wallet
 * @param obligationId ID of the obligation
 * @param asset Asset symbol (usdc, sui, usdt) - use raw type, not wrapped
 * @param amount Amount to repay in base units (bigint)
 * @returns Transaction result
 */
export async function repayUnlockedObligation(
  wallet: any,
  obligationId: string,
  asset: "usdc" | "sui" | "usdt",
  amount: bigint
) {
  try {
    console.log(
      `[repayUnlockedObligation] Starting for obligation ${obligationId}`
    );
    console.log(`[repayUnlockedObligation] Repaying ${amount} ${asset}`);

    // Get wallet address
    const sender = await extractWalletAddress(wallet);
    if (!sender) throw new Error("Wallet not connected");

    // Verify the obligation exists for this user
    const userObligations = await scallopBorrowService.getUserObligations(
      sender
    );
    const matchingObligation = userObligations.find(
      (ob) => ob.obligationId === obligationId
    );

    if (!matchingObligation) {
      console.error(
        `[repayUnlockedObligation] Obligation ${obligationId} not found in user obligations`
      );
      throw new Error(
        "Obligation not found for this wallet address - cannot repay"
      );
    }

    console.log(
      `[repayUnlockedObligation] Verified obligation exists for sender: ${sender.slice(
        0,
        8
      )}...`
    );

    await ensureClient(wallet); // Pass the wallet to set the signer

    // Use client.repay which now has the correct signer
    const txBlock = await scallop.client.repay(
      asset,
      amount,
      true, // amount is in base units
      obligationId // mandatory when the user has >1 obligation
    );

    // Execute transaction through wallet
    console.log("[repayUnlockedObligation] Sending transaction...");
    const result = await wallet.signAndExecuteTransactionBlock({
      transactionBlock: txBlock,
      options: {
        showEffects: true,
        showObjectChanges: true,
      },
    });

    console.log("[repayUnlockedObligation] Transaction submitted:", result);

    // Return success response
    return {
      success: true,
      digest: result.digest,
      txLink: `${SUIVISION_URL}${result.digest}`,
    };
  } catch (err) {
    console.error("[repayUnlockedObligation] Failed:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Repay maximum debt for an unlocked obligation - uses exact amount calculation
 * @param wallet Connected wallet
 * @param obligationId ID of the obligation
 * @param asset Asset symbol (usdc, sui, usdt) - use raw type, not wrapped
 * @param currentDebt Current debt amount in human-readable form
 * @param decimals The number of decimals for the asset
 * @returns Transaction result
 */
export async function repayMaximumDebt(
  wallet: any,
  obligationId: string,
  asset: "usdc" | "sui" | "usdt",
  currentDebt: number,
  decimals: number
) {
  try {
    console.log(`[repayMaximumDebt] Starting for obligation ${obligationId}`);
    console.log(
      `[repayMaximumDebt] Repaying maximum debt: ${currentDebt} ${asset}`
    );

    // Calculate exact base units for the current debt
    // Add a small buffer (1%) to account for accrued interest
    const baseUnits = BigInt(
      Math.ceil(currentDebt * 1.01 * Math.pow(10, decimals))
    );

    console.log(
      `[repayMaximumDebt] Calculated base units with buffer: ${baseUnits}`
    );

    // Call standard repay with the exact amount
    return await repayUnlockedObligation(
      wallet,
      obligationId,
      asset,
      baseUnits
    );
  } catch (err) {
    console.error("[repayMaximumDebt] Failed:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Unlock an obligation and repay debt in a single atomic transaction
 * @param wallet Connected wallet
 * @param obligationId ID of the obligation
 * @param asset Asset symbol (usdc, sui, usdt) - use raw type, not wrapped
 * @param amount Amount to repay in base units (bigint)
 * @param repayMaximum Whether to repay the full debt
 * @returns Transaction result
 */
export async function unlockAndRepay(
  wallet: any,
  obligationId: string,
  asset: "usdc" | "sui" | "usdt",
  amount: bigint,
  repayMaximum: boolean = false
) {
  try {
    console.log(`[unlockAndRepay] Starting for obligation ${obligationId}`);

    // Get wallet address
    const sender = await extractWalletAddress(wallet);
    if (!sender) throw new Error("Wallet not connected");

    // Verify the obligation exists for this user
    const userObligations = await scallopBorrowService.getUserObligations(
      sender
    );
    const matchingObligation = userObligations.find(
      (ob) => ob.obligationId === obligationId
    );

    if (!matchingObligation) {
      console.error(
        `[unlockAndRepay] Obligation ${obligationId} not found in user obligations`
      );
      throw new Error(
        "Obligation not found for this wallet address - cannot unlock and repay"
      );
    }

    console.log(
      `[unlockAndRepay] Verified obligation exists for sender: ${sender.slice(
        0,
        8
      )}...`
    );

    await ensureClient(wallet); // Pass the wallet to set the signer

    // Execute unlock first
    console.log("[unlockAndRepay] Unlocking obligation...");
    const unlockResult = await unlockObligation(wallet, obligationId);

    if (!unlockResult.success) {
      return unlockResult; // Return the error if unlock fails
    }

    // After successful unlock, repay the debt
    console.log(
      "[unlockAndRepay] Obligation unlocked successfully, proceeding with repayment..."
    );

    // If repaying maximum, use MAX_SAFE_INTEGER with repayMaximumDebt, otherwise use the standard repay
    let repayResult;
    if (repayMaximum) {
      // For maximum repayment, we need the current debt amount and decimals
      // Get the obligation details to determine the current debt
      const { success, obligation } =
        await scallopBorrowService.getObligationDetails(obligationId, sender);

      if (!success || !obligation) {
        console.error(
          "[unlockAndRepay] Failed to get obligation details after unlock"
        );
        return {
          success: false,
          error: "Failed to get obligation details after unlock",
        };
      }

      // Find the borrowed asset and get its debt amount and decimals
      const borrowedAsset = obligation.borrows.find(
        (b) => b.symbol.toLowerCase() === asset.toUpperCase()
      );

      if (!borrowedAsset) {
        console.error(
          `[unlockAndRepay] No debt found for ${asset} after unlock`
        );
        return {
          success: false,
          error: `No debt found for ${asset} after unlock`,
        };
      }

      const decimals = asset === "sui" ? 9 : 6; // SUI has 9 decimals, USDC/USDT have 6

      // Use repayMaximumDebt to calculate the correct amount with buffer
      repayResult = await repayMaximumDebt(
        wallet,
        obligationId,
        asset,
        borrowedAsset.amount,
        decimals
      );
    } else {
      // For specific amount repayment
      repayResult = await repayUnlockedObligation(
        wallet,
        obligationId,
        asset,
        amount
      );
    }

    // Return the result of the repayment
    return repayResult;
  } catch (err) {
    console.error("[unlockAndRepay] failed:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Check if an obligation is locked and needs to be unlocked before repaying
 * @param obligationId Obligation ID to check
 * @param address User wallet address
 * @returns True if obligation is locked and needs unstaking
 */
export async function isObligationLocked(
  obligationId: string,
  address: string
): Promise<boolean> {
  try {
    // Get obligation details
    const { success, obligation } =
      await scallopBorrowService.getObligationDetails(obligationId, address);

    if (!success || !obligation) {
      console.error("[isObligationLocked] Failed to get obligation details");
      return false; // Default to false if we can't determine
    }

    return obligation.isLocked === true;
  } catch (err) {
    console.error("[isObligationLocked] Error checking lock status:", err);
    return false; // Default to false on error
  }
}

/**
 * Utility function to verify if an obligation ID belongs to a user
 * @param obligationId The obligation ID to check
 * @param address User's wallet address
 * @returns True if the obligation belongs to the user
 */
export async function verifyObligationOwnership(
  obligationId: string,
  address: string
): Promise<boolean> {
  try {
    // Use the existing ScallopBorrowService function instead of calling scallop.client directly
    const userObligations = await scallopBorrowService.getUserObligations(
      address
    );
    const matchingObligation = userObligations.find(
      (ob) => ob.obligationId === obligationId
    );

    return !!matchingObligation;
  } catch (err) {
    console.error("[verifyObligationOwnership] Error:", err);
    return false;
  }
}

// For backward compatibility - clients can still use the old function name
export const repayObligation = repayUnlockedObligation; // OK again
export const unlockAndRepayObligation = unlockAndRepay;
