// ScallopCollateralService.ts
// Last Updated: 2025-06-11 07:17:14 UTC by jake1318

import { Scallop } from "@scallop-io/sui-scallop-sdk";
import { SuiClient } from "@mysten/sui.js/client";
import { TransactionBlock } from "@mysten/sui.js/transactions";

// Import common utilities from ScallopService
import {
  extractWalletAddress,
  getCoinSymbol,
  getSymbolFromCoinType,
  normalizeCoinType,
  parseMoveCallError,
  SUI_MAINNET,
  SCALLOP_ADDRESS_ID,
  SCALLOP_VERSION_OBJECT,
  SUIVISION_URL,
} from "./ScallopService";

// Initialize the Scallop client for collateral operations
const client = new SuiClient({ url: SUI_MAINNET });
const scallop = new Scallop({
  addressId: SCALLOP_ADDRESS_ID,
  networkType: "mainnet",
  suiProvider: client,
});

// Define the proper SUI coin type constant
export const SUI_COIN_TYPE =
  "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI";

// Cache for obligation IDs
const obligationIdCache: Record<string, { id: string; timestamp: number }> = {};

// Cache for obligation keys
const obligationKeyCache: Record<string, { key: string; timestamp: number }> =
  {};

/**
 * Add an obligation ID to the cache
 * @param address User address
 * @param id Obligation ID
 */
export function cacheObligationId(address: string, id: string) {
  obligationIdCache[address] = {
    id,
    timestamp: Date.now(),
  };
  console.log(`[Collateral] Cached obligation ID for ${address}: ${id}`);
}

/**
 * Clear an obligation ID from the cache
 * @param address User address
 */
export function clearObligationIdCache(address: string) {
  delete obligationIdCache[address];
  console.log(`[Collateral] Cleared obligation ID cache for ${address}`);
}

/**
 * Get an obligation ID from the cache or fetch it from the network
 * @param address User address
 * @returns Obligation ID or null
 */
export async function getObligationId(address: string): Promise<string | null> {
  // Check cache first (valid for 5 minutes)
  if (
    obligationIdCache[address] &&
    Date.now() - obligationIdCache[address].timestamp < 300000
  ) {
    console.log(
      `[Collateral] Using cached obligation ID for ${address}: ${obligationIdCache[address].id}`
    );
    return obligationIdCache[address].id;
  }

  try {
    console.log(`[Collateral] Fetching obligation ID for ${address}`);
    const query = await scallop.createScallopQuery();
    await query.init();

    // Get user portfolio to find obligation ID
    const portfolio = await query.getUserPortfolio({
      walletAddress: address,
    });

    if (portfolio?.borrowings && portfolio.borrowings.length > 0) {
      for (const borrowing of portfolio.borrowings) {
        if (borrowing.obligationId) {
          // Cache the ID
          cacheObligationId(address, borrowing.obligationId);
          return borrowing.obligationId;
        }
      }
    }

    return null;
  } catch (err) {
    console.error(
      `[Collateral] Error getting obligation ID for ${address}:`,
      err
    );
    return null;
  }
}

/**
 * Get the obligation key for a specific obligation ID
 * @param address User address
 * @param obligationId The ID of the obligation
 * @returns Obligation key or null if not found or boost-locked
 */
export async function getObligationKey(
  address: string,
  obligationId: string
): Promise<string | null> {
  // Check cache first (valid for 5 minutes)
  const cacheKey = `${address}:${obligationId}`;
  if (
    obligationKeyCache[cacheKey] &&
    Date.now() - obligationKeyCache[cacheKey].timestamp < 300000
  ) {
    console.log(
      `[Collateral] Using cached obligation key for ${obligationId}: ${obligationKeyCache[cacheKey].key}`
    );
    return obligationKeyCache[cacheKey].key;
  }

  try {
    console.log(`[Collateral] Fetching obligation key for ${obligationId}`);
    const query = await scallop.createScallopQuery();
    await query.init();

    // Query the specific obligation to get its key
    const obligation = await query.queryObligation(obligationId);

    // Check if the obligation has a key
    if (obligation?.keyId) {
      // Cache the key
      obligationKeyCache[cacheKey] = {
        key: obligation.keyId,
        timestamp: Date.now(),
      };
      console.log(`[Collateral] Found obligation key: ${obligation.keyId}`);
      return obligation.keyId;
    }

    console.log(
      `[Collateral] No obligation key found for ${obligationId} - likely boost-locked`
    );
    return null; // Obligation is boost-locked
  } catch (err) {
    console.error(
      `[Collateral] Error getting obligation key for ${obligationId}:`,
      err
    );
    return null;
  }
}

/**
 * Creates an obligation account for the user, which is required for borrowing
 */
export async function createObligationAccount(signer: any) {
  try {
    // Get the sender's address
    const senderAddress = await extractWalletAddress(signer);

    if (!senderAddress) {
      throw new Error("Could not determine sender address from wallet");
    }

    console.log("[Collateral] Creating obligation account for:", senderAddress);

    // Create a ScallopBuilder instance to handle the transaction properly
    const scallopBuilder = await scallop.createScallopBuilder();
    const txb = scallopBuilder.createTxBlock();

    // Set the sender
    txb.setSender(senderAddress);

    // Create the obligation account using the SDK helper
    txb.openObligationEntry();

    // Set gas budget
    const txBlockToSign = txb.txBlock;
    txBlockToSign.setGasBudget(30000000); // 0.03 SUI

    // Sign and send the transaction
    console.log("[Collateral] Executing create obligation transaction...");
    const result = await signer.signAndExecuteTransactionBlock({
      transactionBlock: txBlockToSign,
      options: { showEffects: true, showEvents: true },
    });

    console.log("[Collateral] Create obligation result:", result);

    // Get transaction details for the response
    const digest = result.digest;
    const txLink = `${SUIVISION_URL}${digest}`;

    // Clear any cached obligation ID
    clearObligationIdCache(senderAddress);

    return {
      success: !!digest,
      digest: digest,
      txLink: txLink,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(
      "[Collateral] Error creating obligation account:",
      errorMessage,
      err
    );
    return { success: false, digest: undefined, error: errorMessage };
  }
}

/**
 * Add collateral to the user's obligation account
 * @param wallet Connected wallet
 * @param coinType Coin type to use as collateral
 * @param amount Amount to add as collateral
 * @param decimals Decimals of the coin
 * @returns Transaction result
 */
export async function addCollateral(
  wallet: any,
  coinType: string,
  amount: number,
  decimals: number
) {
  try {
    // Get the sender's address
    const senderAddress = await extractWalletAddress(wallet);

    if (!senderAddress) {
      throw new Error("Could not determine sender address from wallet");
    }

    console.log("[Collateral] Adding collateral:", {
      coinType,
      amount,
      senderAddress,
    });

    // Calculate amount in base units
    const amountInBaseUnits = Math.floor(amount * Math.pow(10, decimals));

    // Clean up the coin type to ensure it's a proper Move type string
    // Use the full path for SUI
    const fullCoinType =
      coinType === "SUI" || coinType === "sui"
        ? SUI_COIN_TYPE
        : normalizeCoinType(coinType);

    console.log(
      `[Collateral] Using coin type: ${fullCoinType} for addCollateral operation`
    );

    // Let ScallopBuilder handle the complex transaction setup
    const scallopBuilder = await scallop.createScallopBuilder();
    const txb = scallopBuilder.createTxBlock();
    txb.setSender(senderAddress);

    // Extract coin symbol for SDK helpers
    const coinSymbol = getCoinSymbol(coinType);

    // Let the SDK handle obligation creation/reuse automatically
    await txb.addCollateralQuick(amountInBaseUnits, coinSymbol);

    // Set gas budget
    const txBlockToSign = txb.txBlock;
    txBlockToSign.setGasBudget(50000000); // Higher gas budget for complex operations

    // Sign and execute transaction
    console.log("[Collateral] Executing add collateral transaction...");
    const result = await wallet.signAndExecuteTransactionBlock({
      transactionBlock: txBlockToSign,
      options: {
        showEffects: true,
        showEvents: true,
      },
    });

    console.log("[Collateral] Add collateral result:", result);

    // Get transaction details for the response
    const digest = result.digest;
    const txLink = `${SUIVISION_URL}${digest}`;

    return {
      success: !!digest,
      digest,
      txLink,
      amount,
      symbol: getSymbolFromCoinType(coinType), // Use the original symbol for display
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    console.error("[Collateral] Error adding collateral:", err);
    const errorMessage = parseMoveCallError(err) || "Failed to add collateral";
    return { success: false, error: errorMessage };
  }
}

/**
 * Withdraw collateral from the user's obligation
 * @param wallet Connected wallet
 * @param coinType Coin type to withdraw
 * @param amount Amount to withdraw
 * @param decimals Decimals of the coin
 * @returns Transaction result
 */
export async function withdrawCollateral(
  wallet: any,
  coinType: string,
  amount: number,
  decimals: number
) {
  try {
    // Get the sender's address
    const senderAddress = await extractWalletAddress(wallet);

    if (!senderAddress) {
      throw new Error("Could not determine sender address from wallet");
    }

    console.log(
      `[Collateral] Withdrawing collateral: ${amount} ${getCoinSymbol(
        coinType
      )} for ${senderAddress}`
    );

    // Calculate amount in base units
    const amountInBaseUnits = Math.floor(amount * Math.pow(10, decimals));

    // Clean up the coin type to ensure it's a proper Move type string
    // Use the full path for SUI
    const fullCoinType =
      coinType === "SUI" || coinType === "sui"
        ? SUI_COIN_TYPE
        : normalizeCoinType(coinType);

    console.log(
      `[Collateral] Using coin type: ${fullCoinType} for withdraw collateral operation`
    );

    // Use the SDK builder for withdrawal as well
    const scallopBuilder = await scallop.createScallopBuilder();
    const txb = scallopBuilder.createTxBlock();
    txb.setSender(senderAddress);

    // Extract coin symbol for SDK helpers
    const coinSymbol = getCoinSymbol(coinType);

    // First update asset prices (required by protocol)
    await txb.updateAssetPricesQuick([coinSymbol]);

    // Then take collateral using the SDK helper
    const withdrawnCoin = await txb.takeCollateralQuick(
      amountInBaseUnits,
      coinSymbol
    );

    // Transfer the withdrawn coin back to sender
    txb.transferObjects([withdrawnCoin], senderAddress);

    // Set gas budget
    const txBlockToSign = txb.txBlock;
    txBlockToSign.setGasBudget(50000000);

    // Sign and execute
    const result = await wallet.signAndExecuteTransactionBlock({
      transactionBlock: txBlockToSign,
      options: {
        showEffects: true,
        showEvents: true,
      },
    });

    console.log("[Collateral] Withdraw collateral result:", result);

    return {
      success: !!result.digest,
      digest: result.digest,
      txLink: `${SUIVISION_URL}${result.digest}`,
      amount,
      symbol: getSymbolFromCoinType(coinType),
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    console.error("[Collateral] Error withdrawing collateral:", err);

    // Parse error for better user feedback
    const errorMessage = parseMoveCallError(err);
    const error = errorMessage || "Failed to withdraw collateral";

    // Check for specific error code
    const isLiquidationError =
      String(err).includes("1795") ||
      String(err).includes("withdraw_collateral");

    return {
      success: false,
      error,
      errorCode: isLiquidationError ? "1795" : undefined,
    };
  }
}

// Export the collateral service functions
const scallopCollateralService = {
  createObligationAccount,
  addCollateral,
  withdrawCollateral,
  getObligationId,
  getObligationKey,
  cacheObligationId,
  clearObligationIdCache,
};

export default scallopCollateralService;
