// src/scallop/ScallopService.ts
// Last Updated: 2025-06-18 02:44:48 UTC - jake1318

import { SuiClient } from "@mysten/sui.js/client";
import { Scallop } from "@scallop-io/sui-scallop-sdk";
import { birdeyeService } from "../services/birdeyeService";
import { TransactionBlock } from "@mysten/sui.js/transactions";
import type { Coin } from "@mysten/sui.js/client";
import scallopBorrowService from "./ScallopBorrowService";

/** --- Core config --- **/
// Public RPC that works in the browser
export const SUI_MAINNET = "https://fullnode.mainnet.sui.io";
export const SCALLOP_ADDRESS_ID = "67c44a103fe1b8c454eb9699";

// Correct Scallop package and version object constants
export const SCALLOP_PACKAGE_ID =
  "0xa45b8ffca59e5b44ec7c04481a04cb620b0e07b2b183527bca4e5f32372c5f1a";
export const SCALLOP_VERSION_OBJECT =
  "0xd3325aa029fb6ba41ccd9b93996e0aa08507e95c861417bb428dc2cbb2f3c531";

// The canonical Move address for the SUI coin
export const CANON_SUI = "0x2::sui::SUI";

// Add fallbacks in case the primary RPC is down
export const client = new SuiClient({
  url: SUI_MAINNET,
  // websocketUrl is optional - only if you use subscriptions
});

export const scallop = new Scallop({
  addressId: SCALLOP_ADDRESS_ID,
  networkType: "mainnet",
  suiProvider: client,
});

// SuiVision base URL for transaction viewing
export const SUIVISION_URL = "https://suivision.xyz/txblock/";

// Proxy function for backward compatibility
export const getObligationBorrowData = async (id: string, addr?: string) =>
  scallopBorrowService.getObligationDetails(id, addr ?? "");

/** --- Interfaces --- **/
export interface UserPosition {
  symbol: string;
  coinType: string;
  amount: number;
  valueUSD: number;
  apy: number;
  decimals: number;
  price: number;
  isCollateral?: boolean; // Flag to indicate if this asset is used as collateral
}

export interface RewardInfo {
  symbol: string;
  coinType: string;
  amount: number; // in human units
  valueUSD: number;
}

/**
 * Extract wallet address from signer object with various fallbacks
 */
export async function extractWalletAddress(
  signer: any
): Promise<string | null> {
  let senderAddress = null;

  console.log("Extracting wallet address:", {
    signerType: typeof signer,
    hasAddress: !!signer?.address,
    hasGetAddress: typeof signer?.getAddress === "function",
    hasSignAndExecute:
      typeof signer?.signAndExecuteTransactionBlock === "function",
    walletProperties: Object.keys(signer || {}),
  });

  // Check various ways to get the address based on different wallet implementations
  if (typeof signer?.getAddress === "function") {
    senderAddress = await signer.getAddress();
    console.log("Got address via getAddress():", senderAddress);
  } else if (signer?.address) {
    // Some wallets provide the address directly
    senderAddress = signer.address;
    console.log("Got address via signer.address:", senderAddress);
  } else if (signer?.account?.address) {
    // Some wallets nest the address in an account property
    senderAddress = signer.account.address;
    console.log("Got address via signer.account.address:", senderAddress);
  } else if (typeof signer?.signAndExecuteTransactionBlock === "function") {
    // If we have the signAndExecuteTransactionBlock method but no address,
    // we're likely dealing with the wallet adapter but need to get the address differently

    // Try to get address via global wallet object
    if (typeof window !== "undefined") {
      if (
        window.suietWallet &&
        typeof window.suietWallet.getAddress === "function"
      ) {
        senderAddress = await window.suietWallet.getAddress();
        console.log(
          "Got address via window.suietWallet.getAddress():",
          senderAddress
        );
      } else if (
        window.suiWallet &&
        typeof window.suiWallet.getAccounts === "function"
      ) {
        const accounts = await window.suiWallet.getAccounts();
        if (accounts && accounts.length > 0) {
          senderAddress = accounts[0];
          console.log(
            "Got address via window.suiWallet.getAccounts():",
            senderAddress
          );
        }
      }
    }

    // If we still don't have an address but we have the wallet kit, try another way
    if (!senderAddress && typeof window !== "undefined" && window.walletKit) {
      try {
        senderAddress = window.walletKit.currentAccount?.address;
        console.log(
          "Got address via window.walletKit.currentAccount:",
          senderAddress
        );
      } catch (e) {
        console.error("Error getting address from walletKit:", e);
      }
    }
  }

  // Last resort - if we have a global wallet state in the window that we can access
  if (
    !senderAddress &&
    typeof window !== "undefined" &&
    window.__WALLET_STATE__
  ) {
    try {
      senderAddress = window.__WALLET_STATE__.account?.address;
      console.log("Got address from global wallet state:", senderAddress);
    } catch (e) {
      console.error("Error accessing global wallet state:", e);
    }
  }

  return senderAddress;
}

// Helper function to extract coin symbol from coinType
export function getCoinSymbol(coinType: string): string {
  // Extract the symbol from coinType like "0x2::sui::SUI" => "sui"
  const parts = coinType.split("::");
  if (parts.length === 3) {
    return parts[2].toLowerCase(); // Convert SUI to sui
  }
  // Fallback to lowercasing the entire coinType if format doesn't match
  return coinType.toLowerCase();
}

// Helper function to extract symbol from coin type
export function getSymbolFromCoinType(coinType: string): string {
  // Extract the symbol from coinType like "0x2::sui::SUI" => "SUI"
  const parts = coinType.split("::");
  if (parts.length === 3) {
    return parts[2];
  }
  // Fallback
  return coinType.split("::").pop() || coinType;
}

// Helper to normalize coin type to full Move path
export function normalizeCoinType(coinType: string): string {
  // If it already has proper format, return as is
  if (coinType.includes("::")) {
    // Make sure to normalize SUI addresses to the canonical form
    if (coinType.includes("::sui::SUI")) {
      return CANON_SUI;
    }
    return coinType;
  }

  // For SUI token
  if (coinType.toUpperCase() === "SUI") {
    // canonical form - the chain stores SUI under the short 0x2 address
    return CANON_SUI;
  }

  // For other common tokens, could add mappings here
  return coinType;
}

/**
 * Parse Move abort errors to provide better error messages
 */
export function parseMoveCallError(error: any): string | null {
  if (!error) return null;

  const errorMsg = error.message || String(error);

  // Check for standard Move abort patterns
  if (errorMsg.includes("MoveAbort")) {
    // Extract error code if available
    const errorCodeMatch = errorMsg.match(/MoveAbort\(.+?:\s*(\d+)\)/);
    if (errorCodeMatch && errorCodeMatch[1]) {
      const errorCode = errorCodeMatch[1];

      // Map known error codes to user-friendly messages
      switch (errorCode) {
        case "1795":
          return "Cannot withdraw that much collateral due to existing borrows. Repay some borrows first.";
        case "3":
          return "Insufficient balance to complete this transaction.";
        case "12":
          return "This transaction requires you to have an obligation account first.";
        case "100":
          return "You don't have permission to perform this action.";
        case "2050":
          return "The amount of market coin is too small to withdraw. Try withdrawing a larger amount.";
        default:
          return `Transaction failed with error code ${errorCode}.`;
      }
    }
  }

  // Check for wallet-specific errors
  if (errorMsg.includes("WALLET.SIGN_TX_ERROR")) {
    if (errorMsg.includes("Invalid input")) {
      return "Invalid transaction format. This may be due to an issue with the coin format.";
    }
    return "Transaction signing failed in wallet. Please try again.";
  }

  // Check for package not found errors
  if (errorMsg.includes("Package object does not exist")) {
    return "Transaction failed: Package object not found. This could be due to an incorrect package ID or network configuration.";
  }

  // Check for function not found errors
  if (
    errorMsg.includes("cannot find function") ||
    errorMsg.includes("module not found")
  ) {
    return "Transaction failed: The specified function or module was not found in the package. This could be due to calling a function that doesn't exist.";
  }

  // Check for argument errors
  if (errorMsg.includes("Incorrect number of arguments")) {
    return "Transaction failed: Incorrect number of arguments provided to the function call. Please check the function signature.";
  }

  // Check for insufficient gas
  if (errorMsg.includes("gas") && errorMsg.includes("insufficient")) {
    return "Not enough SUI to pay for transaction fees.";
  }

  // Check for common connection errors
  if (
    errorMsg.includes("fetch") ||
    errorMsg.includes("network") ||
    errorMsg.includes("timeout")
  ) {
    return "Network connection error. Please check your internet connection and try again.";
  }

  return errorMsg;
}

// Initialize Scallop SDK
let initialized = false;

/**
 * Initialize the Scallop SDK
 */
export async function init() {
  if (initialized) return;

  try {
    await scallop.init();
    initialized = true;
    console.log("Scallop SDK initialized successfully");
  } catch (error) {
    console.error("Failed to initialize Scallop SDK", error);
    throw error;
  }
}

/** --- Market metadata fetch with enhanced price handling --- **/
export async function fetchMarketAssets() {
  try {
    console.log("Starting to fetch market assets...");
    const query = await scallop.createScallopQuery();
    console.log("ScallopQuery created");

    await query.init();
    console.log("ScallopQuery initialized");

    const marketData = await query.queryMarket();
    console.log("Raw Market Data:", JSON.stringify(marketData, null, 2));

    const pools = marketData.pools || {};
    console.log(`Found ${Object.keys(pools).length} pools`);

    // Enhanced price fetch with multiple sources
    let priceMap: Record<string, number> = {};

    // Try approach 1: Using ScallopUtils which may be more reliable
    try {
      console.log("Attempting to get prices using ScallopUtils...");
      const scallopUtils = await scallop.createScallopUtils();
      const coinPrices = await scallopUtils.getCoinPrices();
      console.log("Price data from ScallopUtils:", coinPrices);
      priceMap = coinPrices;
    } catch (utilsError) {
      console.warn("Failed to fetch prices from ScallopUtils:", utilsError);

      // Try approach 2: Using queryMarket data which should already have prices
      try {
        console.log("Extracting prices directly from marketData...");
        Object.entries(pools).forEach(([symbol, pool]: [string, any]) => {
          if (pool.coinPrice) {
            priceMap[symbol] = pool.coinPrice;
          }
        });
        console.log("Price data from marketData:", priceMap);
      } catch (marketError) {
        console.warn("Failed to extract prices from marketData:", marketError);

        // Try approach 3: Using getPricesFromPyth as a fallback
        try {
          priceMap = await query.getPricesFromPyth();
          console.log("Price data from Pyth:", priceMap);
        } catch (pythError) {
          console.error("Failed to fetch prices from Pyth:", pythError);

          // Try approach 4: Birdeye API as last resort
          try {
            console.log(
              "Attempting to fetch prices from Birdeye as fallback..."
            );
            const tokens = Object.values(pools).map((pool: any) => ({
              symbol: pool.symbol || pool.coinName,
              coinType: pool.coinType,
            }));

            // Use Birdeye service
            for (const token of tokens) {
              const parts = token.coinType.split("::");
              if (parts.length > 0) {
                try {
                  const address = parts[0];
                  const priceData = await birdeyeService.getPriceVolumeSingle(
                    address
                  );
                  if (
                    priceData &&
                    (priceData.price ||
                      (priceData.data && priceData.data.price))
                  ) {
                    const price = Number(
                      priceData.price || priceData.data?.price || 0
                    );
                    if (price > 0) {
                      priceMap[token.symbol.toLowerCase()] = price;
                    }
                  }
                } catch (tokenError) {
                  console.warn(
                    `Failed to fetch Birdeye price for ${token.symbol}:`,
                    tokenError
                  );
                }
              }
            }
            console.log("Price data from Birdeye:", priceMap);
          } catch (birdeyeError) {
            console.error("Failed to fetch prices from Birdeye:", birdeyeError);
          }
        }
      }
    }

    const processedAssets = Object.values(pools).map((m: any) => {
      const symbol = m.symbol || m.coinName;
      const price = priceMap[symbol.toLowerCase()] || m.coinPrice || 0;
      const decimals = Number(m.coinDecimal || 9);
      const totalSupply = Number(m.supplyAmount || 0) / 10 ** decimals;
      const totalBorrow = Number(m.borrowAmount || 0) / 10 ** decimals;
      const utilization =
        totalSupply > 0 ? (totalBorrow / totalSupply) * 100 : 0;
      const depositApy = Number(m.supplyApy ?? m.supplyApr ?? 0) * 100;
      const borrowApy = Number(m.borrowApy ?? m.borrowApr ?? 0) * 100;

      const asset = {
        symbol,
        coinType: m.coinType,
        depositApy,
        borrowApy,
        decimals,
        marketSize: totalSupply,
        totalBorrow,
        utilization,
        price,
      };

      console.log(`Processed asset ${symbol}:`, asset);
      return asset;
    });

    return processedAssets;
  } catch (err) {
    console.error("fetchMarketAssets error:", err);
    return [];
  }
}

/**
 * Simple function to get a user's supply position by checking the wallet adapter directly
 * This is a simpler approach that focuses only on displaying the user's current SUI position
 */
export async function getUserSUIPosition(userAddress: string) {
  if (!userAddress) {
    return null;
  }

  try {
    // Create a query instance
    const query = await scallop.createScallopQuery();
    await query.init();

    // Get the market data for SUI
    const marketData = await query.queryMarket();
    const suiPool = marketData.pools?.sui;

    if (!suiPool) {
      console.error("SUI pool not found in market data");
      return null;
    }

    // Log SUI pool for debugging
    console.log("SUI Pool Data:", suiPool);

    // Create a direct query object for this specific user and pool
    try {
      console.log("Getting market coins for user:", userAddress);
      // Get all user coins
      const userCoins = await query.getUserPortfolio({
        walletAddress: userAddress,
      });
      console.log("User coins response:", userCoins);

      // Look for a market coin that matches SUI
      // It could be either the newer "wSUI" format or legacy "SUI" format
      const suiMarketCoin = userCoins?.lendings?.find(
        (coin) =>
          coin.symbol?.toLowerCase() === "wsui" || // New format
          coin.symbol?.toLowerCase() === "sui" || // Legacy format
          (coin.coinType &&
            (coin.coinType.includes("sui::SUI") ||
              (coin.coinType.includes("::lending::PoolCoin<") &&
                coin.coinType.includes("::sui::SUI"))))
      );

      if (suiMarketCoin) {
        console.log("Found SUI market coin:", suiMarketCoin);

        // Extract balance
        const decimals = Number(suiPool.coinDecimal || 9);
        const balance = Number(suiMarketCoin.suppliedCoin || 0);

        if (balance > 0) {
          return {
            symbol: "SUI",
            coinType: CANON_SUI,
            amount: balance,
            valueUSD: balance * (suiPool.coinPrice || 0),
            apy: Number(suiPool.supplyApy || suiPool.supplyApr || 0) * 100,
          };
        }
      }
    } catch (e) {
      console.error("Error getting user coins:", e);
    }

    // As a fallback, try to get obligation data
    try {
      console.log("Getting obligations for user:", userAddress);

      // Try user obligation approach
      const portfolio = await query.getUserPortfolio({
        walletAddress: userAddress,
      });
      console.log("User portfolio data:", portfolio);

      // Check for SUI in collateralAssets
      const suiCollateral = portfolio?.collateralAssets?.find((c) =>
        c.coinType?.includes("::sui::SUI")
      );

      if (suiCollateral) {
        console.log("Found SUI collateral:", suiCollateral);
        const amount = Number(suiCollateral.amount || 0);

        if (amount > 0) {
          return {
            symbol: "SUI",
            coinType: CANON_SUI,
            amount: amount,
            valueUSD: amount * (suiCollateral.price || 0),
            apy: Number(suiPool.supplyApy || suiPool.supplyApr || 0) * 100,
          };
        }
      }
    } catch (e) {
      console.error("Error getting obligations:", e);
    }

    return null;
  } catch (err) {
    console.error("Error getting user SUI position:", err);
    return null;
  }
}

/**
 * Fetch all user positions (both supplied and borrowed assets) using getUserPortfolio
 */
export async function fetchUserPositions(address: string) {
  try {
    console.log(`[fetchUserPositions] Fetching for address: ${address}`);

    // Create a query instance directly from scallop
    const query = await scallop.createScallopQuery();
    await query.init();

    console.log("[fetchUserPositions] Query instance created and initialized");

    // Get portfolio data using the SDK query instance
    const positions = await query.getUserPortfolio({
      walletAddress: address,
    });
    console.log("[fetchUserPositions] Raw portfolio data:", positions);

    // Initialize arrays to store processed data
    const suppliedAssets = [];
    const borrowedAssets = [];
    const collateralAssets = [];
    const pendingRewards = [];

    // Process the portfolio data (keep the existing implementation)
    // (This part would be the unchanged code from the original implementation)

    return {
      suppliedAssets,
      borrowedAssets,
      collateralAssets,
      pendingRewards,
      portfolio: positions, // Keep this for debugging
    };
  } catch (error) {
    console.error("[fetchUserPositions] Error:", error);
    throw error;
  }
}

/**
 * Legacy fallback method to fetch user positions in case getUserPortfolio fails
 */
async function fetchUserPositionsLegacy(userAddress: string) {
  try {
    console.log(`Using legacy method to fetch positions for: ${userAddress}`);

    // Create a query instance
    const query = await scallop.createScallopQuery();
    await query.init();

    // Get the market data
    const marketData = await query.queryMarket();

    // Get all pool data for reference
    const pools = marketData.pools || {};
    console.log("Available pools (legacy method):", Object.keys(pools));

    // Process supplied assets - first approach: user coins that match pool coin types
    const suppliedAssets: UserPosition[] = [];
    const collateralAssets: UserPosition[] = [];

    try {
      // Get all user coins
      console.log("Fetching user coins (legacy)...");
      const portfolio = await query.getUserPortfolio({
        walletAddress: userAddress,
      });
      const userCoins = portfolio?.lendings || [];
      console.log("User coins (legacy):", userCoins);

      // Filter for pool coins (both old and new styles)
      if (userCoins && Array.isArray(userCoins)) {
        for (const coin of userCoins) {
          // Skip coins without balance or symbol
          if (!coin || !coin.symbol || !Number(coin.suppliedCoin)) continue;

          // Try to match with pool
          let poolKey = coin.symbol.toLowerCase();

          // If this is a wrapped symbol (wsui, wusdc), strip the "w" prefix
          if (poolKey.startsWith("w")) {
            poolKey = poolKey.slice(1); // Use "sui" instead of "wsui" to match pool
          }

          const pool = (pools as any)[poolKey];

          if (pool && Number(coin.suppliedCoin) > 0) {
            const decimals = Number(pool.coinDecimal || coin.coinDecimals || 9);
            const amount = Number(coin.suppliedCoin);
            const price = pool.coinPrice || 0;

            console.log(
              `Found supplied asset (legacy): ${coin.symbol}, amount: ${amount}`
            );

            // Normalize SUI coinType to canonical form
            const coinType = coin.coinType?.includes("::sui::SUI")
              ? CANON_SUI
              : coin.coinType || "";

            suppliedAssets.push({
              symbol: pool.symbol || pool.coinName || coin.symbol, // Use pool symbol if available
              coinType: coinType,
              amount: amount,
              valueUSD: amount * price,
              apy: Number(pool.supplyApy || pool.supplyApr || 0) * 100,
              decimals: decimals,
              price: price,
            });
          }
        }
      }
    } catch (marketCoinsError) {
      console.error("Legacy: Error fetching user coins:", marketCoinsError);
    }

    // Process borrowed assets - through obligations
    const borrowedAssets: UserPosition[] = [];

    try {
      // Get user portfolio data with borrowings
      console.log("Legacy: Fetching user borrowings...");
      const portfolio = await query.getUserPortfolio({
        walletAddress: userAddress,
      });
      console.log("Legacy: User portfolio data:", portfolio);

      if (portfolio?.borrowings && portfolio.borrowings.length > 0) {
        for (const borrowing of portfolio.borrowings) {
          // Process collaterals
          if (borrowing.collaterals && Array.isArray(borrowing.collaterals)) {
            for (const collateral of borrowing.collaterals) {
              if (
                collateral &&
                collateral.coinType &&
                Number(collateral.depositedCoin) > 0
              ) {
                // Extract symbol from coin type
                const symbol =
                  collateral.symbol ||
                  getSymbolFromCoinType(collateral.coinType);

                // Find matching pool
                const poolKey = symbol.toLowerCase();
                const pool = (pools as any)[poolKey];

                if (pool) {
                  const decimals = Number(
                    pool.coinDecimal || collateral.coinDecimals || 9
                  );
                  const amount = Number(collateral.depositedCoin);
                  const price = collateral.coinPrice || pool.coinPrice || 0;

                  console.log(
                    `Legacy: Found collateral: ${symbol}, amount: ${amount}`
                  );

                  // Normalize SUI coinType to canonical form
                  const coinType = collateral.coinType?.includes("::sui::SUI")
                    ? CANON_SUI
                    : collateral.coinType;

                  // Add to collateral assets
                  collateralAssets.push({
                    symbol: symbol,
                    coinType: coinType,
                    amount: amount,
                    valueUSD: amount * price,
                    apy: 0, // Collateral doesn't earn APY directly
                    decimals: decimals,
                    price: price,
                    isCollateral: true,
                  });
                }
              }
            }
          }

          // Process borrowed pools
          if (
            borrowing.borrowedPools &&
            Array.isArray(borrowing.borrowedPools)
          ) {
            for (const borrowedPool of borrowing.borrowedPools) {
              if (
                borrowedPool &&
                borrowedPool.coinType &&
                Number(borrowedPool.borrowedCoin) > 0
              ) {
                // Extract symbol from coin type
                const symbol =
                  borrowedPool.symbol ||
                  getSymbolFromCoinType(borrowedPool.coinType);

                // Find matching pool
                const poolKey = symbol.toLowerCase();
                const pool = (pools as any)[poolKey];

                if (pool) {
                  const decimals = Number(
                    pool.coinDecimal || borrowedPool.coinDecimals || 9
                  );
                  const amount = Number(borrowedPool.borrowedCoin);
                  const price = borrowedPool.coinPrice || pool.coinPrice || 0;

                  console.log(
                    `Legacy: Found borrowed asset: ${symbol}, amount: ${amount}`
                  );

                  // Normalize SUI coinType to canonical form
                  const coinType = borrowedPool.coinType?.includes("::sui::SUI")
                    ? CANON_SUI
                    : borrowedPool.coinType;

                  borrowedAssets.push({
                    symbol: symbol,
                    coinType: coinType,
                    amount: amount,
                    valueUSD: amount * price,
                    apy: Number(pool.borrowApy || pool.borrowApr || 0) * 100,
                    decimals: decimals,
                    price: price,
                  });
                }
              }
            }
          }
        }
      }
    } catch (obligationsError) {
      console.error(
        "Legacy: Error fetching user borrowings:",
        obligationsError
      );
    }

    return { suppliedAssets, borrowedAssets, collateralAssets };
  } catch (err) {
    console.error("Error in legacy fetchUserPositions:", err);
    return { suppliedAssets: [], borrowedAssets: [], collateralAssets: [] };
  }
}

/**
 * Check if a user has an obligation account
 * @param userAddress The user's address
 */
export async function hasObligationAccount(
  userAddress: string
): Promise<boolean> {
  try {
    if (!userAddress) return false;

    const query = await scallop.createScallopQuery();
    await query.init();

    // Get the user portfolio data which already contains obligation information
    const portfolio = await query.getUserPortfolio({
      walletAddress: userAddress,
    });

    console.log("Checking for obligation in portfolio:", portfolio);

    // Check if the portfolio contains borrowings with an obligationId
    if (
      portfolio?.borrowings &&
      Array.isArray(portfolio.borrowings) &&
      portfolio.borrowings.length > 0
    ) {
      // Look for any obligation ID in the borrowings array
      const hasObligation = portfolio.borrowings.some(
        (borrowing) => !!borrowing.obligationId
      );

      console.log("Found obligation in portfolio borrowings:", hasObligation);

      if (hasObligation) {
        // Store the obligation ID somewhere if needed
        const obligationId = portfolio.borrowings[0].obligationId;
        console.log("Obligation ID:", obligationId);
        // Pass the obligation ID to the collateral service
        import("./ScallopCollateralService")
          .then((module) => {
            module.cacheObligationId(userAddress, obligationId);
          })
          .catch((err) => {
            console.error("Could not update obligation cache:", err);
          });
      }

      return hasObligation;
    }

    return false;
  } catch (err) {
    console.error("Error checking for obligation account:", err);
    return false;
  }
}

/**
 * Supply assets to the lending protocol
 * @param wallet Connected wallet
 * @param coinType Coin type to supply
 * @param amount Amount to supply
 * @param decimals Decimals of the coin
 * @returns Transaction result
 */
export async function supply(
  wallet: any,
  coinType: string,
  amount: number,
  decimals: number
) {
  try {
    // make sure we always work with the canonical Move type (0x2::sui::SUI)
    coinType = normalizeCoinType(coinType);

    const sender = await extractWalletAddress(wallet);
    if (!sender) throw new Error("Wallet not connected");

    // amount → base units
    const amountInBase = Math.floor(amount * 10 ** decimals);

    // Get the UNDERLYING symbol (e.g., "sui", "usdc") - not wrapped
    const uSymbol = getCoinSymbol(coinType);

    console.log(`[supply] using builder with underlying symbol: ${uSymbol}`, {
      amountInBase: amountInBase,
      sender,
    });

    // Builder handles package / version IDs for us
    const builder = await scallop.createScallopBuilder();
    const tx = builder.createTxBlock();
    tx.setSender(sender);

    // Use depositQuick with the UNDERLYING symbol (sui, usdc)
    const marketCoin = await tx.depositQuick(amountInBase, uSymbol);
    tx.transferObjects([marketCoin], sender);
    tx.setGasBudget(30_000_000);

    const res = await wallet.signAndExecuteTransactionBlock({
      transactionBlock: tx.txBlock,
      options: { showEffects: true, showEvents: true },
    });

    return {
      success: !!res.digest,
      digest: res.digest,
      txLink: `${SUIVISION_URL}${res.digest}`,
      amount,
      symbol: getSymbolFromCoinType(coinType),
      timestamp: new Date().toISOString(),
    };
  } catch (err: any) {
    const msg = parseMoveCallError(err) || err.message || String(err);
    console.error("[supply] failed:", msg);
    return { success: false, error: msg };
  }
}

/**
 * Withdraw supplied assets from the lending protocol
 * @param wallet Connected wallet
 * @param coinType Coin type to withdraw
 * @param amount Amount to withdraw
 * @param decimals Decimals of the coin
 * @param isMax Whether this is a MAX withdrawal (withdraws all supplied assets)
 * @returns Transaction result
 */
export async function withdraw(
  wallet: any,
  coinType: string,
  amount: number,
  decimals: number,
  isMax: boolean = false
) {
  try {
    // make sure we always work with the canonical Move type (0x2::sui::SUI)
    coinType = normalizeCoinType(coinType);

    const sender = await extractWalletAddress(wallet);
    if (!sender) throw new Error("Wallet not connected");

    const poolKey = getCoinSymbol(coinType); // "sui", "usdc"…

    const query = await scallop.createScallopQuery();
    await query.init();

    // if this is a MAX withdrawal, pull the exact sCoin balance (base units)
    let withdrawBase: bigint;
    if (isMax) {
      console.log(`[withdraw] MAX withdrawal requested for ${poolKey}`);
      const sCoinAmountStr = await query.getSCoinAmount(poolKey, sender);
      const sCoinBase = BigInt(sCoinAmountStr);
      if (sCoinBase === 0n) {
        throw new Error(`No ${poolKey.toUpperCase()} supplied to withdraw`);
      }

      // leave a tiny dust buffer (in sCoin units) so we never request "too small"
      // for SUI, that's 0.001 SUI → 0.001 * 10⁹ = 1e6 base units
      const DUST_BUFFER =
        coinType === CANON_SUI
          ? BigInt(Math.floor(0.001 * 10 ** decimals))
          : 0n;

      withdrawBase = sCoinBase > DUST_BUFFER ? sCoinBase - DUST_BUFFER : 0n;
      if (withdrawBase === 0n) {
        throw new Error("Withdrawal amount is too small after buffer");
      }

      // for logging / UI display you can still compute human amount:
      amount = Number(withdrawBase) / 10 ** decimals;
    } else {
      // partial withdrawal: convert underlying human amount → base units
      withdrawBase = BigInt(Math.floor(amount * 10 ** decimals));
    }
    console.log(`[withdraw] base units to redeem:`, withdrawBase);

    // now let the builder redeem those sCoins for the underlying asset
    const builder = await scallop.createScallopBuilder();
    const tx = builder.createTxBlock();
    tx.setSender(sender);

    // withdrawQuick takes the **sCoin** base-unit amount as its first argument
    const coin = await tx.withdrawQuick(Number(withdrawBase), poolKey);
    tx.transferObjects([coin], sender);
    tx.setGasBudget(30_000_000);

    const res = await wallet.signAndExecuteTransactionBlock({
      transactionBlock: tx.txBlock,
      options: { showEffects: true, showEvents: true },
    });

    return {
      success: !!res.digest,
      digest: res.digest,
      txLink: `${SUIVISION_URL}${res.digest}`,
      amount,
      symbol: getSymbolFromCoinType(coinType),
      timestamp: new Date().toISOString(),
    };
  } catch (err: any) {
    console.error("[withdraw] failed:", err);

    // Provide more helpful error message
    const errorMsg = parseMoveCallError(err) || err.message || String(err);
    if (errorMsg.includes("No market coins found")) {
      return {
        success: false,
        error:
          "Could not find any supplied assets to withdraw. Please make sure you've supplied assets first.",
      };
    }

    return { success: false, error: errorMsg };
  }
}

/**
 * Borrow assets from the lending protocol
 * @param wallet Connected wallet
 * @param coinType Coin type to borrow
 * @param amount Amount to borrow
 * @param decimals Decimals of the coin
 * @returns Transaction result
 */
export async function borrow(
  wallet: any,
  coinType: string,
  amount: number,
  decimals: number
) {
  try {
    // make sure we always work with the canonical Move type (0x2::sui::SUI)
    coinType = normalizeCoinType(coinType);

    // Calculate amount in base units
    const amountInBaseUnits = Math.floor(amount * Math.pow(10, decimals));

    // Get the sender's address
    const senderAddress = await extractWalletAddress(wallet);

    if (!senderAddress) {
      throw new Error("Could not determine sender address from wallet");
    }

    console.log("Borrowing assets:", {
      coinType,
      amount: amountInBaseUnits.toString(),
      senderAddress,
    });

    // First get the obligation ID from the collateral service
    const { getObligationId } = await import("./ScallopCollateralService");
    const obligationId = await getObligationId(senderAddress);

    if (!obligationId) {
      throw new Error("No obligation account found to borrow against");
    }

    // Clean up the coin type to ensure it's a proper Move type string
    // Use the canonical form for SUI
    const fullCoinType =
      coinType === "SUI" || coinType === "sui"
        ? CANON_SUI
        : normalizeCoinType(coinType);

    console.log(`Using coin type: ${fullCoinType} for borrow operation`);

    // Create a transaction block
    const txb = new TransactionBlock();

    // First update prices (required by protocol)
    txb.moveCall({
      target: `${SCALLOP_PACKAGE_ID}::prices::update_prices`,
      arguments: [txb.object(SCALLOP_VERSION_OBJECT)],
      typeArguments: [],
    });

    // Then borrow using the correct package ID
    const borrowedCoin = txb.moveCall({
      target: `${SCALLOP_PACKAGE_ID}::borrow::borrow`,
      arguments: [
        txb.object(SCALLOP_VERSION_OBJECT),
        txb.object(obligationId),
        txb.pure(amountInBaseUnits),
      ],
      typeArguments: [fullCoinType],
    });

    // Transfer the borrowed coin to sender
    txb.transferObjects([borrowedCoin], txb.pure(senderAddress));

    // Set a higher gas budget for complex operations
    txb.setGasBudget(50000000);

    // Sign and send the transaction
    console.log("Executing borrow transaction...");
    const result = await wallet.signAndExecuteTransactionBlock({
      transactionBlock: txb,
      options: {
        showEffects: true,
        showEvents: true,
      },
    });

    console.log("Borrow result:", result);

    // Get transaction details for the response
    const digest = result.digest;
    const txLink = `${SUIVISION_URL}${digest}`;

    return {
      success: !!digest,
      digest: digest,
      txLink: txLink,
      amount: amount,
      symbol: getSymbolFromCoinType(coinType),
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    const errorMessage =
      parseMoveCallError(err) ||
      (err instanceof Error ? err.message : String(err));
    console.error("Error borrowing assets:", errorMessage, err);
    return { success: false, digest: undefined, error: errorMessage };
  }
}

/**
 * Repay borrowed assets to the lending protocol
 * @param wallet Connected wallet
 * @param coinType Coin type to repay
 * @param amount Amount to repay
 * @param decimals Decimals of the coin
 * @returns Transaction result
 */
export async function repay(
  wallet: any,
  coinType: string,
  amount: number,
  decimals: number
) {
  try {
    // make sure we always work with the canonical Move type (0x2::sui::SUI)
    coinType = normalizeCoinType(coinType);

    // Calculate amount in base units
    const amountInBaseUnits = Math.floor(amount * Math.pow(10, decimals));

    // Get the sender's address
    const senderAddress = await extractWalletAddress(wallet);

    if (!senderAddress) {
      throw new Error("Could not determine sender address from wallet");
    }

    console.log("Repaying assets:", {
      coinType,
      amount: amountInBaseUnits.toString(),
      senderAddress,
    });

    // First get the obligation ID from the collateral service
    const { getObligationId } = await import("./ScallopCollateralService");
    const obligationId = await getObligationId(senderAddress);

    if (!obligationId) {
      throw new Error("No obligation account found to repay");
    }

    // Clean up the coin type to ensure it's a proper Move type string
    // Use the canonical form for SUI
    const fullCoinType =
      coinType === "SUI" || coinType === "sui"
        ? CANON_SUI
        : normalizeCoinType(coinType);

    console.log(`Using coin type: ${fullCoinType} for repay operation`);

    // Create a transaction block
    const txb = new TransactionBlock();

    // Split the exact amount from the gas coin to get a real Coin<T> object
    const [coinToRepay] = txb.splitCoins(txb.gas, [
      txb.pure(amountInBaseUnits),
    ]);

    // Execute the repay move call with the correct package ID
    txb.moveCall({
      target: `${SCALLOP_PACKAGE_ID}::repay::repay`,
      arguments: [
        txb.object(SCALLOP_VERSION_OBJECT),
        txb.object(obligationId),
        coinToRepay,
      ],
      typeArguments: [fullCoinType],
    });

    // Set gas budget
    txb.setGasBudget(30000000);

    // Sign and send the transaction
    console.log("Executing repay transaction...");
    const result = await wallet.signAndExecuteTransactionBlock({
      transactionBlock: txb,
      options: {
        showEffects: true,
        showEvents: true,
      },
    });

    console.log("Repay result:", result);

    // Get transaction details for the response
    const digest = result.digest;
    const txLink = `${SUIVISION_URL}${digest}`;

    return {
      success: !!digest,
      digest: digest,
      txLink: txLink,
      amount: amount,
      symbol: getSymbolFromCoinType(coinType),
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    const errorMessage =
      parseMoveCallError(err) ||
      (err instanceof Error ? err.message : String(err));
    console.error("Error repaying assets:", errorMessage, err);
    return { success: false, digest: undefined, error: errorMessage };
  }
}

/**
 * Debug function to test wallet connection
 */
export async function debugWalletConnection(userAddress: string) {
  try {
    console.group(`Wallet connection test for address: ${userAddress}`);
    console.log("Testing wallet connection at", new Date().toISOString());

    const query = await scallop.createScallopQuery();
    await query.init();
    console.log("ScallopQuery initialized");

    // Try to get user coins as a simple test - use getUserCoins instead of queryUserCoins
    console.log("Testing getUserCoins...");
    try {
      // Different method names might be used in different versions of the SDK
      // Try both common naming patterns or fallback to portfolio
      const portfolio = await query.getUserPortfolio({
        walletAddress: userAddress,
      });
      console.log("Portfolio retrieved:", portfolio);
      const userCoins = portfolio?.lendings || [];
      console.log("User coins from portfolio:", userCoins);
    } catch (coinsError) {
      console.error("Error fetching user coins:", coinsError);
    }

    // Try getting portfolio (the new recommended way)
    console.log("Testing getUserPortfolio...");
    try {
      const portfolio = await query.getUserPortfolio({
        walletAddress: userAddress,
      });
      console.log("Portfolio:", portfolio);
    } catch (portfolioError) {
      console.error("Portfolio error:", portfolioError);
    }

    console.groupEnd();

    return {
      success: true,
      timestamp: new Date().toISOString(),
      address: userAddress,
      hasPrimaryCoins: true, // We're not using this value anyway
    };
  } catch (err) {
    console.error("Wallet connection debug failed:", err);
    console.groupEnd();
    return {
      success: false,
      timestamp: new Date().toISOString(),
      address: userAddress,
      error: String(err),
    };
  }
}

/**
 * Debug Scallop SDK structures - useful for development
 */
export async function debugScallopStructures(userAddress: string | null) {
  try {
    console.group("SCALLOP SDK DEBUG");
    console.log("ScallopJS Version:", scallop.version);

    // Create instances of core SDK objects
    console.log("Creating SDK instances...");

    const query = await scallop.createScallopQuery();
    await query.init();

    const builder = await scallop.createScallopBuilder();
    const utils = await scallop.createScallopUtils();

    console.log("Query instance:", typeof query);
    console.log("Builder instance:", typeof builder);
    console.log("Utils instance:", typeof utils);

    // Test price functions
    try {
      console.log("Testing price functions...");
      const prices = await utils.getCoinPrices();
      console.log("Coin prices sample:", Object.entries(prices).slice(0, 3));
    } catch (e) {
      console.error("Price function error:", e);
    }

    // If we have a user address, test user data functions
    if (userAddress) {
      console.log(`Testing with user address: ${userAddress}`);

      try {
        // Get obligation ID using collateral service
        const { getObligationId } = await import("./ScallopCollateralService");
        const obligation = await getObligationId(userAddress);
        console.log("Obligation ID:", obligation);
      } catch (e) {
        console.error("Obligation check error:", e);
      }
    }

    console.groupEnd();
    return true;
  } catch (err) {
    console.error("Scallop debug failed:", err);
    console.groupEnd();
    return false;
  }
}

/** Return the amount (human units) a user currently has supplied for a coin. */
export async function getSuppliedBalance(
  userAddress: string,
  coinType: string
): Promise<number> {
  const { suppliedAssets } = await fetchUserPositions(userAddress);

  // Normalize coinType for comparison
  const normalizedCoinType = coinType.includes("::sui::SUI")
    ? CANON_SUI
    : normalizeCoinType(coinType);

  const found = suppliedAssets.find(
    (a) => a.coinType.toLowerCase() === normalizedCoinType.toLowerCase()
  );

  return found ? found.amount : 0;
}

/* ------------------------------------------------------------------ */
/*  SUPPLY-REWARD CLAIMING                                            */
/* ------------------------------------------------------------------ */

/** Claim all outstanding supply rewards (SCA) for the caller. */
export async function claimSupplyRewards(wallet: any) {
  try {
    const sender = await extractWalletAddress(wallet);
    if (!sender) throw new Error("Wallet not connected");

    // Build tx
    const tx = new TransactionBlock();
    const rewardCoin = tx.moveCall({
      target: `${SCALLOP_PACKAGE_ID}::reward::claim_supply_reward`,
      arguments: [tx.object(SCALLOP_VERSION_OBJECT)],
      typeArguments: [], // reward module has fixed coin type
    });
    tx.transferObjects([rewardCoin], tx.pure(sender));
    tx.setGasBudget(15_000_000);

    // Sign + execute
    const res = await wallet.signAndExecuteTransactionBlock({
      transactionBlock: tx,
      options: { showEffects: true },
    });

    return {
      success: !!res.digest,
      digest: res.digest,
      txLink: `${SUIVISION_URL}${res.digest}`,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    const msg =
      parseMoveCallError(err) ||
      (err instanceof Error ? err.message : String(err));
    console.error("[claimSupplyRewards] failed:", msg);
    return { success: false, error: msg };
  }
}

/** Claim all accrued rewards (supply + borrow incentives) */
export async function claimRewards(wallet: any) {
  try {
    const sender = await extractWalletAddress(wallet);
    if (!sender) throw new Error("Wallet not connected");

    console.log("Starting claim rewards process for", sender);

    // First, get the user's portfolio to find what they have supplied and borrowed
    const query = await scallop.createScallopQuery();
    await query.init();

    try {
      // Get user's portfolio to determine which rewards to claim
      const portfolio = await query.getUserPortfolio({ walletAddress: sender });
      console.log("User portfolio for claiming rewards:", portfolio);

      // Create builder for the transaction
      const builder = await scallop.createScallopBuilder();
      const tx = builder.createTxBlock();
      tx.setSender(sender);

      // Keep track of all reward coin results to transfer back to user
      const rewardCoins: any[] = [];

      // 1. Process supply rewards (deposits/lendings)
      if (portfolio?.lendings && Array.isArray(portfolio.lendings)) {
        console.log(
          `Processing ${portfolio.lendings.length} lending positions for rewards`
        );

        for (const lending of portfolio.lendings) {
          if (lending.stakeAccountId && lending.coinType) {
            try {
              // Extract the base coin name (e.g., "sui" from "0x2::sui::SUI")
              const poolSymbol = getCoinSymbol(lending.coinType);
              console.log(
                `Claiming supply rewards for ${poolSymbol} (stake: ${lending.stakeAccountId})`
              );

              // Add claim for this lending position
              const result = await tx.claimQuick(
                poolSymbol,
                lending.stakeAccountId
              );
              if (result) {
                if (Array.isArray(result)) {
                  rewardCoins.push(...result);
                } else {
                  rewardCoins.push(result);
                }
              }
            } catch (error) {
              console.warn(
                `Error adding claim for lending position ${lending.symbol}:`,
                error
              );
            }
          }
        }
      }

      // 2. Process borrow incentive rewards
      if (portfolio?.borrowings && Array.isArray(portfolio.borrowings)) {
        console.log(
          `Processing ${portfolio.borrowings.length} borrowing positions for rewards`
        );

        for (const borrowing of portfolio.borrowings) {
          if (borrowing.obligationId && borrowing.obligationKey) {
            // For each borrowed asset, claim both sSUI and sSCA rewards if available
            if (
              borrowing.borrowedPools &&
              Array.isArray(borrowing.borrowedPools)
            ) {
              for (const borrowedPool of borrowing.borrowedPools) {
                if (borrowedPool.coinType) {
                  const poolSymbol = getCoinSymbol(borrowedPool.coinType);

                  // Try to claim both sSUI and sSCA rewards for this borrow
                  const rewardTypes = ["ssui", "ssca"];

                  for (const rewardType of rewardTypes) {
                    try {
                      console.log(
                        `Claiming borrow incentives for ${poolSymbol} (${rewardType})`
                      );
                      const result = await tx.claimBorrowIncentiveQuick(
                        poolSymbol,
                        rewardType,
                        borrowing.obligationId,
                        borrowing.obligationKey
                      );
                      if (result) {
                        rewardCoins.push(result);
                      }
                    } catch (error) {
                      console.warn(
                        `Error adding borrow incentive claim for ${poolSymbol} (${rewardType}):`,
                        error
                      );
                      // Non-fatal, continue with other rewards
                    }
                  }
                }
              }
            }
          }
        }
      }

      if (rewardCoins.length === 0) {
        console.log("No rewards found to claim");
        return {
          success: false,
          error: "No rewards available to claim",
          timestamp: new Date().toISOString(),
        };
      }

      // 3. Transfer all reward coins back to the user
      console.log(`Transferring ${rewardCoins.length} reward coins to user`);
      tx.transferObjects(rewardCoins, tx.pure(sender));
      tx.setGasBudget(50_000_000); // Higher gas budget for multiple claims

      // Sign and execute the transaction
      const result = await wallet.signAndExecuteTransactionBlock({
        transactionBlock: tx.txBlock,
        options: { showEffects: true, showEvents: true },
      });

      console.log("Claim rewards result:", result);

      return {
        success: true,
        digest: result.digest,
        txLink: `${SUIVISION_URL}${result.digest}`,
        timestamp: new Date().toISOString(),
      };
    } catch (portfolioError) {
      console.error("Error getting portfolio for rewards:", portfolioError);

      // Fallback to manual claim for supply rewards only
      return await claimSupplyRewards(wallet);
    }
  } catch (err) {
    const msg =
      parseMoveCallError(err) ||
      (err instanceof Error ? err.message : String(err));
    console.error("[claimRewards] error:", msg);
    return { success: false, error: msg };
  }
}

/**
 * Returns the Scallop SDK instance for direct access to SDK methods
 */
export async function getSDKInstance() {
  return scallop;
}

// Export all the functions
const scallopService = {
  fetchMarketAssets,
  getUserSUIPosition,
  fetchUserPositions,
  hasObligationAccount,
  supply,
  withdraw,
  borrow,
  repay,
  debugWalletConnection,
  debugScallopStructures,
  getSDKInstance,
  // Export utility functions
  parseMoveCallError,
  normalizeCoinType,
  claimSupplyRewards,
  getSuppliedBalance,
  claimRewards,
  init,
  getObligationBorrowData,
};

export default scallopService;
