// ScallopBorrowService.ts
// Last Updated: 2025-06-18 03:18:32 UTC by jake1318

import {
  extractWalletAddress,
  SUIVISION_URL,
  SCALLOP_PACKAGE_ID,
} from "./ScallopService";
import { SuiClient } from "@mysten/sui.js/client";
import type { WalletAdapter } from "@suiet/wallet-kit";
import { init as initScallop } from "./ScallopService";

// Create SuiClient with proper network URL mapping
const NETWORK_URL = {
  mainnet: "https://fullnode.mainnet.sui.io",
  testnet: "https://fullnode.testnet.sui.io",
  devnet: "https://fullnode.devnet.sui.io",
};

// Initialize with default mainnet
const suiClient = new SuiClient({
  url: NETWORK_URL.mainnet,
});

// Get the scallop instance lazily
async function getScallop() {
  await initScallop();
  // Now import it dynamically after initialization
  const { scallop } = await import("./ScallopService");
  return scallop;
}

/**
 * Safe update prices helper that won't fail the transaction if price gateway fails
 * @param tx The transaction block to use
 * @param coins Array of coins to update prices for
 */
async function safeUpdatePrices(tx: any, coins: string[]) {
  try {
    await tx.updateAssetPricesQuick({ coinTypes: coins });
  } catch (e) {
    console.warn("[price-update] gateway failed, continuing", e);
  }
}

/**
 * Helper to find existing collateral the user has
 * @param address User's wallet address
 * @returns The first available collateral or null
 */
async function findUserCollateral(address: string) {
  try {
    const scallop = await getScallop();
    const query = await scallop.createScallopQuery();
    await query.init();
    const portfolio = await query.getUserPortfolio({ walletAddress: address });

    // Find the collateral with highest USD value
    return (
      portfolio.collateralAssets?.sort(
        (a: any, b: any) => b.valueUSD - a.valueUSD
      )[0] || null
    );
  } catch (err) {
    console.error("[Borrow] Error finding user collateral:", err);
    return null;
  }
}

interface GetOblsOpts {
  /** if true, return ONLY obligations that have
   * zero collateral AND zero borrows   */
  onlyUnused?: boolean;
}

/**
 * Custom interface for simplified obligation display data
 */
export interface DisplayObligation {
  obligationId: string;
  collaterals: Array<{
    symbol: string;
    amount: number;
    usd: number;
  }>;
  borrows: Array<{
    symbol: string;
    amount: number;
    usd: number;
  }>;
  totalCollateralUSD: number;
  totalBorrowUSD: number;
  lockType: "boost" | "borrow-incentive" | null;
  lockEnds: number | null;
  hasBorrowIncentiveStake: boolean;
  hasBoostStake: boolean;
  isLocked: boolean;
  isEmpty: boolean;
  riskLevel?: number; // 0-100 risk level where higher means more risk
}

/**
 * Return every obligation linked to a user's wallet with detailed data and flags
 * @param address User's wallet address
 * @param opts Options for filtering obligations
 * @returns Array of formatted obligation data with isEmpty flag
 */
export async function getUserObligations(
  address: string,
  opts: GetOblsOpts = {}
): Promise<DisplayObligation[]> {
  try {
    console.log(`[getUserObligations] Fetching obligations for ${address}`);

    // Use the SDK's proper getObligations method
    const scallop = await getScallop();
    const sdk = await scallop.createScallopQuery();
    await sdk.init();
    const obligations = await sdk.getObligations(address);

    console.log(
      `[getUserObligations] SDK returned ${obligations.length} obligations`
    );
    console.log(`[getUserObligations] Raw obligations:`, obligations);

    if (obligations.length === 0) {
      console.log(
        "[getUserObligations] No obligations found via SDK - checking if this is correct"
      );
      return [];
    }

    // Convert SDK obligations to DisplayObligation format
    const displayObligations: DisplayObligation[] = await Promise.all(
      obligations.map(async (obligation) => {
        try {
          // Get detailed obligation data for each obligation
          const obligationAccount = await sdk.getObligationAccount(
            obligation.id,
            address
          );

          if (!obligationAccount) {
            console.warn(
              `Could not get obligation account data for ${obligation.id}`
            );
            return {
              obligationId: obligation.id,
              collaterals: [],
              borrows: [],
              totalCollateralUSD: 0,
              totalBorrowUSD: 0,
              lockType: null,
              lockEnds: null,
              hasBorrowIncentiveStake: false,
              hasBoostStake: false,
              isLocked: obligation.locked || false,
              isEmpty: true,
              riskLevel: 0,
            };
          }

          console.log(
            `[getUserObligations] Obligation ${obligation.id} account data:`,
            obligationAccount
          );

          // Process collaterals - properly handle different property names
          const collaterals = Object.entries(
            obligationAccount.collaterals || {}
          )
            .filter(([_, collateral]: [string, any]) => {
              // Check for any of the possible amount fields
              const hasAmount =
                collateral.amount > 0 ||
                collateral.depositedAmount > 0 ||
                collateral.depositedCoin > 0 ||
                collateral.amountUSD > 0 ||
                collateral.depositedValue > 0;
              return collateral && hasAmount;
            })
            .map(([_, collateral]: [string, any]) => ({
              symbol: collateral.symbol || collateral.coinName,
              amount: Number(
                collateral.amount ||
                  collateral.depositedCoin ||
                  (collateral.depositedAmount
                    ? collateral.depositedAmount /
                      Math.pow(10, collateral.coinDecimal || 9)
                    : 0) ||
                  0
              ),
              usd: Number(
                collateral.amountUSD || collateral.depositedValue || 0
              ),
            }));

          // Process borrows - ONLY include assets with actual debt
          const borrows = Object.entries(obligationAccount.debts || {})
            .filter(([_, debt]: [string, any]) => {
              const hasAmount =
                debt.amount > 0 ||
                debt.borrowedAmount > 0 ||
                debt.borrowedCoin > 0 ||
                debt.amountUSD > 0 ||
                debt.borrowedValue > 0;
              return debt && hasAmount;
            })
            .map(([_, debt]: [string, any]) => ({
              symbol: debt.symbol || debt.coinName,
              amount: Number(
                debt.amount ||
                  debt.borrowedCoin ||
                  (debt.borrowedAmount
                    ? debt.borrowedAmount / Math.pow(10, debt.coinDecimal || 9)
                    : 0) ||
                  0
              ),
              usd: Number(debt.amountUSD || debt.borrowedValue || 0),
            }));

          const totalCollateralUSD =
            Number(obligationAccount.totalDepositedValue) || 0;
          const totalBorrowUSD =
            Number(obligationAccount.totalBorrowedValue) || 0;
          const isEmpty = collaterals.length === 0 && borrows.length === 0;

          // Check if there are any borrow incentives
          const borrowIncentiveKeys = Object.keys(
            obligationAccount.borrowIncentives || {}
          );
          const hasBorrowIncentiveStake = borrowIncentiveKeys.length > 0;

          // Check if we have greater than 1x multiplier on any incentives
          let hasBoostStake = false;
          if (hasBorrowIncentiveStake) {
            const incentives = Object.values(
              obligationAccount.borrowIncentives || {}
            );
            for (const incentive of incentives) {
              for (const reward of incentive.rewards || []) {
                if (reward.boostValue && reward.boostValue > 1.0) {
                  hasBoostStake = true;
                  break;
                }
              }
              if (hasBoostStake) break;
            }
          }

          // Determine lock type based on stakes
          const lockType = hasBorrowIncentiveStake
            ? "borrow-incentive"
            : hasBoostStake
            ? "boost"
            : null;

          // Is the obligation locked for modifications?
          const isLocked = hasBorrowIncentiveStake || hasBoostStake;

          const displayObligation = {
            obligationId: obligation.id,
            collaterals,
            borrows,
            totalCollateralUSD,
            totalBorrowUSD,
            lockType,
            lockEnds: null, // Lock end time not directly available in data structure
            hasBorrowIncentiveStake,
            hasBoostStake,
            isLocked,
            isEmpty,
            riskLevel: Number(obligationAccount.totalRiskLevel) || 0,
          };

          console.log(
            `[getUserObligations] Processed obligation ${obligation.id}:`,
            {
              collateralCount: collaterals.length,
              borrowCount: borrows.length,
              totalCollateralUSD,
              totalBorrowUSD,
              isEmpty: displayObligation.isEmpty,
              isLocked,
            }
          );

          return displayObligation;
        } catch (error) {
          console.error(`Error processing obligation ${obligation.id}:`, error);
          // Return basic obligation info even if detailed data fails
          return {
            obligationId: obligation.id,
            collaterals: [],
            borrows: [],
            totalCollateralUSD: 0,
            totalBorrowUSD: 0,
            lockType: null,
            lockEnds: null,
            hasBorrowIncentiveStake: false,
            hasBoostStake: false,
            isLocked: obligation.locked || false,
            isEmpty: true,
            riskLevel: 0,
          };
        }
      })
    );

    console.log(
      `[getUserObligations] Processed ${displayObligations.length} display obligations`
    );

    // Apply filtering if requested
    let result = displayObligations;
    if (opts.onlyUnused) {
      result = result.filter((o) => o.isEmpty && !o.isLocked);
    }

    console.log(
      "%c[getUserObligations] returning:",
      "color:#18baff;font-weight:bold",
      JSON.parse(JSON.stringify(result))
    );

    return result;
  } catch (error) {
    console.error("[getUserObligations] Error fetching obligations:", error);
    return [];
  }
}

/**
 * Get aggregated totals from all obligations for a wallet address
 * This allows displaying total lending/borrowing/collateral positions
 *
 * @param address User's wallet address
 * @returns Aggregated totals for all obligations
 */
export async function getWalletObligationTotals(address: string): Promise<{
  success: boolean;
  totals: {
    totalCollateralUSD: number;
    totalBorrowUSD: number;
    collateralsBySymbol: Record<
      string,
      {
        symbol: string;
        totalAmount: number;
        totalUSD: number;
      }
    >;
    borrowsBySymbol: Record<
      string,
      {
        symbol: string;
        totalAmount: number;
        totalUSD: number;
      }
    >;
    obligationCount: number;
    activeObligationCount: number; // obligations with non-zero balances
  };
  error?: string;
}> {
  try {
    console.log(
      `[getWalletObligationTotals] Calculating totals for ${address}`
    );

    // Get all obligations for the user
    const allObligations = await getUserObligations(address);

    // Initialize totals
    let totalCollateralUSD = 0;
    let totalBorrowUSD = 0;
    const collateralsBySymbol: Record<
      string,
      {
        symbol: string;
        totalAmount: number;
        totalUSD: number;
      }
    > = {};
    const borrowsBySymbol: Record<
      string,
      {
        symbol: string;
        totalAmount: number;
        totalUSD: number;
      }
    > = {};

    // Count active obligations (with non-zero balances)
    let activeObligationCount = 0;

    // Process each obligation
    for (const obligation of allObligations) {
      // Add to USD totals
      totalCollateralUSD += obligation.totalCollateralUSD;
      totalBorrowUSD += obligation.totalBorrowUSD;

      // Count as active if it has collateral or borrows
      if (obligation.collaterals.length > 0 || obligation.borrows.length > 0) {
        activeObligationCount++;
      }

      // Process collaterals
      for (const collateral of obligation.collaterals) {
        if (!collateralsBySymbol[collateral.symbol]) {
          collateralsBySymbol[collateral.symbol] = {
            symbol: collateral.symbol,
            totalAmount: 0,
            totalUSD: 0,
          };
        }
        collateralsBySymbol[collateral.symbol].totalAmount += collateral.amount;
        collateralsBySymbol[collateral.symbol].totalUSD += collateral.usd;
      }

      // Process borrows
      for (const borrow of obligation.borrows) {
        if (!borrowsBySymbol[borrow.symbol]) {
          borrowsBySymbol[borrow.symbol] = {
            symbol: borrow.symbol,
            totalAmount: 0,
            totalUSD: 0,
          };
        }
        borrowsBySymbol[borrow.symbol].totalAmount += borrow.amount;
        borrowsBySymbol[borrow.symbol].totalUSD += borrow.usd;
      }
    }

    console.log(`[getWalletObligationTotals] Results for ${address}:`, {
      totalCollateralUSD,
      totalBorrowUSD,
      activeObligationCount,
      totalObligations: allObligations.length,
      collateralAssets: Object.keys(collateralsBySymbol).length,
      borrowedAssets: Object.keys(borrowsBySymbol).length,
    });

    return {
      success: true,
      totals: {
        totalCollateralUSD,
        totalBorrowUSD,
        collateralsBySymbol,
        borrowsBySymbol,
        obligationCount: allObligations.length,
        activeObligationCount,
      },
    };
  } catch (error) {
    console.error(
      "[getWalletObligationTotals] Error calculating totals:",
      error
    );
    return {
      success: false,
      totals: {
        totalCollateralUSD: 0,
        totalBorrowUSD: 0,
        collateralsBySymbol: {},
        borrowsBySymbol: {},
        obligationCount: 0,
        activeObligationCount: 0,
      },
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Returns only unlocked and empty obligations that can be reused
 * @param address User's wallet address
 * @returns Array of empty, unlocked obligations ready to be reused
 */
export async function listReusableObligations(
  address: string
): Promise<DisplayObligation[]> {
  const all = await getUserObligations(address);
  return all.filter((o) => o.isEmpty && !o.isLocked);
}

/**
 * Get detailed information for a specific obligation ID
 *
 * @param obligationId The ID of the obligation to fetch details for
 * @param address The user's wallet address (required for some SDK calls)
 * @returns Detailed obligation information
 */
export async function getObligationDetails(
  obligationId: string,
  address: string
): Promise<{
  success: boolean;
  obligation?: DisplayObligation;
  error?: string;
}> {
  try {
    console.log(
      `[getObligationDetails] Fetching details for obligation ${obligationId}`
    );

    // Create a query instance
    const scallop = await getScallop();
    const sdk = await scallop.createScallopQuery();
    await sdk.init();

    console.log(
      `[getObligationDetails] SDK initialized, getting obligation account`
    );

    // Get obligation details using SDK
    const obligationAccount = await sdk.getObligationAccount(
      obligationId,
      address
    );

    if (!obligationAccount) {
      console.warn(
        `[getObligationDetails] Could not get obligation account data for ${obligationId}`
      );
      return {
        success: false,
        error: `Obligation with ID ${obligationId} not found or not accessible.`,
      };
    }

    console.log(
      `[getObligationDetails] Got obligation account data:`,
      obligationAccount
    );

    // Process collaterals - properly handle different property names
    const collaterals = Object.entries(obligationAccount.collaterals || {})
      .filter(([_, collateral]: [string, any]) => {
        // Check for any of the possible amount fields
        const hasAmount =
          collateral.amount > 0 ||
          collateral.depositedAmount > 0 ||
          collateral.depositedCoin > 0 ||
          collateral.amountUSD > 0 ||
          collateral.depositedValue > 0;
        return collateral && hasAmount;
      })
      .map(([_, collateral]: [string, any]) => ({
        symbol: collateral.symbol || collateral.coinName,
        amount: Number(
          collateral.amount ||
            collateral.depositedCoin ||
            (collateral.depositedAmount
              ? collateral.depositedAmount /
                Math.pow(10, collateral.coinDecimal || 9)
              : 0) ||
            0
        ),
        usd: Number(collateral.amountUSD || collateral.depositedValue || 0),
      }));

    // Process borrows - ONLY include assets with actual debt
    const borrows = Object.entries(obligationAccount.debts || {})
      .filter(([_, debt]: [string, any]) => {
        const hasAmount =
          debt.amount > 0 ||
          debt.borrowedAmount > 0 ||
          debt.borrowedCoin > 0 ||
          debt.amountUSD > 0 ||
          debt.borrowedValue > 0;
        return debt && hasAmount;
      })
      .map(([_, debt]: [string, any]) => ({
        symbol: debt.symbol || debt.coinName,
        amount: Number(
          debt.amount ||
            debt.borrowedCoin ||
            (debt.borrowedAmount
              ? debt.borrowedAmount / Math.pow(10, debt.coinDecimal || 9)
              : 0) ||
            0
        ),
        usd: Number(debt.amountUSD || debt.borrowedValue || 0),
      }));

    const totalCollateralUSD =
      Number(obligationAccount.totalDepositedValue) || 0;
    const totalBorrowUSD = Number(obligationAccount.totalBorrowedValue) || 0;
    const isEmpty = collaterals.length === 0 && borrows.length === 0;

    // Check if there are any borrow incentives
    const borrowIncentiveKeys = Object.keys(
      obligationAccount.borrowIncentives || {}
    );
    const hasBorrowIncentiveStake = borrowIncentiveKeys.length > 0;

    // Check if we have greater than 1x multiplier on any incentives
    let hasBoostStake = false;
    if (hasBorrowIncentiveStake) {
      const incentives = Object.values(
        obligationAccount.borrowIncentives || {}
      );
      for (const incentive of incentives) {
        for (const reward of incentive.rewards || []) {
          if (reward.boostValue && reward.boostValue > 1.0) {
            hasBoostStake = true;
            break;
          }
        }
        if (hasBoostStake) break;
      }
    }

    // Determine lock type based on stakes
    const lockType = hasBorrowIncentiveStake
      ? "borrow-incentive"
      : hasBoostStake
      ? "boost"
      : null;

    // Is the obligation locked for modifications?
    const isLocked = hasBorrowIncentiveStake || hasBoostStake;

    // Create DisplayObligation object
    const obligationDetails: DisplayObligation = {
      obligationId,
      collaterals,
      borrows,
      totalCollateralUSD,
      totalBorrowUSD,
      lockType,
      lockEnds: null, // Lock end time not directly available in data structure
      hasBorrowIncentiveStake,
      hasBoostStake,
      isLocked,
      isEmpty,
      riskLevel: Number(obligationAccount.totalRiskLevel) || 0,
    };

    console.log(
      "[getObligationDetails] Processed obligation details:",
      JSON.parse(JSON.stringify(obligationDetails))
    );

    return {
      success: true,
      obligation: obligationDetails,
    };
  } catch (error) {
    console.error(
      `[getObligationDetails] Error fetching obligation details:`,
      error
    );
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Debug function to display detailed collateral information for a specific obligation
 *
 * @param obligationId The ID of the obligation to inspect
 * @param address User's wallet address
 */
export async function debugObligationCollateral(
  obligationId: string,
  address: string
): Promise<{
  success: boolean;
  debug: {
    obligationId: string;
    totalCollateralUSD: number;
    collaterals: Array<{
      symbol: string;
      amount: number;
      usd: number;
      hasValue: boolean; // For debugging which assets have value
    }>;
    hasSomeCollateral: boolean;
    nonZeroCollaterals: number;
    rawObligation?: any; // Add the raw data for inspection
  };
  error?: string;
}> {
  try {
    console.log(
      `[debugObligationCollateral] Inspecting obligation ${obligationId}`
    );

    // Get the raw obligation data first
    const scallop = await getScallop();
    const sdk = await scallop.createScallopQuery();
    await sdk.init();
    const rawObligation = await sdk.getObligationAccount(obligationId, address);

    if (!rawObligation) {
      return {
        success: false,
        debug: {
          obligationId,
          totalCollateralUSD: 0,
          collaterals: [],
          hasSomeCollateral: false,
          nonZeroCollaterals: 0,
        },
        error: "Could not fetch obligation data",
      };
    }

    // Log the raw SUI collateral for inspection
    if (rawObligation.collaterals?.sui) {
      console.log("Raw SUI collateral data:", rawObligation.collaterals.sui);
    }

    // Now get the processed obligation details
    const details = await getObligationDetails(obligationId, address);

    if (!details.success || !details.obligation) {
      return {
        success: false,
        debug: {
          obligationId,
          totalCollateralUSD: 0,
          collaterals: [],
          hasSomeCollateral: false,
          nonZeroCollaterals: 0,
          rawObligation: rawObligation,
        },
        error: details.error || "Failed to get obligation details",
      };
    }

    // Extract collateral info for debugging
    const { collaterals, totalCollateralUSD } = details.obligation;

    // Add debug info about which assets have value
    const enhancedCollaterals = collaterals.map((c) => ({
      ...c,
      hasValue: c.amount > 0 && c.usd > 0,
    }));

    // Count non-zero collaterals
    const nonZeroCollaterals = enhancedCollaterals.filter(
      (c) => c.hasValue
    ).length;
    const hasSomeCollateral = nonZeroCollaterals > 0;

    // Log debugging info
    console.log(`[debugObligationCollateral] Obligation ${obligationId} has:`);
    console.log(`- Total USD value: $${totalCollateralUSD}`);
    console.log(`- ${nonZeroCollaterals} non-zero collateral asset(s)`);

    if (nonZeroCollaterals > 0) {
      console.log("Non-zero collateral assets:");
      enhancedCollaterals
        .filter((c) => c.hasValue)
        .forEach((c) => {
          console.log(`- ${c.symbol}: ${c.amount} (${c.usd} USD)`);
        });
    }

    return {
      success: true,
      debug: {
        obligationId,
        totalCollateralUSD,
        collaterals: enhancedCollaterals,
        hasSomeCollateral,
        nonZeroCollaterals,
        rawObligation: rawObligation,
      },
    };
  } catch (error) {
    console.error("[debugObligationCollateral] Error:", error);
    return {
      success: false,
      debug: {
        obligationId,
        totalCollateralUSD: 0,
        collaterals: [],
        hasSomeCollateral: false,
        nonZeroCollaterals: 0,
      },
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Convert obligation collateral into user position format
 * This function helps bridge the gap between the obligation data format
 * and what the UI expects for displaying collateral.
 *
 * @param obligation The obligation to convert collaterals from
 * @returns Array of user position objects that can be displayed in UI
 */
export function convertObligationCollateralToUserPositions(
  obligation: DisplayObligation
): Array<{
  symbol: string;
  coinType: string; // Will be empty or best guess
  amount: number;
  valueUSD: number;
  apy: number;
  decimals: number; // Will use default value
  price: number;
}> {
  if (
    !obligation ||
    !obligation.collaterals ||
    obligation.collaterals.length === 0
  ) {
    return [];
  }

  // Extract collateral info and convert to user position format
  return obligation.collaterals.map((collateral) => {
    // Calculate price if possible, otherwise set to 0
    const price =
      collateral.amount > 0 ? collateral.usd / collateral.amount : 0;

    return {
      symbol: collateral.symbol,
      coinType: "", // We don't have this info from obligation, can be filled in by consumer
      amount: collateral.amount,
      valueUSD: collateral.usd,
      apy: 0, // Collateral doesn't earn APY directly
      decimals: collateral.symbol.toLowerCase() === "sui" ? 9 : 6, // Use typical defaults
      price,
    };
  });
}

/**
 * Get obligation collaterals as user positions
 * This is a utility function to help display collateral in the UI in the format it expects
 *
 * @param obligationId The obligation ID to get collateral from
 * @param address User's wallet address
 * @returns Array of user position objects representing the collateral
 */
export async function getObligationCollateralAsUserPositions(
  obligationId: string,
  address: string
): Promise<
  Array<{
    symbol: string;
    coinType: string;
    amount: number;
    valueUSD: number;
    apy: number;
    decimals: number;
    price: number;
  }>
> {
  try {
    // Get detailed obligation data
    const details = await getObligationDetails(obligationId, address);

    if (!details.success || !details.obligation) {
      console.error(
        `[getObligationCollateralAsUserPositions] Failed to get obligation details: ${details.error}`
      );
      return [];
    }

    // Convert the obligation's collateral to user position format
    return convertObligationCollateralToUserPositions(details.obligation);
  } catch (error) {
    console.error(`[getObligationCollateralAsUserPositions] Error:`, error);
    return [];
  }
}

/**
 * Fallback method using direct RPC call to find obligation keys
 */
async function getFallbackObligations(
  address: string,
  opts: GetOblsOpts = {}
): Promise<DisplayObligation[]> {
  try {
    if (!address || typeof address !== "string") {
      console.error(`[getFallbackObligations] Invalid address: ${address}`);
      return [];
    }

    // Log exactly what we're sending to the RPC
    console.log("owner param is", typeof address, address);
    console.log("package id is", SCALLOP_PACKAGE_ID);

    // Direct RPC call using the correct parameters
    const { data } = await suiClient.getOwnedObjects({
      owner: address,
      filter: {
        StructType: `${SCALLOP_PACKAGE_ID}::obligation::ObligationKey`,
      },
      options: { showContent: true },
    });

    if (!data.length) {
      console.log("[getFallbackObligations] No obligation keys found");
      return [];
    }

    // Extract obligation IDs from the keys
    const obligationIds = data
      .map((o) => {
        try {
          return (o.data?.content as any)?.fields?.obligation as string;
        } catch (err) {
          console.error("Error extracting obligation ID:", err);
          return null;
        }
      })
      .filter(Boolean); // Remove nulls

    if (!obligationIds.length) {
      console.log("[getFallbackObligations] No valid obligation IDs extracted");
      return [];
    }

    // Initialize query to get obligation details
    const scallop = await getScallop();
    const query = await scallop.createScallopQuery();
    await query.init();

    // Fetch each obligation
    const obligations = await Promise.all(
      obligationIds.map((id) =>
        query.getObligation({ obligationId: id }).catch((err) => {
          console.error(`Error fetching obligation ${id}:`, err);
          return null;
        })
      )
    );

    // Process the obligations
    let obls = obligations
      .filter(Boolean) // Remove nulls from any failed fetches
      .map((ob) => {
        const hasBorrowIncentiveStake = !!ob.borrowIncentive;
        const hasBoostStake = !!ob.boost;

        const collaterals = (ob.collaterals || [])
          .filter((c) => c && (c.amount > 0 || c.usd > 0))
          .map((c) => ({
            symbol: c.symbol || "Unknown",
            amount: Number(c.amount) || 0,
            usd: Number(c.usd) || 0,
          }));

        const borrows = (ob.borrows || [])
          .filter((b) => b && (b.amount > 0 || b.usd > 0))
          .map((b) => ({
            symbol: b.symbol || "Unknown",
            amount: Number(b.amount) || 0,
            usd: Number(b.usd) || 0,
          }));

        const totalCollateralUSD = collaterals.reduce(
          (sum, c) => sum + c.usd,
          0
        );
        const totalBorrowUSD = borrows.reduce((sum, b) => sum + b.usd, 0);

        return {
          obligationId: ob.obligationId,
          collaterals,
          borrows,
          totalCollateralUSD,
          totalBorrowUSD,
          lockType: hasBorrowIncentiveStake
            ? "borrow-incentive"
            : hasBoostStake
            ? "boost"
            : null,
          lockEnds: ob.lockEnd ?? null,
          hasBorrowIncentiveStake,
          hasBoostStake,
          isLocked: !!(ob.borrowIncentive?.isLocked || ob.boost?.isLocked),
          isEmpty: collaterals.length === 0 && borrows.length === 0,
        };
      });

    if (opts.onlyUnused) {
      obls = obls.filter((o) => o.isEmpty && !o.isLocked);
    }

    return obls;
  } catch (err) {
    console.error("[getFallbackObligations] Error:", err);
    return [];
  }
}

/**
 * Find an available obligation to use for borrowing or creating a new one if needed.
 * This function implements the strategy of reusing empty, unlocked obligations when available,
 * and only creating new obligations when necessary.
 *
 * @param wallet The wallet adapter to use for transactions
 * @param useEmpty If true, will look for and reuse empty unlocked obligations
 * @returns The obligation ID to use and whether it was just created
 */
export async function findOrCreateObligation(wallet: WalletAdapter): Promise<{
  obligationId: string;
  isNew: boolean;
  success: boolean;
  error?: string;
}> {
  try {
    const sender = await extractWalletAddress(wallet);
    if (!sender) {
      return {
        obligationId: "",
        isNew: false,
        success: false,
        error: "Wallet not connected",
      };
    }

    console.log(
      `[findOrCreateObligation] Finding available obligation for ${sender}`
    );

    // Step 1: Try to find an unlocked, empty obligation to reuse
    const reusableObligations = await listReusableObligations(sender);

    // Log what we found for debugging
    console.log(
      `[findOrCreateObligation] Found ${reusableObligations.length} reusable obligations`
    );

    // If we have an empty, unlocked obligation, use that
    if (reusableObligations.length > 0) {
      const reuseObligation = reusableObligations[0];
      console.log(
        `[findOrCreateObligation] Reusing empty obligation: ${reuseObligation.obligationId}`
      );

      return {
        obligationId: reuseObligation.obligationId,
        isNew: false,
        success: true,
      };
    }

    // Step 2: No available obligations - create a new one
    console.log(
      `[findOrCreateObligation] No reusable obligations found, creating new one`
    );
    const createResult = await createObligation(wallet);

    if (!createResult.success) {
      return {
        obligationId: "",
        isNew: false,
        success: false,
        error: createResult.error || "Failed to create obligation",
      };
    }

    console.log(
      `[findOrCreateObligation] Successfully created new obligation: ${createResult.obligationId}`
    );

    return {
      obligationId: createResult.obligationId,
      isNew: true,
      success: true,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("[findOrCreateObligation] Error:", errorMessage);

    return {
      obligationId: "",
      isNew: false,
      success: false,
      error: `Error finding or creating obligation: ${errorMessage}`,
    };
  }
}

/**
 * Create a new obligation for the user
 * @param wallet The wallet adapter instance
 * @returns Transaction result object
 */
export async function createObligation(wallet: WalletAdapter) {
  try {
    const sender = await extractWalletAddress(wallet);
    if (!sender) throw new Error("Wallet not connected");

    const scallop = await getScallop();
    const builder = await scallop.createScallopBuilder();
    const tx = builder.createTxBlock();
    tx.setSender(sender);

    // Open the Obligation and the associated key + handle pointer (hp)
    const [obl, oblKey, hp] = await tx.openObligation();

    // Immediately return the obligation so that it becomes a shared object
    await tx.returnObligation(obl, hp);

    // Send the ObligationKey back to the wallet (handy later for deposits)
    tx.transferObjects([oblKey], sender);
    tx.setGasBudget(20_000_000);

    const res = await wallet.signAndExecuteTransactionBlock({
      transactionBlock: tx.txBlock,
      options: { showEffects: true, showEvents: true },
    });

    // Extract obligation ID from transaction result
    const obligationEvent = res.events?.find(
      (e) => e.type.includes("Obligation") && e.type.includes("Created")
    );
    const obligationId =
      obligationEvent?.parsedJson?.obligation_id ||
      obligationEvent?.objectId ||
      obl; // fallback to local var

    // Convert to string if it's not already (v2.2.0 returns a TransactionArgument)
    const idStr =
      typeof obligationId === "string" ? obligationId : String(obligationId);

    return {
      success: true,
      digest: res.digest,
      obligationId: idStr,
      txLink: `${SUIVISION_URL}${res.digest}`,
      timestamp: new Date().toISOString(),
    };
  } catch (e: any) {
    return { success: false, error: e.message || String(e) };
  }
}

/**
 * Single-operation function to create an obligation and deposit collateral in one action.
 * This is useful when all existing obligations are locked and you need a new one with collateral.
 *
 * @param wallet The wallet adapter
 * @param coin The type of coin to deposit ('sui', 'usdc', etc.)
 * @param amount The amount to deposit in human-readable units
 * @param decimals The number of decimals for the coin (9 for SUI, 6 for USDC)
 * @returns Transaction result
 */
export async function createObligationAndDeposit(
  wallet: WalletAdapter,
  coin: "sui" | "usdc" | "usdt",
  amount: number,
  decimals: number = coin === "sui" ? 9 : 6
) {
  try {
    const sender = await extractWalletAddress(wallet);
    if (!sender) {
      throw new Error("Wallet not connected");
    }

    console.log(
      `[createObligationAndDeposit] Creating new obligation and depositing ${amount} ${coin}`
    );

    // Calculate amount in base units
    const baseUnits = BigInt(Math.floor(amount * 10 ** decimals));

    // Build transaction with openObligation and depositCollateral in one tx
    const scallop = await getScallop();
    const builder = await scallop.createScallopBuilder();
    const tx = builder.createTxBlock();
    tx.setSender(sender);

    // 1. Create the new obligation
    const [obl, oblKey, hp] = await tx.openObligation();

    // 2. Add collateral to the new obligation - omit clock parameter
    await tx.addCollateral({
      obligation: obl,
      coinType: coin,
      amount: baseUnits,
      // clock parameter omitted - builder injects it automatically
    });

    // 3. Return the obligation (shared object) and key to sender
    await tx.returnObligation(obl, hp);
    tx.transferObjects([oblKey], sender);

    // Set sufficient gas budget for both operations
    tx.setGasBudget(40_000_000);

    // Execute the transaction
    const result = await wallet.signAndExecuteTransactionBlock({
      transactionBlock: tx.txBlock,
      options: { showEffects: true, showEvents: true },
    });

    // Extract the obligation ID from the results
    const obligationEvent = result.events?.find(
      (e) => e.type.includes("Obligation") && e.type.includes("Created")
    );
    const obligationId =
      obligationEvent?.parsedJson?.obligation_id ||
      obligationEvent?.objectId ||
      obl;

    // Convert to string if necessary
    const idStr =
      typeof obligationId === "string" ? obligationId : String(obligationId);

    console.log(
      `[createObligationAndDeposit] Success! Created obligation ${idStr} with ${amount} ${coin}`
    );

    return {
      success: true,
      digest: result.digest,
      txLink: `${SUIVISION_URL}${result.digest}`,
      obligationId: idStr,
      amount,
      coin: coin.toUpperCase(),
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    console.error("[createObligationAndDeposit] Error:", err);

    const errorMessage = err instanceof Error ? err.message : String(err);
    let userErrorMessage = errorMessage;

    if (
      errorMessage.includes("iterable") ||
      errorMessage.includes("Symbol(Symbol.iterator)")
    ) {
      userErrorMessage =
        "Failed due to a technical issue with the price oracle. Try again with a different amount.";
    }

    return {
      success: false,
      error: userErrorMessage,
    };
  }
}

/**
 * Ensures there's an obligation with collateral ready to use
 * This function will:
 * 1. Try to reuse an existing empty unlocked obligation
 * 2. If none found, create a new one and deposit collateral in one transaction
 * 3. If a reusable one is found, just deposit collateral to it
 *
 * @param wallet The wallet adapter
 * @param coin The type of coin to deposit ('sui', 'usdc', etc.)
 * @param amount The amount to deposit in human-readable units
 * @param decimals The number of decimals for the coin (9 for SUI, 6 for USDC)
 * @returns Transaction result
 */
export async function ensureObligationWithCollateral(
  wallet: WalletAdapter,
  coin: "sui" | "usdc" | "usdt",
  amount: number,
  decimals = coin === "sui" ? 9 : 6
) {
  try {
    const sender = await extractWalletAddress(wallet);
    if (!sender) throw new Error("wallet not connected");

    /* 1️⃣ reuse if possible */
    const reusable = await listReusableObligations(sender);
    const targetId = reusable[0]?.obligationId;

    /* 2️⃣ if none, create + deposit in one TX */
    if (!targetId) {
      return await createObligationAndDeposit(wallet, coin, amount, decimals);
    }

    /* 3️⃣ just deposit to existing */
    return await depositCollateral(wallet, targetId, coin, amount, decimals);
  } catch (err) {
    console.error("[ensureObligationWithCollateral] Error:", err);

    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Borrow assets from the Scallop lending protocol using the SDK's smartBorrow helper.
 * This uses the SDK's built-in logic to:
 * 1. Find an available unlocked obligation or create a new one
 * 2. Add collateral if needed
 * 3. Borrow the requested asset
 *
 * @param wallet Connected wallet
 * @param coin The coin to borrow ('usdc', 'sui', 'usdt')
 * @param amount Amount to borrow (in human-readable units)
 * @param decimals Decimals of the coin (6 for USDC/USDT, 9 for SUI)
 * @returns Transaction result
 */
export async function smartBorrow(
  wallet: WalletAdapter,
  coin: "usdc" | "sui" | "usdt",
  amount: number,
  decimals = 6
) {
  try {
    const sender = await extractWalletAddress(wallet);
    if (!sender) throw new Error("Wallet not connected");

    console.log("[smartBorrow] Borrowing assets:", {
      coin,
      amount,
      sender,
    });

    // Calculate borrow amount in base units
    const borrowBaseUnits = Math.floor(amount * 10 ** decimals);

    // Create a ScallopBuilder
    const scallop = await getScallop();
    const builder = await scallop.createScallopBuilder();
    const tx = builder.createTxBlock();
    tx.setSender(sender);

    // Use borrowQuick which handles everything including finding/creating obligation
    console.log(`[smartBorrow] Using borrowQuick for ${amount} ${coin}`);
    const borrowedCoin = await tx.borrowQuick(borrowBaseUnits, coin);

    // Transfer borrowed assets to sender
    tx.transferObjects([borrowedCoin], sender);

    // Set gas budget
    tx.setGasBudget(60_000_000);

    // Execute the transaction
    const result = await wallet.signAndExecuteTransactionBlock({
      transactionBlock: tx.txBlock,
      options: { showEffects: true, showEvents: true },
    });

    console.log("[smartBorrow] Transaction successful:", result.digest);

    return {
      success: true,
      digest: result.digest,
      txLink: `${SUIVISION_URL}${result.digest}`,
      amount,
      coin: coin.toUpperCase(),
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    console.error("[smartBorrow] Error borrowing assets:", err);

    // Handle common borrow errors with user-friendly messages
    const errorMessage = err instanceof Error ? err.message : String(err);
    let userErrorMessage = errorMessage;

    if (errorMessage.includes("1281")) {
      userErrorMessage =
        "Borrow failed: You're trying to borrow too much. Either lower the amount or add more collateral.";
    } else if (errorMessage.includes("1282")) {
      userErrorMessage = `Borrow failed: Amount too small. The minimum borrow amount is about 0.01 ${coin.toUpperCase()}.`;
    } else if (errorMessage.includes("No coin found for instruction")) {
      userErrorMessage =
        "Borrow failed: You need to add collateral before borrowing.";
    } else if (errorMessage.includes("oracle feed")) {
      userErrorMessage =
        "Borrow failed: Oracle price feed unavailable. Please try again in a few moments.";
    } else if (errorMessage.includes("770")) {
      userErrorMessage =
        "Borrow failed: The selected obligation is locked. Please try again with a different obligation.";
    } else if (
      errorMessage.includes("iterable") ||
      errorMessage.includes("Symbol(Symbol.iterator)")
    ) {
      userErrorMessage =
        "Borrow failed due to a technical issue with the price oracle. Try again with a different amount.";
    } else if (
      errorMessage.includes("is not a function") ||
      errorMessage.includes("Cannot convert undefined or null to object") ||
      errorMessage.includes("Invalid argument type")
    ) {
      userErrorMessage =
        "Borrow failed due to SDK compatibility issues. Please try a smaller amount or try again later.";
    }

    return {
      success: false,
      error: userErrorMessage,
    };
  }
}

/**
 * Borrow assets from a specific obligation using the scallopTxBlock.borrowQuick method
 *
 * @param wallet Connected wallet
 * @param obligationId The ID of the obligation to borrow from
 * @param coin The coin to borrow
 * @param amount Amount to borrow in human-readable units
 * @param decimals Decimals of the coin
 * @returns Transaction result
 */
export async function borrowFromObligation(
  wallet: any,
  obligationId: string,
  coin: "usdc" | "sui" | "usdt",
  amount: number,
  decimals = 6
) {
  try {
    const sender = await extractWalletAddress(wallet);
    if (!sender) throw new Error("Wallet not connected");

    console.log(
      `[Borrow] Borrowing ${amount} ${coin} from obligation ${obligationId}`
    );

    // Calculate the amount in base units
    const base = Math.floor(amount * 10 ** decimals);

    // Create a ScallopBuilder
    const scallop = await getScallop();
    const builder = await scallop.createScallopBuilder();
    const tx = builder.createTxBlock();
    tx.setSender(sender);

    // Use the borrowQuick helper method which handles all the details
    console.log(`[Borrow] Using borrowQuick for ${amount} ${coin}`);
    const borrowedCoin = await tx.borrowQuick(base, coin, obligationId);

    // Transfer borrowed assets to sender
    tx.transferObjects([borrowedCoin], sender);

    // Execute the transaction
    const result = await wallet.signAndExecuteTransactionBlock({
      transactionBlock: tx.txBlock,
      options: { showEffects: true },
    });

    console.log(`[Borrow] Success! Transaction: ${result.digest}`);

    return {
      success: true,
      digest: result.digest,
      txLink: `${SUIVISION_URL}${result.digest}`,
      amount,
      coin: coin.toUpperCase(),
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    console.error("[Borrow] Error borrowing from obligation:", err);

    // Handle common borrow errors
    const errorMessage = err instanceof Error ? err.message : String(err);
    let userErrorMessage = errorMessage;

    if (errorMessage.includes("1281")) {
      userErrorMessage =
        "Borrow failed: You're trying to borrow too much. Either lower the amount or add more collateral.";
    } else if (errorMessage.includes("1282")) {
      userErrorMessage = `Borrow failed: Amount too small. The minimum borrow amount is about 0.01 ${coin.toUpperCase()}.`;
    } else if (errorMessage.includes("770")) {
      userErrorMessage =
        "Borrow failed: This obligation is locked by incentive staking. Please unstake it first.";
    } else if (errorMessage.includes("Invalid argument type")) {
      userErrorMessage =
        "Borrow failed due to SDK compatibility issue. We're working on a fix.";
    } else if (
      errorMessage.includes("iterable") ||
      errorMessage.includes("Symbol(Symbol.iterator)")
    ) {
      userErrorMessage =
        "Borrow failed due to a technical issue with the price oracle. Try again with a different amount.";
    } else if (
      errorMessage.includes("is not a function") ||
      errorMessage.includes("Cannot convert undefined or null to object")
    ) {
      userErrorMessage =
        "Borrow failed due to SDK compatibility issues. Please try a smaller amount or try again later.";
    } else if (errorMessage.includes("ERR_NAME_NOT_RESOLVED")) {
      userErrorMessage =
        "Network error: Price oracle services are currently unavailable. Please try again later.";
    }

    return {
      success: false,
      error: userErrorMessage,
    };
  }
}

/**
 * Add collateral to a specific obligation using depositCollateralQuick
 *
 * @param wallet Connected wallet
 * @param obligationId The ID of the obligation to add collateral to
 * @param coin The coin to add as collateral
 * @param amount Amount to add in human-readable units
 * @param decimals Decimals of the coin
 * @returns Transaction result
 */
export async function depositCollateral(
  wallet: any,
  obligationId: string,
  coin: "usdc" | "sui" | "usdt",
  amount: number,
  decimals = 6
) {
  try {
    const sender = await extractWalletAddress(wallet);
    if (!sender) throw new Error("Wallet not connected");

    console.log(
      `[Deposit] Adding ${amount} ${coin} to obligation ${obligationId}`
    );

    // Convert amount to base units
    const baseUnits = Math.floor(amount * 10 ** decimals);

    // Create a ScallopBuilder
    const scallop = await getScallop();
    const builder = await scallop.createScallopBuilder();
    const tx = builder.createTxBlock();
    tx.setSender(sender);

    // Use depositCollateralQuick to handle everything
    console.log(`[Deposit] Using depositCollateralQuick for ${amount} ${coin}`);
    await tx.depositCollateralQuick(baseUnits, coin, obligationId);

    // Set gas budget
    tx.setGasBudget(30_000_000);

    // Execute the transaction
    const result = await wallet.signAndExecuteTransactionBlock({
      transactionBlock: tx.txBlock,
      options: { showEffects: true },
    });

    console.log(`[Deposit] Success! Transaction: ${result.digest}`);

    return {
      success: true,
      digest: result.digest,
      txLink: `${SUIVISION_URL}${result.digest}`,
      amount,
      coin: coin.toUpperCase(),
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    console.error("[Deposit] Error depositing collateral:", err);

    const errorMessage = err instanceof Error ? err.message : String(err);
    let userErrorMessage = errorMessage;

    // Check for locked obligation error
    if (errorMessage.includes("770")) {
      userErrorMessage =
        "Deposit failed: This obligation is locked by incentive staking. Please unstake it first.";
    } else if (
      errorMessage.includes("iterable") ||
      errorMessage.includes("Symbol(Symbol.iterator)")
    ) {
      userErrorMessage =
        "Deposit failed due to a technical issue with the price oracle. Try again with a different amount.";
    } else if (
      errorMessage.includes("is not a function") ||
      errorMessage.includes("Cannot convert undefined or null to object") ||
      errorMessage.includes("Invalid argument type")
    ) {
      userErrorMessage =
        "Deposit failed due to SDK compatibility issues. Please try a smaller amount or try again later.";
    }

    return {
      success: false,
      error: userErrorMessage,
    };
  }
}

/**
 * Smart deposit function that automatically finds/creates an unlocked obligation
 * and deposits collateral. This handles the case where existing obligations might be locked.
 *
 * @param wallet The wallet adapter
 * @param coin The coin to deposit as collateral
 * @param amount Amount to deposit in human-readable units
 * @param decimals Decimals of the coin
 * @returns Transaction result
 */
export async function smartDeposit(
  wallet: WalletAdapter,
  coin: "usdc" | "sui" | "usdt",
  amount: number,
  decimals = coin === "sui" ? 9 : 6
) {
  try {
    const sender = await extractWalletAddress(wallet);
    if (!sender) throw new Error("Wallet not connected");

    console.log(`[smartDeposit] Depositing ${amount} ${coin}`);

    // Find or create an available obligation
    const obligationResult = await findOrCreateObligation(wallet);
    if (!obligationResult.success) {
      throw new Error(
        obligationResult.error || "Failed to find or create obligation"
      );
    }

    // Proceed with deposit to the selected obligation
    const obligationId = obligationResult.obligationId;
    const isNewObligation = obligationResult.isNew;

    console.log(
      `[smartDeposit] Using obligation: ${obligationId} (new: ${isNewObligation})`
    );

    // Use the depositCollateral function which uses depositCollateralQuick
    const depositResult = await depositCollateral(
      wallet,
      obligationId,
      coin,
      amount,
      decimals
    );

    if (!depositResult.success) {
      throw new Error(depositResult.error || "Failed to deposit collateral");
    }

    return {
      success: true,
      digest: depositResult.digest,
      txLink: depositResult.txLink,
      amount,
      coin: coin.toUpperCase(),
      obligationId,
      obligationCreated: isNewObligation,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    console.error("[smartDeposit] Error depositing collateral:", err);

    const errorMessage = err instanceof Error ? err.message : String(err);
    let userErrorMessage = errorMessage;

    // Check for locked obligation error
    if (errorMessage.includes("770")) {
      userErrorMessage =
        "Deposit failed: This obligation is locked. Please try again.";
    } else if (
      errorMessage.includes("iterable") ||
      errorMessage.includes("Symbol(Symbol.iterator)")
    ) {
      userErrorMessage =
        "Deposit failed due to a technical issue with the price oracle. Try again with a different amount.";
    } else if (
      errorMessage.includes("is not a function") ||
      errorMessage.includes("Cannot convert undefined or null to object") ||
      errorMessage.includes("Invalid argument type")
    ) {
      userErrorMessage =
        "Deposit failed due to SDK compatibility issues. Please try a smaller amount or try again later.";
    }

    return {
      success: false,
      error: userErrorMessage,
    };
  }
}

/**
 * A React component to debug obligation data in the UI
 */
export function createObligationDebugger(
  obligationId: string,
  walletAddress: string
) {
  const debugHTML = `
    <div style="padding: 10px; margin: 10px; border: 1px solid gray; border-radius: 4px; background-color: #1a202c; color: white;">
      <h3>Obligation Debugger</h3>
      <button id="debug-obligation-btn" style="padding: 5px 10px; background-color: #4a5568; color: white; border: none; border-radius: 4px; cursor: pointer;">
        Debug Collateral
      </button>
      <div id="debug-obligation-result" style="margin-top: 10px;"></div>
    </div>
  `;

  // Add debugging functionality
  setTimeout(() => {
    const button = document.getElementById("debug-obligation-btn");
    const resultDiv = document.getElementById("debug-obligation-result");

    if (button && resultDiv) {
      button.addEventListener("click", async () => {
        button.disabled = true;
        button.textContent = "Loading...";
        resultDiv.innerHTML = "";

        try {
          const result = await debugObligationCollateral(
            obligationId,
            walletAddress
          );
          console.log("Debug Obligation Result:", result);

          if (result.success) {
            const { debug } = result;
            let html = `
              <h4>Obligation: ${debug.obligationId.substring(0, 10)}...</h4>
              <p>Total USD Value: $${debug.totalCollateralUSD.toFixed(2)}</p>
              <p>Non-zero Collaterals: ${debug.nonZeroCollaterals}</p>
            `;

            if (debug.hasSomeCollateral) {
              html += `
                <table style="border-collapse: collapse; width: 100%; color: white;">
                  <thead>
                    <tr>
                      <th style="text-align: left; padding: 5px; border-bottom: 1px solid #4a5568;">Asset</th>
                      <th style="text-align: right; padding: 5px; border-bottom: 1px solid #4a5568;">Amount</th>
                      <th style="text-align: right; padding: 5px; border-bottom: 1px solid #4a5568;">USD Value</th>
                    </tr>
                  </thead>
                  <tbody>
              `;

              debug.collaterals
                .filter((c) => c.hasValue)
                .forEach((collateral) => {
                  html += `
                    <tr>
                      <td style="padding: 5px; border-bottom: 1px solid #4a5568;">${
                        collateral.symbol
                      }</td>
                      <td style="text-align: right; padding: 5px; border-bottom: 1px solid #4a5568;">${collateral.amount.toFixed(
                        6
                      )}</td>
                      <td style="text-align: right; padding: 5px; border-bottom: 1px solid #4a5568;">$${collateral.usd.toFixed(
                        2
                      )}</td>
                    </tr>
                  `;
                });

              html += `
                  </tbody>
                </table>
              `;
            } else {
              html += `<p>No collateral assets with value found.</p>`;
            }

            // Add raw data inspection button
            html += `
              <button id="show-raw-data" style="margin-top: 10px; padding: 5px 10px; background-color: #2d3748; color: white; border: none; border-radius: 4px; cursor: pointer;">
                Show Raw Data
              </button>
              <div id="raw-data-container" style="display: none; margin-top: 10px; max-height: 300px; overflow: auto; background-color: #2d3748; padding: 10px; border-radius: 4px;"></div>
            `;

            resultDiv.innerHTML = html;

            // Add raw data toggle functionality
            const showRawBtn = document.getElementById("show-raw-data");
            const rawDataContainer =
              document.getElementById("raw-data-container");

            if (showRawBtn && rawDataContainer) {
              showRawBtn.addEventListener("click", () => {
                if (rawDataContainer.style.display === "none") {
                  rawDataContainer.textContent = JSON.stringify(
                    debug.rawObligation,
                    null,
                    2
                  );
                  rawDataContainer.style.display = "block";
                  showRawBtn.textContent = "Hide Raw Data";
                } else {
                  rawDataContainer.style.display = "none";
                  showRawBtn.textContent = "Show Raw Data";
                }
              });
            }
          } else {
            resultDiv.innerHTML = `<p style="color: #fc8181;">Error: ${
              result.error || "Unknown error"
            }</p>`;
          }
        } catch (error) {
          resultDiv.innerHTML = `<p style="color: #fc8181;">Error: ${
            error.message || "Unknown error"
          }</p>`;
          console.error("Debug failed:", error);
        } finally {
          button.disabled = false;
          button.textContent = "Debug Collateral";
        }
      });
    }
  }, 100);

  return debugHTML;
}
// Export the service functions
const scallopBorrowService = {
  borrow: smartBorrow, // We replace the regular borrow with smart borrow as default
  borrowFromObligation,
  depositCollateral: smartDeposit, // We replace regular deposit with smartDeposit as default
  getUserObligations,
  createObligation,
  findOrCreateObligation,
  createObligationAndDeposit,
  getObligationDetails,
  debugObligationCollateral, // Add debug function
  createObligationDebugger, // Add UI debugging component
  getObligationCollateralAsUserPositions, // New helper function to get collateral for UI
  convertObligationCollateralToUserPositions, // Utility to convert collateral format
  listReusableObligations, // New helper to get only reusable obligations
  ensureObligationWithCollateral, // New helper to ensure obligation with collateral exists
  getWalletObligationTotals, // New function to aggregate totals across all obligations

  // Export the original functions under different names for direct access
  rawBorrow: (wallet: any, coin: any, amount: number, decimals?: number) =>
    smartBorrow(wallet, coin, amount, decimals),
  rawDeposit: depositCollateral,
};

export default scallopBorrowService;
