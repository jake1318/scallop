// src/services/suilendService.ts

import { SuiClient } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import { SuilendClient } from "@suilend/sdk/client";
import {
  initializeSuilend,
  InitializeSuilendReturn,
  createObligationIfNoneExists,
  sendObligationToUser,
} from "@suilend/sdk";
import {
  SUILEND_PACKAGE_ID,
  LENDING_MARKET_ID,
  LENDING_MARKET_TYPE,
  MAIN_POOL_PACKAGE_ID,
  PYTH_PACKAGE_ID,
  PYTH_STATE_ID,
} from "../constants/suilendConstants";

// Use local proxy to avoid CORS issues
const PROXY_URL = "http://localhost:3001/sui";

// Configure SUI client to use our proxy with added timeout
const suiClient = new SuiClient({
  url: PROXY_URL,
  // Add some custom options if needed
  options: {
    timeoutInMillis: 30000, // 30 seconds timeout
  },
});

// Use shared cache for lendingMarket data to reduce API calls
let lendingMarketCache: any = null;
let lastCacheTime = 0;
const CACHE_DURATION = 600000; // 10 minutes - longer cache to reduce API calls

// Keep track of initialization to prevent concurrent init calls
let clientPromise: Promise<SuilendClient> | null = null;
let initializationInProgress = false;

// Log the configuration details
console.log("=== Suilend Configuration ===");
console.log(`Suilend package ID: ${SUILEND_PACKAGE_ID}`);
console.log(`MAIN_POOL type package ID: ${MAIN_POOL_PACKAGE_ID}`);
console.log(`LendingMarket object ID: ${LENDING_MARKET_ID}`);
console.log(`LendingMarket type: ${LENDING_MARKET_TYPE}`);
console.log(`Pyth Network package ID: ${PYTH_PACKAGE_ID}`);
console.log(`Pyth Network state ID: ${PYTH_STATE_ID}`);
console.log("===========================");

/**
 * Initialize & cache the SuilendClient with better error handling
 *
 * Using the VERIFIED constants for Suilend mainnet:
 * - LENDING_MARKET_ID: The object ID of the main LendingMarket
 * - LENDING_MARKET_TYPE: The exact type string including the type argument
 */
async function getSuilendClient(): Promise<SuilendClient> {
  if (initializationInProgress) {
    console.log("SuilendClient initialization already in progress, waiting...");
    // If initialization is in progress, wait for it to complete
    if (clientPromise) {
      try {
        return await clientPromise;
      } catch (error) {
        console.error("Error waiting for SuilendClient initialization:", error);
        // Continue and try to initialize again
      }
    }
  }

  if (!clientPromise) {
    try {
      initializationInProgress = true;
      console.log("Initializing SuilendClient...");

      // Initialize with the correct LendingMarket ID and exact type
      clientPromise = SuilendClient.initialize(
        LENDING_MARKET_ID,
        LENDING_MARKET_TYPE,
        suiClient
      );

      // Add timeout to initialization
      const timeoutPromise = new Promise<SuilendClient>((_, reject) => {
        setTimeout(
          () => reject(new Error("SuilendClient initialization timeout")),
          30000
        );
      });

      // Race between the initialization and timeout
      clientPromise = Promise.race([clientPromise, timeoutPromise]);

      // Handle initialization result
      const client = await clientPromise;
      console.log("✅ SuilendClient initialized successfully");
      return client;
    } catch (error) {
      console.error("❌ Error initializing SuilendClient:", error);
      console.error(
        "Check that LENDING_MARKET_TYPE matches on-chain object exactly"
      );
      console.error(
        "Try restarting your development server after updating constants"
      );
      clientPromise = null; // Reset for retry
      throw error;
    } finally {
      initializationInProgress = false;
    }
  }

  try {
    return await clientPromise;
  } catch (error) {
    console.error("Error retrieving SuilendClient:", error);
    clientPromise = null; // Reset for retry
    throw error;
  }
}

/**
 * Fetch raw market + user-data via the SDK with enhanced error handling.
 */
export async function fetchLendingData(
  userAddress: string
): Promise<InitializeSuilendReturn> {
  try {
    const client = await getSuilendClient();

    // Set a timeout for the SDK call
    const timeoutPromise = new Promise<InitializeSuilendReturn>((_, reject) => {
      setTimeout(() => reject(new Error("initializeSuilend timeout")), 30000);
    });

    console.log(`Fetching lending data for user: ${userAddress}`);

    // Race between the SDK call and timeout
    const dataPromise = initializeSuilend(suiClient, client, userAddress);
    const data = await Promise.race([dataPromise, timeoutPromise]);

    // Update the shared cache if we got valid market data
    if (data && data.lendingMarket) {
      lendingMarketCache = data.lendingMarket;
      lastCacheTime = Date.now();
      console.log("✅ Successfully fetched lending market data");
    }

    return data;
  } catch (error) {
    console.error("❌ Error in fetchLendingData:", error);

    // Return a minimal structure to prevent downstream errors
    return {
      suilendClient: await getSuilendClient().catch(() => null as any),
      lendingMarket: lendingMarketCache || { reserves: [] },
      reserveMap: {},
      coinMetadataMap: {},
      obligationOwnerCaps: [],
      obligations: [],
    };
  }
}

/**
 * Fetch all reserve data for Suilend's main lending market
 * With enhanced error handling
 */
export async function fetchReservesData() {
  try {
    // Use cached lendingMarket if available and recent
    const now = Date.now();
    if (lendingMarketCache && now - lastCacheTime < CACHE_DURATION) {
      console.log("Using cached lending market data");
      return lendingMarketCache.reserves || [];
    }

    const client = await getSuilendClient();

    // Use a dummy address to fetch market data (no user data needed)
    const dummyAddress = "0x0000000000000000000000000000000000000000";

    try {
      // Set a timeout for the SDK call
      const timeoutPromise = new Promise<InitializeSuilendReturn>(
        (_, reject) => {
          setTimeout(
            () => reject(new Error("initializeSuilend timeout")),
            30000
          );
        }
      );

      console.log("Fetching all reserves data from Suilend");

      // Race between the SDK call and timeout
      const dataPromise = initializeSuilend(suiClient, client, dummyAddress);
      const data = await Promise.race([dataPromise, timeoutPromise]);

      if (!data || !data.lendingMarket) {
        throw new Error("Failed to get lending market data");
      }

      // Update cache
      lendingMarketCache = data.lendingMarket;
      lastCacheTime = now;

      console.log(
        `✅ Fetched ${data.lendingMarket.reserves?.length || 0} reserves`
      );
      return data.lendingMarket.reserves || [];
    } catch (sdkError) {
      console.error("❌ SDK error in fetchReservesData:", sdkError);

      // If we have cached data, return that instead of failing
      if (lendingMarketCache && lendingMarketCache.reserves) {
        console.log("Returning cached reserves data after SDK error");
        return lendingMarketCache.reserves;
      }

      throw sdkError;
    }
  } catch (error) {
    console.error("❌ Error fetching reserves data:", error);

    // If we have cached data, return that instead of failing
    if (lendingMarketCache && lendingMarketCache.reserves) {
      console.log("Returning cached reserves data");
      return lendingMarketCache.reserves;
    }

    throw error;
  }
}

/**
 * Format reserve data into a more usable structure
 * With defensive coding to handle SDK inconsistencies
 */
export function formatReserveData(reserves: any[]) {
  // First make sure we have valid reserves array
  if (!reserves || !Array.isArray(reserves)) {
    console.error("Invalid reserves data:", reserves);
    return [];
  }

  // Default values for coin types we might encounter
  const defaultDecimals: Record<string, number> = {
    SUI: 9,
    USDC: 6,
    USDT: 6,
    BTC: 8,
    ETH: 18,
    WETH: 18,
    WSOL: 9,
    COIN: 9, // Generic default
  };

  // Keep track of symbol counts to prevent duplicates
  const symbolCounts: Record<string, number> = {};

  const formattedReserves = reserves.map((reserve, index) => {
    try {
      // Handle completely invalid reserve objects
      if (!reserve) {
        return {
          asset: `Unknown-${index}`,
          totalDeposits: 0,
          totalBorrows: 0,
          ltv: "0%",
          borrowWeight: "0",
          depositAPR: "0.00%",
          borrowAPR: "0.00%",
          raw: {},
        };
      }

      // Extract coin type with safe fallbacks
      const token = reserve.token || {};
      const coinType = token.coinType || `Unknown-${index}`;

      // Safe extraction of metadata with fallbacks
      const meta = reserve.meta || {};
      const tokenName =
        meta.name || coinType.split("::").pop() || `Asset-${index}`;
      const symbol = meta.symbol || tokenName || `COIN-${index}`;

      // Check if we've seen this symbol before
      const baseSymbol = symbol.toUpperCase();
      symbolCounts[baseSymbol] = (symbolCounts[baseSymbol] || 0) + 1;

      // Make symbol unique if we've seen it before
      const uniqueSymbol =
        symbolCounts[baseSymbol] > 1
          ? `${baseSymbol}-${symbolCounts[baseSymbol]}`
          : baseSymbol;

      // Use default decimals if undefined to prevent errors
      // This fixes the "Cannot read properties of undefined (reading 'decimals')" error
      const decimals = meta.decimals || defaultDecimals[baseSymbol] || 9;

      // Extract stats with safe fallbacks for schema variations
      const stats = reserve.stats || {};

      // Handle different field naming conventions
      const totalDepositsBaseUnits =
        stats.totalSupply ||
        stats.total_supply ||
        stats.totalDeposits ||
        stats.total_deposits ||
        0;
      const totalBorrowsBaseUnits =
        stats.totalBorrowed ||
        stats.total_borrowed ||
        stats.totalBorrows ||
        stats.total_borrows ||
        0;

      // Convert to numbers with decimal adjustment
      const totalDeposits =
        Number(totalDepositsBaseUnits) / Math.pow(10, decimals);
      const totalBorrows =
        Number(totalBorrowsBaseUnits) / Math.pow(10, decimals);

      // Handle configuration with fallbacks
      const cfg = reserve.config || {};
      const ltvRatio = cfg.loanToValue || cfg.loan_to_value || 0;
      const borrowWeight = cfg.borrowWeight || cfg.borrow_weight || 1;
      const ltvPercent = ltvRatio * 100;

      // Handle APRs with fallbacks
      const depositAPR =
        (stats.depositInterestAPR || stats.deposit_interest_apr || 0) * 100;
      const borrowAPR =
        (stats.borrowInterestAPR || stats.borrow_interest_apr || 0) * 100;

      // Format borrow weight for display
      const formattedBorrowWeight =
        borrowWeight === Infinity || borrowWeight === 0
          ? "∞"
          : borrowWeight.toString();

      return {
        asset: uniqueSymbol, // Using unique symbol to avoid React key errors
        totalDeposits,
        totalBorrows,
        ltv: `${ltvPercent.toFixed(0)}%`,
        borrowWeight: formattedBorrowWeight,
        depositAPR: `${depositAPR.toFixed(2)}%`,
        borrowAPR: `${borrowAPR.toFixed(2)}%`,
        raw: reserve,
      };
    } catch (error) {
      console.error("Error formatting reserve data for index", index, error);
      return {
        asset: `Error-${index}`,
        totalDeposits: 0,
        totalBorrows: 0,
        ltv: "0%",
        borrowWeight: "0",
        depositAPR: "0.00%",
        borrowAPR: "0.00%",
        raw: reserve,
      };
    }
  });

  console.log(`✅ Formatted ${formattedReserves.length} reserves`);
  return formattedReserves;
}

// --- Transaction helpers (unchanged) ---

export async function deposit(
  address: string,
  coinType: string,
  amountBaseUnits: bigint,
  tx: Transaction
): Promise<void> {
  const client = await getSuilendClient();
  const { obligationOwnerCapId, didCreate } = createObligationIfNoneExists(
    client,
    tx,
    null
  );
  await client.depositIntoObligation(
    address,
    coinType,
    amountBaseUnits,
    tx,
    obligationOwnerCapId
  );
  if (didCreate) {
    await sendObligationToUser(obligationOwnerCapId, address, tx);
  }
}

export async function withdraw(
  address: string,
  coinType: string,
  amountBaseUnits: bigint,
  tx: Transaction
): Promise<void> {
  const client = await getSuilendClient();
  // you may need to pass ownerCap & obligation IDs here
  await client.withdrawAndSendToUser(
    address,
    /* ownerCapId */ "",
    /* obligationId */ "",
    coinType,
    amountBaseUnits,
    tx
  );
}

export async function borrow(
  address: string,
  coinType: string,
  amountBaseUnits: bigint,
  tx: Transaction
): Promise<void> {
  const client = await getSuilendClient();
  await client.borrowAndSendToUser(
    address,
    /* ownerCapId */ "",
    /* obligationId */ "",
    coinType,
    amountBaseUnits,
    tx
  );
}

export async function repay(
  address: string,
  coinType: string,
  amountBaseUnits: bigint,
  tx: Transaction
): Promise<void> {
  const client = await getSuilendClient();
  await client.repayIntoObligation(
    address,
    /* obligationId */ "",
    coinType,
    amountBaseUnits,
    tx
  );
}
