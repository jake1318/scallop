// src/services/birdeyeService.ts
// Last Updated: 2025-05-19 02:15:48 UTC by jake1318

import axios from "axios";

const API_BASE = "/api";
const DEFAULT_CHAIN = "sui";

export interface BirdeyeTrendingToken {
  address: string; // KEEP original case!
  symbol: string;
  name: string;
  logoURI: string;
  decimals: number;
  price: number;
  price24hChangePercent?: number;
}

export interface BirdeyeListToken {
  address: string; // KEEP original case!
  symbol: string;
  name: string;
  logoURI: string;
  decimals: number;
  v24hUSD: number;
  v24hChangePercent: number;
}

// Updated to include all possible volume field names
export interface PriceVolumeSingle {
  price?: number | string;
  volumeUSD?: number | string;
  volume24hUSD?: number | string;
  v24hUSD?: number | string;
  high24h?: number | string;
  low24h?: number | string;
  data?: {
    volumeUSD?: number | string;
    volume24hUSD?: number | string;
    volume?: number | string;
    high24h?: number | string;
    low24h?: number | string;
    price?: number | string;
  };
}

/**
 * Token metadata interface
 */
export interface TokenMetadata {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  extensions?: {
    twitter?: string;
    website?: string;
    telegram?: string | null;
  };
  logo_uri?: string;
  logoUrl?: string;
  logoURI?: string;
  logo?: string;
}

const BIRDEYE_API_KEY = "22430f5885a74d3b97e7cbd01c2140aa";
const BIRDEYE_BASE_URL = "https://public-api.birdeye.so/defi/v3";
// Updated to use the new higher rate limit (with safety margin)
const MAX_REQUESTS_PER_SECOND = 45; // Using 45 out of 50 to leave some safety margin

/**
 * Token metadata cache to avoid redundant API calls
 */
const tokenMetadataCache: Record<string, TokenMetadata> = {};

/**
 * Simple rate limiter
 */
class RateLimiter {
  private queue: (() => Promise<void>)[] = [];
  private running = false;
  private requestTimestamps: number[] = [];
  private maxRequestsPerSecond: number;

  constructor(maxRequestsPerSecond: number) {
    this.maxRequestsPerSecond = maxRequestsPerSecond;
  }

  async schedule<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          await this.waitForRateLimit();
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });

      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.running || this.queue.length === 0) return;

    this.running = true;

    while (this.queue.length > 0) {
      const task = this.queue.shift();
      if (task) {
        await task();
      }
    }

    this.running = false;
  }

  private async waitForRateLimit() {
    const now = Date.now();

    // Remove timestamps older than 1 second
    this.requestTimestamps = this.requestTimestamps.filter(
      (timestamp) => now - timestamp < 1000
    );

    if (this.requestTimestamps.length >= this.maxRequestsPerSecond) {
      // Calculate how long we need to wait
      const oldestTimestamp = this.requestTimestamps[0];
      const waitTime = 1000 - (now - oldestTimestamp);

      if (waitTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }

    // Add current timestamp to the list
    this.requestTimestamps.push(Date.now());
  }
}

// Create a rate limiter instance with the new limit
const rateLimiter = new RateLimiter(MAX_REQUESTS_PER_SECOND);

/**
 * Get token metadata from Birdeye API with rate limiting
 * Export this function so it can be imported by other services
 */
export async function getTokenMetadata(
  tokenAddress: string
): Promise<TokenMetadata | null> {
  // Check cache first
  if (tokenMetadataCache[tokenAddress]) {
    return tokenMetadataCache[tokenAddress];
  }

  return rateLimiter.schedule(async () => {
    try {
      // Encode the token address properly for the URL
      const encodedAddress = encodeURIComponent(tokenAddress);

      const response = await fetch(
        `${BIRDEYE_BASE_URL}/token/meta-data/single?address=${encodedAddress}`,
        {
          method: "GET",
          headers: {
            accept: "application/json",
            "x-chain": "sui",
            "X-API-KEY": BIRDEYE_API_KEY,
          },
        }
      );

      if (!response.ok) {
        console.warn(
          `Birdeye API error for ${tokenAddress}: ${response.status}`
        );
        return null;
      }

      const responseData = await response.json();

      if (responseData.success && responseData.data) {
        // Process and standardize the metadata format
        const metadata: TokenMetadata = {
          address: responseData.data.address,
          name: responseData.data.name,
          symbol: responseData.data.symbol,
          decimals: responseData.data.decimals,
          extensions: responseData.data.extensions || {},
          // Copy the logo_uri to all logo properties
          logo_uri: responseData.data.logo_uri || "",
          logoUrl: responseData.data.logo_uri || "",
          logoURI: responseData.data.logo_uri || "",
          logo: responseData.data.logo_uri || "",
        };

        // Cache the result
        tokenMetadataCache[tokenAddress] = metadata;
        return metadata;
      }

      return null;
    } catch (error) {
      console.error(
        `Failed to fetch metadata for token ${tokenAddress}:`,
        error
      );
      return null;
    }
  });
}

/**
 * Get metadata for multiple tokens at once in batches
 * Export this function so it can be imported by other services
 */
export async function getMultipleTokenMetadata(
  tokenAddresses: string[]
): Promise<Record<string, TokenMetadata>> {
  console.log(
    `getMultipleTokenMetadata called with ${tokenAddresses.length} addresses`
  );
  const result: Record<string, TokenMetadata> = {};
  // Updated batch size to process more tokens concurrently
  const batchSize = 15; // Increased from 5 to 15 with the higher rate limit

  // Filter out tokens we already have in cache
  const uncachedAddresses = tokenAddresses.filter(
    (addr) => !tokenMetadataCache[addr]
  );

  if (uncachedAddresses.length === 0) {
    // All tokens are already in cache
    console.log("All tokens are already in cache");
    tokenAddresses.forEach((addr) => {
      if (tokenMetadataCache[addr]) {
        result[addr] = tokenMetadataCache[addr];
      }
    });
    return result;
  }

  console.log(
    `Fetching metadata for ${uncachedAddresses.length} tokens in batches of ${batchSize}`
  );

  // Process in batches
  for (let i = 0; i < uncachedAddresses.length; i += batchSize) {
    const batch = uncachedAddresses.slice(i, i + batchSize);

    // Show progress
    console.log(
      `Processing batch ${i / batchSize + 1}/${Math.ceil(
        uncachedAddresses.length / batchSize
      )}`
    );

    // Process batch with Promise.all
    const batchResults = await Promise.all(
      batch.map(async (address) => {
        const metadata = await getTokenMetadata(address);
        if (metadata) {
          result[address] = metadata;
        }
        return { address, metadata };
      })
    );

    // Log success/failure counts
    const success = batchResults.filter((r) => r.metadata !== null).length;
    console.log(`Batch completed: ${success}/${batch.length} successful`);
  }

  // Add cached tokens to the result
  tokenAddresses.forEach((addr) => {
    if (tokenMetadataCache[addr] && !result[addr]) {
      result[addr] = tokenMetadataCache[addr];
    }
  });

  console.log(
    `Final result has metadata for ${Object.keys(result).length} tokens`
  );
  // Log some sample results for debugging
  if (Object.keys(result).length > 0) {
    const sampleAddress = Object.keys(result)[0];
    console.log(`Sample metadata for ${sampleAddress}:`, result[sampleAddress]);
  }

  return result;
}

export const birdeyeService = {
  /**
   * GET /api/token_trending
   * Returns the top trending tokens (with their current price).
   */
  async getTrendingTokens(
    chain: string = DEFAULT_CHAIN,
    limit = 20,
    offset = 0
  ): Promise<BirdeyeTrendingToken[]> {
    try {
      const resp = await axios.get(`${API_BASE}/token_trending`, {
        headers: { "x-chain": chain },
        params: { sort_by: "rank", sort_type: "asc", limit, offset },
      });
      if (!resp.data.success || !resp.data.data?.tokens) return [];

      return resp.data.data.tokens.map((t: any) => ({
        address: t.address, // ← no .toLowerCase()
        symbol: t.symbol,
        name: t.name,
        logoURI: t.logoURI || t.logo_uri || "",
        decimals: t.decimals,
        price: Number(t.price),
        price24hChangePercent: t.price24hChangePercent,
      }));
    } catch (err) {
      console.error("birdeyeService.getTrendingTokens:", err);
      return [];
    }
  },

  /**
   * GET /api/tokenlist
   * Returns the top tokens by 24h volume.
   * Note: this endpoint does not return a spot price—you can call getPriceVolumeSingle().
   */
  async getTokenList(
    chain: string = DEFAULT_CHAIN,
    limit = 50,
    offset = 0,
    min_liquidity = 100
  ): Promise<BirdeyeListToken[]> {
    try {
      const resp = await axios.get(`${API_BASE}/tokenlist`, {
        headers: { "x-chain": chain },
        params: {
          sort_by: "v24hUSD",
          sort_type: "desc",
          offset,
          limit,
          min_liquidity,
        },
      });
      if (!resp.data.success || !resp.data.data?.tokens) return [];

      return resp.data.data.tokens.map((t: any) => ({
        address: t.address, // ← no .toLowerCase()
        symbol: t.symbol,
        name: t.name,
        logoURI: t.logoURI || t.logo_uri || "",
        decimals: t.decimals,
        v24hUSD: Number(t.v24hUSD),
        v24hChangePercent: Number(t.v24hChangePercent),
      }));
    } catch (err) {
      console.error("birdeyeService.getTokenList:", err);
      return [];
    }
  },

  /**
   * GET /api/price_volume/single
   * Fetches the current spot price (and volume) for a single token.
   */
  async getPriceVolumeSingle(
    address: string,
    type: string = "24h",
    chain: string = DEFAULT_CHAIN
  ): Promise<PriceVolumeSingle | null> {
    try {
      const resp = await axios.get(`${API_BASE}/price_volume/single`, {
        headers: { "x-chain": chain },
        params: { address, type },
      });

      // Enhanced logging to debug response format
      console.log(`getPriceVolumeSingle response for ${address}:`, resp.data);

      if (!resp.data.success) {
        console.warn(`API returned failure for ${address}:`, resp.data);
        return null;
      }

      // Return the whole data object to handle different response formats
      return resp.data.data as PriceVolumeSingle;
    } catch (err) {
      console.error("birdeyeService.getPriceVolumeSingle:", err);
      return null;
    }
  },

  /**
   * GET /api/history_price
   * Returns historical price points for charting.
   */
  async getLineChartData(
    address: string,
    type: string = "1d",
    chain: string = DEFAULT_CHAIN
  ): Promise<any[]> {
    const now = Math.floor(Date.now() / 1000);
    const spanMap: Record<string, number> = {
      "1m": 3600,
      "5m": 3600 * 3,
      "15m": 3600 * 6,
      "1h": 3600 * 24,
      "1d": 3600 * 24 * 7,
      "1w": 3600 * 24 * 30,
    };
    const time_from = now - (spanMap[type] || spanMap["1d"]);

    try {
      const resp = await axios.get(`${API_BASE}/history_price`, {
        headers: { "x-chain": chain },
        params: {
          address,
          address_type: "token",
          type,
          time_from,
          time_to: now,
        },
      });
      if (!resp.data.success || !Array.isArray(resp.data.data)) return [];
      return resp.data.data;
    } catch (err) {
      console.error("birdeyeService.getLineChartData:", err);
      return [];
    }
  },

  /**
   * Get token metadata from Birdeye API
   * Method version that delegates to the standalone function
   */
  getTokenMetadata,

  /**
   * Get metadata for multiple tokens at once in batches
   * Method version that delegates to the standalone function
   */
  getMultipleTokenMetadata,
};
