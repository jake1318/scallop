// src/scallop/PriceFeedService.ts
// Last Updated: 2025-06-02 20:04:56 UTC by jake1318

import { Scallop } from "@scallop-io/sui-scallop-sdk";

interface CoinPrice {
  symbol: string;
  price: number;
  source: "scallop-utils" | "query-market" | "pyth" | "birdeye" | "unknown";
  timestamp: number;
}

// Constants
const BIRDEYE_API_BASE = "https://public-api.birdeye.so";
const API_RETRY_DELAY = 2500; // 2.5 seconds between retries
const PRICE_CACHE_DURATION = 60000; // 60 seconds cache validity

/**
 * Service to handle price feed data from multiple sources with fallbacks
 */
class PriceFeedService {
  private scallop: any;
  private priceCache: Map<string, CoinPrice> = new Map();
  private fetchInProgress: boolean = false;
  private lastFetchTime: number = 0;
  private birdeyeApiKey: string | null = null;

  constructor(networkType: string = "mainnet") {
    this.scallop = new Scallop({ networkType });
  }

  /**
   * Set Birdeye API key for the price feed
   */
  setBirdeyeApiKey(apiKey: string) {
    this.birdeyeApiKey = apiKey;
  }

  /**
   * Get latest price for a specific coin, using all available sources
   * with fallbacks
   */
  async getCoinPrice(symbol: string): Promise<CoinPrice | null> {
    symbol = symbol.toLowerCase();

    // Check cache first to avoid excessive API calls
    const cachedPrice = this.priceCache.get(symbol);
    const now = Date.now();

    if (cachedPrice && now - cachedPrice.timestamp < PRICE_CACHE_DURATION) {
      return cachedPrice;
    }

    // Refresh all prices
    if (!this.fetchInProgress && now - this.lastFetchTime > API_RETRY_DELAY) {
      this.fetchInProgress = true;
      this.refreshAllPrices().finally(() => {
        this.fetchInProgress = false;
        this.lastFetchTime = Date.now();
      });
    }

    // If we still don't have the price, return null
    return this.priceCache.get(symbol) || null;
  }

  /**
   * Get all coin prices at once, useful for UI display
   */
  async getAllPrices(): Promise<Record<string, CoinPrice>> {
    // Wait for any in-progress fetch to complete
    if (this.fetchInProgress) {
      await new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          if (!this.fetchInProgress) {
            clearInterval(checkInterval);
            resolve(true);
          }
        }, 100);
      });
    }

    // If cache is stale, refresh prices
    const now = Date.now();
    if (now - this.lastFetchTime > PRICE_CACHE_DURATION) {
      await this.refreshAllPrices();
    }

    // Convert cache to record
    const result: Record<string, CoinPrice> = {};
    this.priceCache.forEach((price, key) => {
      result[key] = price;
    });
    return result;
  }

  /**
   * Refresh all prices using multiple sources with fallbacks
   */
  async refreshAllPrices(): Promise<void> {
    this.fetchInProgress = true;

    try {
      // Try ScallopUtils first (on-chain, most accurate)
      await this.fetchFromScallopUtils();
    } catch (e1) {
      console.log("ScallopUtils price fetch failed:", e1);

      try {
        // Fallback to on-chain queryMarket
        await this.fetchFromQueryMarket();
      } catch (e2) {
        console.log("QueryMarket price fetch failed:", e2);

        try {
          // Fallback to Pyth
          await this.fetchFromPyth();
        } catch (e3) {
          console.log("Pyth price fetch failed:", e3);

          try {
            // Last-resort: Birdeye API
            await this.fetchFromBirdeye();
          } catch (e4) {
            console.log("Birdeye price fetch failed:", e4);
            // All methods failed
          }
        }
      }
    } finally {
      this.fetchInProgress = false;
      this.lastFetchTime = Date.now();
    }
  }

  /**
   * Get prices from Scallop Utils
   */
  private async fetchFromScallopUtils(): Promise<void> {
    const scallopUtils = await this.scallop.createScallopUtils();
    const priceData = await scallopUtils.getCoinPrices();

    // Update cache with new prices
    Object.entries(priceData).forEach(([symbol, price]) => {
      this.priceCache.set(symbol.toLowerCase(), {
        symbol: symbol.toLowerCase(),
        price: Number(price),
        source: "scallop-utils",
        timestamp: Date.now(),
      });
    });

    console.log(
      "Prices fetched from ScallopUtils:",
      Object.keys(priceData).length
    );
  }

  /**
   * Get prices from Scallop Query Market
   */
  private async fetchFromQueryMarket(): Promise<void> {
    const query = await this.scallop.createScallopQuery();
    await query.init();

    const marketData = await query.getMarketsData();

    // Update cache with market prices
    Object.values(marketData).forEach((market: any) => {
      if (market.coinPrice && market.coinName) {
        this.priceCache.set(market.coinName.toLowerCase(), {
          symbol: market.coinName.toLowerCase(),
          price: Number(market.coinPrice),
          source: "query-market",
          timestamp: Date.now(),
        });
      }
    });

    console.log(
      "Prices fetched from QueryMarket:",
      Object.keys(marketData).length
    );
  }

  /**
   * Get prices from Pyth via SDK
   */
  private async fetchFromPyth(): Promise<void> {
    const query = await this.scallop.createScallopQuery();
    await query.init();

    const pythPrices = await query.getPricesFromPyth();

    // Update cache with Pyth prices
    Object.entries(pythPrices).forEach(([symbol, price]) => {
      this.priceCache.set(symbol.toLowerCase(), {
        symbol: symbol.toLowerCase(),
        price: Number(price),
        source: "pyth",
        timestamp: Date.now(),
      });
    });

    console.log("Prices fetched from Pyth:", Object.keys(pythPrices).length);
  }

  /**
   * Get prices from Birdeye API
   */
  private async fetchFromBirdeye(): Promise<void> {
    if (!this.birdeyeApiKey) {
      console.warn("Birdeye API key not set, skipping");
      return;
    }

    // List of main tokens to fetch from Birdeye
    const tokens = [
      "0x2::sui::SUI",
      "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
      "0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::USDT",
    ];

    const pricesMap: Record<string, number> = {};

    // Fetch prices for each token
    for (const token of tokens) {
      try {
        const response = await fetch(
          `${BIRDEYE_API_BASE}/public/price?token=${token}`,
          {
            headers: {
              "x-api-key": this.birdeyeApiKey,
            },
          }
        );

        if (!response.ok) {
          console.warn(`Birdeye API error for ${token}: ${response.status}`);
          continue;
        }

        const data = await response.json();
        if (data && data.data && data.data.price) {
          // Extract symbol from token address
          const parts = token.split("::");
          const symbol = parts.length >= 3 ? parts[2].toLowerCase() : "";

          if (symbol) {
            pricesMap[symbol] = data.data.price;

            // Update cache
            this.priceCache.set(symbol, {
              symbol,
              price: data.data.price,
              source: "birdeye",
              timestamp: Date.now(),
            });
          }
        }
      } catch (error) {
        console.error(`Failed to fetch ${token} price from Birdeye:`, error);
      }
    }

    console.log("Prices fetched from Birdeye:", Object.keys(pricesMap).length);
  }

  /**
   * Force a refresh of price data
   */
  async forcePriceRefresh(): Promise<boolean> {
    try {
      await this.refreshAllPrices();
      return true;
    } catch (error) {
      console.error("Failed to refresh prices:", error);
      return false;
    }
  }
}

// Create and export singleton instance
const priceFeedService = new PriceFeedService();
export default priceFeedService;
