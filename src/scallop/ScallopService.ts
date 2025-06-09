// ScallopService.ts
// Last Updated: 2025-06-01 19:55:32 UTC by jake1318

import { SuiClient } from "@mysten/sui.js/client";
import { Scallop } from "@scallop-io/sui-scallop-sdk";
import { birdeyeService } from "../services/birdeyeService";

/** --- Core config --- **/
export const SUI_MAINNET = "http://localhost:5001/sui";
export const SCALLOP_ADDRESS_ID = "67c44a103fe1b8c454eb9699";
export const client = new SuiClient({ url: SUI_MAINNET });

export const scallop = new Scallop({
  addressId: SCALLOP_ADDRESS_ID,
  networkType: "mainnet",
  suiProvider: client,
});

// SuiVision base URL for transaction viewing
export const SUIVISION_URL = "https://suivision.xyz/txblock/";

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
      // Try to get market coins directly
      const marketCoins = await query.queryUserMarketCoins(userAddress);
      console.log("Market coins response:", marketCoins);

      // Look for SUI market coin
      const suiMarketCoin = marketCoins?.find(
        (coin) =>
          coin.symbol?.toLowerCase() === "sui" ||
          (coin.coinType && coin.coinType.includes("sui::SUI"))
      );

      if (suiMarketCoin) {
        console.log("Found SUI market coin:", suiMarketCoin);

        // Extract balance
        const decimals = Number(suiPool.coinDecimal || 9);
        const balance = Number(suiMarketCoin.balance || 0) / 10 ** decimals;

        if (balance > 0) {
          return {
            symbol: "SUI",
            coinType:
              "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI",
            amount: balance,
            valueUSD: balance * (suiPool.coinPrice || 0),
            apy: Number(suiPool.supplyApy || suiPool.supplyApr || 0) * 100,
          };
        }
      }
    } catch (e) {
      console.error("Error getting market coins:", e);
    }

    // As a fallback, try to get obligation data
    try {
      console.log("Getting obligations for user:", userAddress);

      // Try user obligation approach
      const userMarketData = await query.queryUserMarket(userAddress);
      console.log("User market data:", userMarketData);

      if (userMarketData?.obligations?.[0]?.collaterals) {
        const suiCollateral = userMarketData.obligations[0].collaterals.find(
          (c) => c.coinType?.includes("::sui::SUI")
        );

        if (suiCollateral) {
          console.log("Found SUI collateral:", suiCollateral);

          const decimals = Number(
            suiCollateral.coinDecimal || suiPool.coinDecimal || 9
          );
          const amount = Number(suiCollateral.amount || 0) / 10 ** decimals;

          if (amount > 0) {
            return {
              symbol: "SUI",
              coinType:
                "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI",
              amount: amount,
              valueUSD: amount * (suiPool.coinPrice || 0),
              apy: Number(suiPool.supplyApy || suiPool.supplyApr || 0) * 100,
            };
          }
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
export async function fetchUserPositions(userAddress: string) {
  if (!userAddress || userAddress.trim() === "") {
    console.warn(
      "Invalid or empty userAddress provided to fetchUserPositions:",
      userAddress
    );
    return { suppliedAssets: [], borrowedAssets: [] };
  }

  try {
    console.log(
      `Fetching positions for wallet address: ${userAddress} at ${new Date().toISOString()}`
    );

    // Create a query instance
    const query = await scallop.createScallopQuery();
    await query.init();

    // Use getUserPortfolio to fetch all user positions in one call
    try {
      console.log("Calling getUserPortfolio...");
      const portfolio = await query.getUserPortfolio({
        walletAddress: userAddress,
      });
      console.log("User portfolio response:", portfolio);

      if (portfolio) {
        const suppliedAssets: UserPosition[] = [];
        const borrowedAssets: UserPosition[] = [];
        const collateralAssets: UserPosition[] = [];

        // Process lending positions (supplied assets)
        if (portfolio.lendings && Array.isArray(portfolio.lendings)) {
          console.log(
            `Found ${portfolio.lendings.length} lending positions in portfolio`
          );

          for (const lending of portfolio.lendings) {
            // Only add supplies with positive amounts
            if (
              lending &&
              lending.suppliedCoin &&
              Number(lending.suppliedCoin) > 0
            ) {
              const decimals = Number(lending.coinDecimals || 9);
              const amount = Number(lending.suppliedCoin);
              const price = Number(lending.coinPrice || 0);
              const apy =
                Number(lending.supplyApy || lending.supplyApr || 0) * 100; // Convert to percentage

              suppliedAssets.push({
                symbol: lending.symbol || lending.coinName || "Unknown",
                coinType: lending.coinType || "",
                amount: amount,
                valueUSD: amount * price,
                apy: apy,
                decimals: decimals,
                price: price,
              });

              console.log(
                `Added supplied asset: ${
                  lending.symbol || lending.coinName
                }, amount: ${amount}, value: $${amount * price}`
              );
            }
          }
        }

        // Process borrowings array which contains collateral and borrowed assets
        if (portfolio.borrowings && Array.isArray(portfolio.borrowings)) {
          console.log(
            `Found ${portfolio.borrowings.length} borrowing positions in portfolio`
          );

          // Process each borrowing item
          for (const borrowing of portfolio.borrowings) {
            // Process collaterals first
            if (borrowing.collaterals && Array.isArray(borrowing.collaterals)) {
              console.log(
                `Found ${borrowing.collaterals.length} collaterals in borrowing`
              );
              for (const collateral of borrowing.collaterals) {
                if (
                  collateral &&
                  collateral.depositedCoin &&
                  Number(collateral.depositedCoin) > 0
                ) {
                  const decimals = Number(collateral.coinDecimals || 9);
                  const amount = Number(collateral.depositedCoin);
                  const price = Number(collateral.coinPrice || 0);

                  const collateralAsset = {
                    symbol:
                      collateral.symbol || collateral.coinName || "Unknown",
                    coinType: collateral.coinType || "",
                    amount: amount,
                    valueUSD: amount * price,
                    apy: 0, // Collateral doesn't earn APY
                    decimals: decimals,
                    price: price,
                    isCollateral: true, // Mark as collateral
                  };

                  collateralAssets.push(collateralAsset);

                  console.log(
                    `Added collateral asset: ${
                      collateral.symbol || collateral.coinName
                    }, amount: ${amount}, value: $${amount * price}`
                  );
                }
              }
            }

            // Process borrowed pools if they exist
            if (
              borrowing.borrowedPools &&
              Array.isArray(borrowing.borrowedPools)
            ) {
              console.log(
                `Found ${borrowing.borrowedPools.length} borrowed pools in borrowing`
              );
              for (const borrowedPool of borrowing.borrowedPools) {
                if (
                  borrowedPool &&
                  borrowedPool.borrowedCoin &&
                  Number(borrowedPool.borrowedCoin) > 0
                ) {
                  const decimals = Number(borrowedPool.coinDecimals || 9);
                  const amount = Number(borrowedPool.borrowedCoin);
                  const price = Number(borrowedPool.coinPrice || 0);
                  const apy =
                    Number(
                      borrowedPool.borrowApy || borrowedPool.borrowApr || 0
                    ) * 100;

                  borrowedAssets.push({
                    symbol:
                      borrowedPool.symbol || borrowedPool.coinName || "Unknown",
                    coinType: borrowedPool.coinType || "",
                    amount: amount,
                    valueUSD: amount * price,
                    apy: apy,
                    decimals: decimals,
                    price: price,
                  });

                  console.log(
                    `Added borrowed asset: ${
                      borrowedPool.symbol || borrowedPool.coinName
                    }, amount: ${amount}, value: $${amount * price}`
                  );
                }
              }
            }

            // Store the obligation ID for future reference
            if (borrowing.obligationId) {
              console.log(`Found obligation ID: ${borrowing.obligationId}`);
              // You could store this in a global variable or in local storage if needed
            }
          }
        }

        // Merge supplied assets and collateral assets
        // For assets that appear in both lists, mark them as collateral
        const finalSuppliedAssets = [...suppliedAssets];

        for (const collateralAsset of collateralAssets) {
          const existingIndex = finalSuppliedAssets.findIndex(
            (asset) =>
              asset.symbol.toLowerCase() ===
              collateralAsset.symbol.toLowerCase()
          );

          if (existingIndex >= 0) {
            // Asset exists in both lists, mark as collateral
            finalSuppliedAssets[existingIndex].isCollateral = true;
          } else {
            // Asset only exists as collateral, add to list
            finalSuppliedAssets.push(collateralAsset);
          }
        }

        console.log(
          `Processed ${suppliedAssets.length} supplied assets, ${collateralAssets.length} collateral assets, and ${borrowedAssets.length} borrowed assets`
        );
        return { suppliedAssets: finalSuppliedAssets, borrowedAssets };
      } else {
        console.log("Portfolio data is empty or null");
        return { suppliedAssets: [], borrowedAssets: [] };
      }
    } catch (portfolioError) {
      console.error("Error getting portfolio:", portfolioError);

      // Fallback to older methods in case getUserPortfolio fails
      return await fetchUserPositionsLegacy(userAddress);
    }
  } catch (err) {
    console.error("Error in fetchUserPositions:", err);
    return { suppliedAssets: [], borrowedAssets: [] };
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

    // Process supplied assets - first approach: market coins
    const suppliedAssets: UserPosition[] = [];

    try {
      // Get user market coins - supplied assets
      console.log("Fetching user market coins (legacy)...");
      const userMarketCoins = await query.queryUserMarketCoins(userAddress);
      console.log("User market coins (legacy):", userMarketCoins);

      if (userMarketCoins && Array.isArray(userMarketCoins)) {
        userMarketCoins.forEach((coin) => {
          if (coin && coin.symbol && coin.balance && Number(coin.balance) > 0) {
            const poolKey = coin.symbol.toLowerCase();
            const pool = (pools as any)[poolKey];

            if (pool) {
              const decimals = Number(pool.coinDecimal || coin.decimals || 9);
              const amount = Number(coin.balance) / 10 ** decimals;
              const price = pool.coinPrice || 0;

              console.log(
                `Found supplied asset (legacy): ${coin.symbol}, amount: ${amount}`
              );

              suppliedAssets.push({
                symbol: coin.symbol,
                coinType: coin.coinType || pool.coinType || "",
                amount: amount,
                valueUSD: amount * price,
                apy: Number(pool.supplyApy || pool.supplyApr || 0) * 100,
                decimals: decimals,
                price: price,
              });
            }
          }
        });
      }
    } catch (marketCoinsError) {
      console.error(
        "Legacy: Error fetching user market coins:",
        marketCoinsError
      );
    }

    // Process borrowed assets - through obligations
    const borrowedAssets: UserPosition[] = [];

    try {
      // Get user market data including obligations
      console.log("Legacy: Fetching user market data...");
      const userMarketData = await query.queryUserMarket(userAddress);
      console.log("Legacy: User market data:", userMarketData);

      if (
        userMarketData?.obligations &&
        userMarketData.obligations.length > 0
      ) {
        const obligation = userMarketData.obligations[0]; // Usually there's only one obligation

        // Process collaterals (also supplied assets)
        if (obligation.collaterals && Array.isArray(obligation.collaterals)) {
          obligation.collaterals.forEach((collateral) => {
            if (
              collateral &&
              collateral.coinType &&
              Number(collateral.amount) > 0
            ) {
              // Extract symbol from coin type
              const symbol =
                collateral.coinSymbol ||
                getSymbolFromCoinType(collateral.coinType);

              // Check if this collateral is already recorded from market coins
              const existingSupply = suppliedAssets.find(
                (a) => a.symbol.toLowerCase() === symbol.toLowerCase()
              );

              if (!existingSupply) {
                // Find matching pool
                const poolKey = symbol.toLowerCase();
                const pool = (pools as any)[poolKey];

                if (pool) {
                  const decimals = Number(
                    pool.coinDecimal || collateral.coinDecimal || 9
                  );
                  const amount = Number(collateral.amount) / 10 ** decimals;
                  const price = pool.coinPrice || 0;

                  console.log(
                    `Legacy: Found collateral: ${symbol}, amount: ${amount}`
                  );

                  suppliedAssets.push({
                    symbol: symbol,
                    coinType: collateral.coinType,
                    amount: amount,
                    valueUSD: amount * price,
                    apy: Number(pool.supplyApy || pool.supplyApr || 0) * 100,
                    decimals: decimals,
                    price: price,
                    isCollateral: true,
                  });
                }
              } else {
                // Mark existing supply as collateral
                existingSupply.isCollateral = true;
              }
            }
          });
        }

        // Process borrows
        if (obligation.borrows && Array.isArray(obligation.borrows)) {
          obligation.borrows.forEach((borrow) => {
            if (borrow && borrow.coinType && Number(borrow.amount) > 0) {
              // Find matching pool
              const symbol =
                borrow.coinSymbol || getSymbolFromCoinType(borrow.coinType);
              const poolKey = symbol.toLowerCase();
              const pool = (pools as any)[poolKey];

              if (pool) {
                const decimals = Number(
                  pool.coinDecimal || borrow.coinDecimal || 9
                );
                const amount = Number(borrow.amount) / 10 ** decimals;
                const price = pool.coinPrice || 0;

                console.log(
                  `Legacy: Found borrowed asset: ${symbol}, amount: ${amount}`
                );

                borrowedAssets.push({
                  symbol: symbol,
                  coinType: borrow.coinType,
                  amount: amount,
                  valueUSD: amount * price,
                  apy: Number(pool.borrowApy || pool.borrowApr || 0) * 100,
                  decimals: decimals,
                  price: price,
                });
              }
            }
          });
        }
      }
    } catch (obligationsError) {
      console.error(
        "Legacy: Error fetching user obligations:",
        obligationsError
      );
    }

    return { suppliedAssets, borrowedAssets };
  } catch (err) {
    console.error("Error in legacy fetchUserPositions:", err);
    return { suppliedAssets: [], borrowedAssets: [] };
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
 * Creates an obligation account for the user, which is required for borrowing
 */
export async function createObligationAccount(signer: any) {
  try {
    // Get the sender's address
    const senderAddress = await extractWalletAddress(signer);

    if (!senderAddress) {
      throw new Error("Could not determine sender address from wallet");
    }

    console.log("Creating obligation account for:", senderAddress);

    // Create a ScallopBuilder instance
    const scallopBuilder = await scallop.createScallopBuilder();

    // Create a transaction block
    const txBlock = scallopBuilder.createTxBlock();

    // Set the sender
    txBlock.setSender(senderAddress);

    // Create the obligation account
    txBlock.openObligationEntry();

    // Set a moderate gas budget
    const txBlockToSign = txBlock.txBlock;
    txBlockToSign.setGasBudget(30000000); // 0.03 SUI

    // Sign and send the transaction
    console.log("Executing create obligation transaction...");
    const result = await signer.signAndExecuteTransactionBlock({
      transactionBlock: txBlockToSign,
      options: { showEffects: true, showEvents: true },
    });

    console.log("Create obligation result:", result);

    // Get transaction details for the response
    const digest = result.digest;
    const txLink = `${SUIVISION_URL}${digest}`;

    return {
      success: !!digest,
      digest: digest,
      txLink: txLink,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("Error creating obligation account:", errorMessage, err);
    return { success: false, digest: undefined, error: errorMessage };
  }
}

/**
 * Adds collateral to the user's obligation account
 */
export async function addCollateral(
  signer: any,
  coinType: string,
  amount: number,
  decimals: number
) {
  try {
    // Calculate amount in base units
    const amountInBaseUnits = Math.floor(amount * 10 ** decimals);

    // Get the sender's address
    const senderAddress = await extractWalletAddress(signer);

    if (!senderAddress) {
      throw new Error("Could not determine sender address from wallet");
    }

    console.log("Adding collateral:", {
      coinType,
      amount: amountInBaseUnits.toString(),
      senderAddress,
    });

    // Create a ScallopBuilder instance
    const scallopBuilder = await scallop.createScallopBuilder();

    // Create a transaction block
    const txBlock = scallopBuilder.createTxBlock();

    // Set the sender
    txBlock.setSender(senderAddress);

    // Add collateral
    await txBlock.addCollateralQuick(
      amountInBaseUnits,
      getCoinSymbol(coinType)
    );

    // Set a higher gas budget for complex operations
    const txBlockToSign = txBlock.txBlock;
    txBlockToSign.setGasBudget(30000000); // Use a higher gas budget

    // Sign and send the transaction
    console.log("Executing add collateral transaction...");
    const result = await signer.signAndExecuteTransactionBlock({
      transactionBlock: txBlockToSign,
      options: { showEffects: true, showEvents: true },
    });

    console.log("Add collateral result:", result);

    // Get transaction details for the response
    const digest = result.digest;
    const txLink = `${SUIVISION_URL}${digest}`;

    return {
      success: !!digest,
      digest: digest,
      txLink: txLink,
      amount: amount,
      symbol: getCoinSymbol(coinType).toUpperCase(),
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("Error adding collateral:", errorMessage, err);
    return { success: false, digest: undefined, error: errorMessage };
  }
}

/**
 * Removes collateral from the user's obligation account
 */
export async function removeCollateral(
  signer: any,
  coinType: string,
  amount: number,
  decimals: number
) {
  try {
    // Calculate amount in base units
    const amountInBaseUnits = Math.floor(amount * 10 ** decimals);

    // Get the sender's address
    const senderAddress = await extractWalletAddress(signer);

    if (!senderAddress) {
      throw new Error("Could not determine sender address from wallet");
    }

    console.log("Removing collateral:", {
      coinType,
      amount: amountInBaseUnits.toString(),
      senderAddress,
    });

    // Create a ScallopBuilder instance
    const scallopBuilder = await scallop.createScallopBuilder();

    // Create a transaction block
    const txBlock = scallopBuilder.createTxBlock();

    // Set the sender
    txBlock.setSender(senderAddress);

    // IMPORTANT: Update asset prices first as required by Scallop docs
    console.log("Updating asset prices before withdrawing collateral");
    await txBlock.updateAssetPricesQuick([getCoinSymbol(coinType)]);

    // Remove collateral
    const coin = await txBlock.takeCollateralQuick(
      amountInBaseUnits,
      getCoinSymbol(coinType)
    );

    // Transfer the coin back to the sender
    txBlock.transferObjects([coin], senderAddress);

    // Set a higher gas budget for complex operations
    const txBlockToSign = txBlock.txBlock;
    txBlockToSign.setGasBudget(30000000); // Use a higher gas budget

    // Sign and send the transaction
    console.log("Executing remove collateral transaction...");
    const result = await signer.signAndExecuteTransactionBlock({
      transactionBlock: txBlockToSign,
      options: { showEffects: true, showEvents: true },
    });

    console.log("Remove collateral result:", result);

    // Get transaction details for the response
    const digest = result.digest;
    const txLink = `${SUIVISION_URL}${digest}`;

    return {
      success: !!digest,
      digest: digest,
      txLink: txLink,
      amount: amount,
      symbol: getCoinSymbol(coinType).toUpperCase(),
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("Error removing collateral:", errorMessage, err);

    // Handle specific error cases
    if (
      errorMessage.includes("MoveAbort") &&
      errorMessage.includes("collateral cannot be withdrawn")
    ) {
      return {
        success: false,
        digest: undefined,
        error:
          "Cannot withdraw collateral that is securing active loans. Repay your loans first.",
      };
    }

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

    // Try to get user coins as a simple test
    console.log("Testing queryUserCoins...");
    const userCoins = await query.queryUserCoins(userAddress);
    console.log("User coins:", userCoins);

    // Try to get user market coins as another test
    console.log("Testing queryUserMarketCoins...");
    const marketCoins = await query.queryUserMarketCoins(userAddress);
    console.log("Market coins:", marketCoins);

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
      hasPrimaryCoins: userCoins && userCoins.length > 0,
      hasMarketCoins: marketCoins && marketCoins.length > 0,
      primaryCoinsCount: userCoins?.length || 0,
      marketCoinsCount: marketCoins?.length || 0,
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
 * Returns the Scallop SDK instance for direct access to SDK methods
 */
export function getScallopInstance() {
  return scallop;
}

// Export all the functions
const scallopService = {
  fetchMarketAssets,
  getUserSUIPosition,
  fetchUserPositions,
  hasObligationAccount,
  createObligationAccount,
  addCollateral,
  removeCollateral,
  debugWalletConnection,
  getScallopInstance,
};

export default scallopService;
