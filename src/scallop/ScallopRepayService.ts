// src/scallop/ScallopRepayService.ts
// Last-Updated: 2025-06-18 03:21:13 UTC - jake1318

import { SuiClient } from "@mysten/sui.js/client";
import { extractWalletAddress, SUIVISION_URL } from "./ScallopService";
import { getObligationId, getObligationKey } from "./ScallopCollateralService";
import { init as initScallop } from "./ScallopService";

// Use first-party Sui RPC instead of BlockVision
const rpc = new SuiClient({ url: "https://fullnode.mainnet.sui.io" });

// Get the scallop instance lazily to avoid initialization issues
async function getScallop() {
  // Make sure scallop is initialized
  await initScallop();
  // Import it dynamically after initialization
  const { scallop } = await import("./ScallopService");
  return scallop;
}

/**
 * Get the user's balance for a particular coin
 * @param address Wallet address
 * @param coin Coin symbol (usdc, sui, usdt)
 * @returns Formatted balance or null if error
 */
export async function getUserCoinBalance(
  address: string,
  coin: string
): Promise<number | null> {
  const coinType = {
    sui: "0x2::sui::SUI",
    usdc: "0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN",
    usdt: "0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN",
  }[coin.toLowerCase()];

  if (!coinType) {
    console.error(`No coin type found for ${coin}`);
    return 0;
  }

  try {
    const { totalBalance } = await rpc.getBalance({
      owner: address,
      coinType: coinType,
    });

    const decimals = coin.toLowerCase() === "sui" ? 9 : 6;
    return Number(totalBalance) / 10 ** decimals;
  } catch (error) {
    console.error(`Error fetching ${coin} balance for ${address}:`, error);
    return 0;
  }
}

/**
 * Repay debt for a given coin.
 * @param wallet   Connected Suiet wallet
 * @param coin     Symbol in lower-case ("usdc", "sui", "usdt"…)
 * @param amount   Human-readable amount
 * @param decimals Decimals for the coin (6 = USDC/USDT, 9 = SUI)
 * @param obligationId Optional obligation ID to repay against (if not provided, will try to find one)
 */
export async function repay(
  wallet: any,
  coin: "usdc" | "sui" | "usdt",
  amount: number,
  decimals = 6,
  obligationId?: string
) {
  try {
    // Validate inputs first
    if (!wallet || !wallet.signTransactionBlock) {
      return {
        success: false,
        error: "Wallet not connected or does not support transaction signing",
      };
    }

    if (amount <= 0) {
      return {
        success: false,
        error: "Amount must be greater than zero",
      };
    }

    const sender = await extractWalletAddress(wallet);
    if (!sender) {
      throw new Error("Wallet not connected");
    }

    // If no obligationId provided, try to find one
    if (!obligationId) {
      // Get the user's obligation IDs
      obligationId = await getObligationIdForCoin(sender, coin);

      if (!obligationId) {
        throw new Error("No matching obligation with this debt.");
      }
    }

    // Get the obligation key - needed for boosted obligations
    const obligationKey = await getObligationKey(sender, obligationId);

    // 👉 if the obligationKey is null the obligation is in boost-lock state
    if (!obligationKey) {
      throw new Error(
        "This obligation is locked in a boost pool (error 770). " +
          "Un-boost or wait until the lock expires."
      );
    }

    console.log(
      `[Repay] using obligation: ${obligationId} for ${coin} with key ${obligationKey}`
    );

    // Convert to base units
    const baseUnits = BigInt(Math.floor(amount * 10 ** decimals));

    // Initialize scallop first
    await initScallop();

    // Get the client instance
    const scallop = await getScallop();
    const client = scallop.client;

    if (!client) {
      throw new Error("Failed to initialize Scallop client");
    }

    // Use the SDK's simplified helper
    const res = await client.repayBorrowFromObligation({
      sender,
      obligationId,
      coinType: coin,
      amount: baseUnits,
    });

    console.log("Repayment transaction result:", res);

    const digest = res.digest;
    return {
      success: true,
      digest,
      txLink: `${SUIVISION_URL}${digest}`,
      timestamp: new Date().toISOString(),
    };
  } catch (err: any) {
    console.error("[Repay] failed:", err);

    // Enhance error messaging for common cases
    let errorMessage = err.message ?? String(err);
    if (errorMessage.includes("No valid coins found")) {
      errorMessage = `Not enough ${coin.toUpperCase()} tokens found in your wallet to repay. Please ensure you have enough ${coin.toUpperCase()} tokens.`;
    } else if (errorMessage.includes("770")) {
      errorMessage =
        "This obligation is currently locked or boosted. Please try another obligation or wait for the lock to expire.";
    }

    return { success: false, error: errorMessage };
  }
}

/**
 * Find an obligation that really has <coin> borrowed
 * @param address User's wallet address
 * @param coin Coin type to check for borrowing
 * @returns Obligation ID or null if none found
 */
async function getObligationIdForCoin(
  address: string,
  coin: "usdc" | "sui" | "usdt"
): Promise<string | null> {
  try {
    const scallop = await getScallop();
    const query = await scallop.createScallopQuery();
    await query.init();
    const pf = await query.getUserPortfolio({ walletAddress: address });

    if (!pf?.borrowings?.length) return null;

    // 1️⃣ look for an obligation that has a borrow in this coin
    for (const b of pf.borrowings) {
      if (
        b.borrowedPools?.some((p: any) =>
          p.coinType?.toLowerCase().includes(coin)
        )
      ) {
        return b.obligationId;
      }
    }

    // 2️⃣ fall back to first obligation with ANY borrow
    for (const b of pf.borrowings) {
      if (b.borrowedPools?.length) return b.obligationId;
    }

    // 3️⃣ otherwise just return the first one
    return pf.borrowings[0].obligationId;
  } catch {
    return null;
  }
}

export default { repay, getUserCoinBalance };
