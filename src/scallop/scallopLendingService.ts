// src/scallop/scallopLendingService.ts
// Last Updated: 2025-06-05 23:17:46 UTC by jake1318
// Fixed implementation with proper pure parameter handling

import { Scallop } from "@scallop-io/sui-scallop-sdk";
import { Transaction } from "@mysten/sui/transactions";
import { bcs } from "@mysten/sui/bcs";

// Constants
const SCALLOP_ADDRESS_ID = "67c44a103fe1b8c454eb9699"; // Mainnet package ID
const NETWORK = "mainnet";
export const SUIVISION_URL = "https://suivision.xyz/txblock/";

// Initialize Scallop SDK
const scallop = new Scallop({
  addressId: SCALLOP_ADDRESS_ID,
  networkType: NETWORK,
});

// Cache for obligations and market prices
const obligationCache: Record<string, string> = {};
const marketPriceCache: Record<string, { price: number; timestamp: Date }> = {};

// Helper to get sender address from wallet
function getSender(wallet: any): string {
  if (wallet?.address) return wallet.address;
  if (wallet?.account?.address) return wallet.account.address;
  if (typeof wallet?.getAddress === "function") {
    try {
      return wallet.getAddress();
    } catch (e) {}
  }
  throw new Error("Wallet does not have a valid address property.");
}

// Helper for decimal conversions
function toBaseUnits(amount: number, decimals: number): number {
  return Math.floor(amount * Math.pow(10, decimals));
}

/**
 * Retrieves or creates the user's obligation ID
 */
async function getOrCreateObligationId(wallet: any): Promise<string | null> {
  try {
    const sender = getSender(wallet);

    // Check cache first
    if (obligationCache[sender]) {
      console.log(
        `Using cached obligation ID for ${sender}: ${obligationCache[sender]}`
      );
      return obligationCache[sender];
    }

    // Query for obligations
    console.log(`Fetching obligation ID for wallet: ${sender}`);
    const query = await scallop.createScallopQuery();
    await query.init();

    try {
      // Method 1: Get obligations directly
      const obligations = await query.getObligations();
      if (obligations && obligations.length > 0) {
        const obligation = obligations[0];
        console.log(`Found obligation: ID=${obligation.id}`);
        obligationCache[sender] = obligation.id;
        return obligation.id;
      }
    } catch (e) {
      console.warn("Failed to get obligations directly:", e);
    }

    try {
      // Method 2: Check portfolio
      const portfolio = await query.getUserPortfolio({ walletAddress: sender });
      if (
        portfolio?.borrowings?.length &&
        portfolio.borrowings[0]?.obligationId
      ) {
        const obligationId = portfolio.borrowings[0].obligationId;
        console.log(`Found obligation ID in portfolio: ${obligationId}`);
        obligationCache[sender] = obligationId;
        return obligationId;
      }
    } catch (e) {
      console.warn("Failed to get portfolio:", e);
    }

    console.log("No obligation found - will be created during transaction");
    return null;
  } catch (error) {
    console.error("Error getting obligation ID:", error);
    return null;
  }
}

/**
 * Cache market prices for subsequent use
 */
async function updateMarketPriceCache() {
  try {
    console.log("Updating market prices cache...");
    const query = await scallop.createScallopQuery();
    await query.init();
    const markets = await query.queryMarket();

    // Store prices in the cache with a timestamp
    Object.entries(markets.pools || markets).forEach(
      ([key, market]: [string, any]) => {
        if (market.coinName && market.coinPrice) {
          marketPriceCache[market.coinName] = {
            price: market.coinPrice,
            timestamp: new Date(),
          };
          console.log(
            `Cached price for ${market.coinName}: $${market.coinPrice}`
          );
        }
      }
    );
  } catch (error) {
    console.error("Error caching market prices:", error);
  }
}

const scallopLendingService = {
  /**
   * Check if user has an obligation account
   */
  async hasObligation(wallet: any): Promise<boolean> {
    const obligationId = await getOrCreateObligationId(wallet);
    return obligationId !== null;
  },

  /**
   * Get the user's specific obligation ID
   */
  async getObligationId(wallet: any): Promise<string | null> {
    return getOrCreateObligationId(wallet);
  },

  /**
   * Clear cached obligation ID for a wallet
   */
  clearObligationCache(wallet: any): void {
    const sender = getSender(wallet);
    if (obligationCache[sender]) {
      console.log(`Clearing obligation cache for ${sender}`);
      delete obligationCache[sender];
    }
  },

  /**
   * Supply assets to the Scallop protocol
   */
  async supply(wallet: any, coin: string, amount: number, decimals: number) {
    try {
      const sender = getSender(wallet);
      const builder = await scallop.createScallopBuilder();
      const tx = builder.createTxBlock();
      tx.setSender(sender);

      const amt = toBaseUnits(amount, decimals);
      const marketCoin = await tx.depositQuick(amt, coin.toLowerCase());
      tx.transferObjects([marketCoin], sender);

      tx.txBlock.setGasBudget(30000000);
      console.log(`Supplying ${amount} ${coin} (${amt} base units)`);

      const res = await wallet.signAndExecuteTransactionBlock({
        transactionBlock: tx.txBlock,
        options: { showEffects: true, showEvents: true },
      });

      console.log(`Supply transaction completed: ${res.digest}`);

      // Update market price cache
      updateMarketPriceCache();

      return {
        success: !!res.digest,
        digest: res.digest,
        txLink: `${SUIVISION_URL}${res.digest}`,
        amount,
        symbol: coin.toUpperCase(),
        timestamp: new Date().toISOString(),
      };
    } catch (e: any) {
      console.error(`Supply ${coin} failed:`, e);
      return {
        success: false,
        error: e.message || String(e),
        timestamp: new Date().toISOString(),
      };
    }
  },

  /**
   * Add collateral to a lending position
   */
  async addCollateral(
    wallet: any,
    coin: string,
    amount: number,
    decimals: number
  ) {
    try {
      const sender = getSender(wallet);
      const obligationId = await getOrCreateObligationId(wallet);
      const builder = await scallop.createScallopBuilder();
      const tx = builder.createTxBlock();
      tx.setSender(sender);

      // Update prices first - this is included in addCollateralQuick but let's be explicit
      try {
        console.log(`Updating prices for: sui, ${coin.toLowerCase()}`);
        await tx.updateAssetPricesQuick([coin.toLowerCase(), "sui"]);
      } catch (e) {
        console.warn("Price update may fail, continuing with transaction:", e);
      }

      const amt = toBaseUnits(amount, decimals);

      // If we have an existing obligation, use it explicitly
      if (obligationId) {
        console.log(
          `Using existing obligation ID for addCollateral: ${obligationId}`
        );
        await tx.addCollateralQuick(amt, coin.toLowerCase(), obligationId);
      } else {
        // Let SDK handle creating a new obligation
        console.log("No existing obligation, creating one");
        await tx.addCollateralQuick(amt, coin.toLowerCase());

        // Clear cache to force refresh after this action
        this.clearObligationCache(wallet);
      }

      tx.txBlock.setGasBudget(30000000);

      console.log(`Adding ${amount} ${coin} as collateral (${amt} base units)`);
      const res = await wallet.signAndExecuteTransactionBlock({
        transactionBlock: tx.txBlock,
        options: { showEffects: true, showEvents: true },
      });

      console.log(`Add collateral transaction completed: ${res.digest}`);

      // Update market price cache
      updateMarketPriceCache();

      return {
        success: !!res.digest,
        digest: res.digest,
        txLink: `${SUIVISION_URL}${res.digest}`,
        amount,
        symbol: coin.toUpperCase(),
        timestamp: new Date().toISOString(),
      };
    } catch (e: any) {
      console.error(`Add collateral ${coin} failed:`, e);
      return {
        success: false,
        error: e.message || String(e),
        timestamp: new Date().toISOString(),
      };
    }
  },

  /**
   * Borrow assets - simplified version that skips price updates
   * This approach aligns with the documentation and avoids price feed dependency
   */
  async borrow(wallet: any, coin: string, amount: number, decimals: number) {
    try {
      const sender = getSender(wallet);
      console.log(`Starting simple borrow process for ${sender}`);

      // First try the simplest approach
      const obligationId = await getOrCreateObligationId(wallet);

      // Create transaction builder
      const builder = await scallop.createScallopBuilder();
      const tx = builder.createTxBlock();
      tx.setSender(sender);

      // Calculate base units amount
      const amt = toBaseUnits(amount, decimals);
      console.log(`Borrowing ${amount} ${coin} (${amt} base units)`);

      // Skip price updates since they're failing
      // Just use the borrowQuick method directly
      let borrowedCoin;

      if (obligationId) {
        console.log(`Using explicit obligation ID: ${obligationId}`);
        // Use the SDK's borrowQuick with obligation ID
        borrowedCoin = await tx.borrowQuick(
          amt,
          coin.toLowerCase(),
          obligationId
        );
      } else {
        console.log(`No obligation ID found, letting SDK create one`);
        // Let the SDK create a new obligation
        borrowedCoin = await tx.borrowQuick(amt, coin.toLowerCase());
        // Clear obligation cache after this operation
        this.clearObligationCache(wallet);
      }

      // Transfer the borrowed coin to the sender
      tx.transferObjects([borrowedCoin], sender);

      // Set a higher gas budget for safety
      tx.txBlock.setGasBudget(100000000); // 0.1 SUI

      console.log("Executing simplified borrow transaction...");
      const res = await wallet.signAndExecuteTransactionBlock({
        transactionBlock: tx.txBlock,
        options: { showEffects: true, showEvents: true },
      });

      console.log("Borrow transaction completed:", res.digest);

      if (res.effects?.status?.status === "success") {
        console.log("✅ Borrow transaction succeeded");

        // Update market price cache after successful transaction
        await updateMarketPriceCache();

        return {
          success: true,
          digest: res.digest,
          txLink: `${SUIVISION_URL}${res.digest}`,
          amount,
          symbol: coin.toUpperCase(),
          timestamp: new Date().toISOString(),
        };
      } else {
        console.warn("⚠️ Borrow transaction failed:", res.effects?.status);

        // Check for health factor error
        if (String(res.effects?.status?.error).includes("1281")) {
          return {
            success: false,
            error: "Health factor too low. Add more collateral or borrow less.",
            timestamp: new Date().toISOString(),
          };
        }

        return {
          success: false,
          error:
            "Transaction failed on chain. This may be due to price feed issues.",
          timestamp: new Date().toISOString(),
        };
      }
    } catch (e: any) {
      console.error(`Borrow failed:`, e);
      return {
        success: false,
        error: e.message || String(e),
        timestamp: new Date().toISOString(),
      };
    }
  },

  /**
   * Repay borrowed assets
   */
  async repay(wallet: any, coin: string, amount: number, decimals: number) {
    try {
      const sender = getSender(wallet);
      const obligationId = await getOrCreateObligationId(wallet);

      if (!obligationId) {
        return {
          success: false,
          error: "No obligation found. Nothing to repay.",
          timestamp: new Date().toISOString(),
        };
      }

      const builder = await scallop.createScallopBuilder();
      const tx = builder.createTxBlock();
      tx.setSender(sender);

      const amt = toBaseUnits(amount, decimals);
      console.log(
        `Repaying ${amount} ${coin} (${amt} base units) for obligation ${obligationId}`
      );

      // Explicitly use the known obligation ID
      await tx.repayQuick(amt, coin.toLowerCase(), obligationId);

      tx.txBlock.setGasBudget(30000000);

      const res = await wallet.signAndExecuteTransactionBlock({
        transactionBlock: tx.txBlock,
        options: { showEffects: true, showEvents: true },
      });

      console.log(`Repay transaction completed: ${res.digest}`);

      // Update market price cache
      updateMarketPriceCache();

      return {
        success: !!res.digest,
        digest: res.digest,
        txLink: `${SUIVISION_URL}${res.digest}`,
        amount,
        symbol: coin.toUpperCase(),
        timestamp: new Date().toISOString(),
      };
    } catch (e: any) {
      console.error(`Repay ${coin} failed:`, e);
      return {
        success: false,
        error: e.message || String(e),
        timestamp: new Date().toISOString(),
      };
    }
  },

  /**
   * Withdraw assets from the Scallop protocol
   */
  async withdraw(wallet: any, coin: string, amount: number, decimals: number) {
    try {
      const sender = getSender(wallet);
      const builder = await scallop.createScallopBuilder();
      const tx = builder.createTxBlock();
      tx.setSender(sender);

      const amt = toBaseUnits(amount, decimals);
      console.log(`Withdrawing ${amount} ${coin} (${amt} base units)`);
      const outCoin = await tx.withdrawQuick(amt, coin.toLowerCase());
      tx.transferObjects([outCoin], sender);

      tx.txBlock.setGasBudget(30000000);

      const res = await wallet.signAndExecuteTransactionBlock({
        transactionBlock: tx.txBlock,
        options: { showEffects: true, showEvents: true },
      });

      console.log(`Withdraw transaction completed: ${res.digest}`);

      return {
        success: !!res.digest,
        digest: res.digest,
        txLink: `${SUIVISION_URL}${res.digest}`,
        amount,
        symbol: coin.toUpperCase(),
        timestamp: new Date().toISOString(),
      };
    } catch (e: any) {
      console.error(`Withdraw ${coin} failed:`, e);
      return {
        success: false,
        error: e.message || String(e),
        timestamp: new Date().toISOString(),
      };
    }
  },

  // Get user's lending portfolio data
  async getUserPortfolio(walletAddress: string) {
    try {
      const query = await scallop.createScallopQuery();
      await query.init();
      const portfolio = await query.getUserPortfolio({ walletAddress });

      // Update cache if we found an obligation
      if (
        portfolio?.borrowings?.length &&
        portfolio.borrowings[0]?.obligationId
      ) {
        obligationCache[walletAddress] = portfolio.borrowings[0].obligationId;
        console.log(
          `Cached obligation ID from portfolio: ${portfolio.borrowings[0].obligationId}`
        );
      }

      return portfolio;
    } catch (error) {
      console.error("Error getting user portfolio:", error);
      throw error;
    }
  },

  // Get market data for all Scallop assets
  async getMarketData() {
    try {
      const query = await scallop.createScallopQuery();
      await query.init();
      const markets = await query.queryMarket();

      // Update price cache
      Object.entries(markets.pools || markets).forEach(
        ([key, market]: [string, any]) => {
          if (market.coinName && market.coinPrice) {
            marketPriceCache[market.coinName] = {
              price: market.coinPrice,
              timestamp: new Date(),
            };
          }
        }
      );

      return markets?.pools || markets;
    } catch (error) {
      console.error("Error getting market data:", error);
      throw error;
    }
  },

  // Check account health factor
  async checkHealthFactor(walletAddress: string) {
    try {
      const query = await scallop.createScallopQuery();
      await query.init();
      const portfolio = await query.getUserPortfolio({ walletAddress });

      // Update cache if we found an obligation
      if (
        portfolio?.borrowings?.length &&
        portfolio.borrowings[0]?.obligationId
      ) {
        obligationCache[walletAddress] = portfolio.borrowings[0].obligationId;
      }

      return portfolio?.borrowings?.length > 0
        ? {
            healthFactor: portfolio.borrowings[0].healthFactor,
            hasObligation: true,
            obligationId: portfolio.borrowings[0].obligationId,
          }
        : {
            healthFactor: null,
            hasObligation: false,
            obligationId: null,
          };
    } catch (error) {
      console.error("Error checking health factor:", error);
      throw error;
    }
  },

  // Get SDK configuration info
  getSdkInfo() {
    try {
      return {
        networkType: NETWORK,
        addressId: SCALLOP_ADDRESS_ID,
        sdkVersion: "2.2.0",
        suiVersion: "1.28.2",
        timestamp: new Date().toISOString(),
        cachedPrices: Object.keys(marketPriceCache).length > 0,
      };
    } catch (error) {
      console.error("Error getting SDK info:", error);
      return {
        error: String(error),
        timestamp: new Date().toISOString(),
      };
    }
  },

  // Get cached price info for UI display
  getCachedPriceInfo() {
    const priceInfo: Record<string, { price: number; age: string }> = {};

    Object.entries(marketPriceCache).forEach(([coin, data]) => {
      const ageMs = new Date().getTime() - data.timestamp.getTime();
      const ageMinutes = Math.floor(ageMs / (1000 * 60));

      priceInfo[coin] = {
        price: data.price,
        age:
          ageMinutes < 1
            ? "just now"
            : `${ageMinutes} minute${ageMinutes === 1 ? "" : "s"} ago`,
      };
    });

    return {
      hasCachedPrices: Object.keys(marketPriceCache).length > 0,
      priceData: priceInfo,
      timestamp: new Date().toISOString(),
    };
  },
};

// Initialize price cache
updateMarketPriceCache();

export default scallopLendingService;
