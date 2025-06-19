// src/scallop/ScallopIncentiveService.ts
// Last updated: 2025-06-19 02:19:42 UTC by jake1318

import { extractWalletAddress, SUIVISION_URL } from "./ScallopService";
import { scallop } from "@scallop-io/sui-scallop-sdk";
import * as scallopBorrowService from "./ScallopBorrowService";

/**
 * Unlock an obligation
 * @param wallet Connected wallet
 * @param obligationId ID of the obligation to unlock
 * @returns Transaction result
 */
export async function unlockObligation(wallet: any, obligationId: string) {
  try {
    console.log(`[unlockObligation] Starting for obligation ${obligationId}`);

    if (!scallop.client) {
      console.log("[unlockObligation] Initializing Scallop client...");
      await scallop.init();
    }

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
 * Repay obligation using the Client API
 * @param wallet Connected wallet
 * @param obligationId ID of the obligation
 * @param asset Asset symbol (sui, usdc, usdt)
 * @param amount Amount to repay in base units (bigint)
 * @param repayMaximum Whether to repay the full debt
 * @returns Transaction result
 */
export async function repayObligation(
  wallet: any,
  obligationId: string,
  asset: "usdc" | "sui" | "usdt",
  amount: bigint,
  repayMaximum: boolean = false
) {
  try {
    console.log(`[repayObligation] Starting for obligation ${obligationId}`);
    console.log(
      `[repayObligation] Repaying ${amount} ${asset}, repayMaximum: ${repayMaximum}`
    );

    if (!scallop.client) {
      console.log("[repayObligation] Initializing Scallop client...");
      await scallop.init();
    }

    // Use the client.repay API directly - this handles key lookup internally
    const transactionBlock = await scallop.client.repay(
      asset,
      amount,
      repayMaximum,
      obligationId
    );

    // Execute transaction through wallet
    console.log("[repayObligation] Sending transaction...");
    const result = await wallet.signAndExecuteTransactionBlock({
      transactionBlock,
      options: {
        showEffects: true,
        showObjectChanges: true,
      },
    });

    console.log("[repayObligation] Transaction submitted:", result);

    // Return success response
    return {
      success: true,
      digest: result.digest,
      txLink: `${SUIVISION_URL}${result.digest}`,
    };
  } catch (err) {
    console.error("[repayObligation] Failed:", err);
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
 * @param asset Asset symbol (sui, usdc, usdt)
 * @param amount Amount to repay in base units (bigint)
 * @param repayMaximum Whether to repay the full debt
 * @returns Transaction result
 */
export async function unlockAndRepayObligation(
  wallet: any,
  obligationId: string,
  asset: "usdc" | "sui" | "usdt",
  amount: bigint,
  repayMaximum: boolean = false
) {
  try {
    console.log(
      `[unlockAndRepayObligation] Starting for obligation ${obligationId}`
    );

    if (!scallop.client) {
      console.log("[unlockAndRepayObligation] Initializing Scallop client...");
      await scallop.init();
    }

    // Create builder for combined transaction
    const builder = await scallop.createScallopBuilder();
    const tx = builder.createTxBlock();
    const sender = await extractWalletAddress(wallet);
    if (!sender) throw new Error("Wallet not connected");
    tx.setSender(sender);

    // 1. Update oracle price (recommended before repay)
    console.log("[unlockAndRepayObligation] Adding oracle price update");
    await builder.updatePrice({ txBlock: tx, oracleId: scallop.xOracleId });

    // 2. Unlock obligation
    console.log("[unlockAndRepayObligation] Adding unlock operation");
    await builder.unlockObligation({ txBlock: tx, obligationId });

    // 3. Repay debt
    console.log("[unlockAndRepayObligation] Adding repay operation");
    await builder.repay({
      txBlock: tx,
      obligationId,
      asset,
      amount,
      repayMaximum,
    });

    // Set higher gas budget for the multi-operation transaction
    tx.setGasBudget(35_000_000);

    // Execute transaction through wallet
    console.log("[unlockAndRepayObligation] Sending transaction...");
    const result = await wallet.signAndExecuteTransactionBlock({
      transactionBlock: tx.txBlock,
      options: {
        showEffects: true,
        showObjectChanges: true,
      },
    });

    console.log("[unlockAndRepayObligation] Transaction submitted:", result);

    // Return success response
    return {
      success: true,
      digest: result.digest,
      txLink: `${SUIVISION_URL}${result.digest}`,
    };
  } catch (err) {
    console.error("[unlockAndRepayObligation] failed:", err);
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
