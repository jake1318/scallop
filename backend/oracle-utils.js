/**
 * oracle-utils.js
 * Last updated: 2025-06-09 00:23:46 UTC by jake1318
 * Fixed object handling for Pyth price update calls with proper fallbacks
 */
const axios = require("axios");

// Cache for price feed data with TTL of 30 seconds
const priceFeedCache = {};
const PRICE_FEED_TTL = 30000; // 30 seconds

/**
 * Fetch fresh VAA and accumulator byte arrays for price updates
 * @param {string} coin - Lowercase coin symbol
 * @param {function} debugLog - Logging function
 * @returns {Promise<Array>} Array of price feed objects
 */
async function getFreshPriceFeeds(coin, debugLog) {
  const now = Date.now();
  const key = coin.toLowerCase();

  if (
    priceFeedCache[key] &&
    now - priceFeedCache[key].timestamp < PRICE_FEED_TTL
  ) {
    debugLog("ORACLE", `Using cached price feeds for ${coin}`);
    return priceFeedCache[key].data;
  }

  debugLog("ORACLE", `Fetching fresh price feeds for ${coin}...`);
  try {
    const resp = await axios.get(
      `http://localhost:5001/api/price-feeds/${key}`
    );
    if (!resp.data.success) throw new Error(resp.data.error || "Failed fetch");

    // Validate the response data structure
    const feeds = resp.data.priceFeeds || [];
    if (!Array.isArray(feeds)) {
      throw new Error("Invalid price feeds: expected array");
    }

    // Log each feed for debugging
    debugLog("ORACLE", `Got ${feeds.length} price feeds:`);
    feeds.forEach((f, i) => {
      debugLog("ORACLE_DEBUG", `Feed #${i}:`, {
        priceFeedId: f.priceFeedId,
        aggregatorObjectId: f.aggregatorObjectId || "MISSING",
        priceInfoObjectId: f.priceInfoObjectId || "MISSING",
        target: f.target,
        hasAccumulatorBytes: Array.isArray(f.accumulatorBytes),
        hasVaaBytes: Array.isArray(f.vaaBytes),
      });
    });

    // Filter to only valid feeds with required fields
    const validFeeds = feeds.filter(
      (f) =>
        !!f.aggregatorObjectId &&
        Array.isArray(f.accumulatorBytes) &&
        typeof f.target === "string" &&
        !!f.priceInfoObjectId
    );

    if (validFeeds.length === 0) {
      debugLog(
        "ORACLE",
        "⚠️ No valid price feeds, will fallback to SDK quick update"
      );
      return [];
    }

    if (validFeeds.length < feeds.length) {
      debugLog(
        "ORACLE",
        `⚠️ Only ${validFeeds.length}/${feeds.length} feeds are valid`
      );
    }

    priceFeedCache[key] = { data: validFeeds, timestamp: now };
    return validFeeds;
  } catch (error) {
    debugLog("ERROR", `Error fetching price feeds: ${error.message}`);
    // Return empty array to trigger fallback
    return [];
  }
}

/**
 * Add price update calls to a transaction block
 * @param {object} tx - Transaction builder
 * @param {Array} feeds - Price feed objects
 * @param {function} debugLog - Logging function
 */
async function addFreshPriceUpdates(tx, feeds, debugLog) {
  if (!feeds || !Array.isArray(feeds) || feeds.length === 0) {
    debugLog("ORACLE", "No price feeds to update");
    return false;
  }

  debugLog("ORACLE", `Adding ${feeds.length} price updates...`);

  try {
    for (const f of feeds) {
      // Validate essential feed properties
      if (typeof f.target !== "string") {
        throw new Error(`Invalid feed target: ${typeof f.target}`);
      }
      if (!f.aggregatorObjectId) {
        throw new Error(`Missing aggregatorObjectId for feed ${f.priceFeedId}`);
      }
      if (!f.priceInfoObjectId) {
        throw new Error(`Missing priceInfoObjectId for feed ${f.priceFeedId}`);
      }

      debugLog("ORACLE", `Updating feed ${f.priceFeedId}`);

      // Convert to Uint8Array for pure
      const accBytes = Uint8Array.from(f.accumulatorBytes);

      debugLog("ORACLE_DEBUG", `MoveCall details:`, {
        target: f.target,
        aggregatorObjectId: f.aggregatorObjectId,
        priceInfoObjectId: f.priceInfoObjectId,
        byteCount: accBytes.length,
        firstFewBytes: Array.from(accBytes.slice(0, 5)),
      });

      // create_authenticated_price_infos_using_accumulator
      try {
        await tx.moveCall({
          target: f.target,
          typeArguments: [],
          arguments: [
            // Use the aggregator object, not the price feed ID
            tx.object(f.aggregatorObjectId),
            tx.pure(accBytes, "vector<u8>"),
          ],
        });
      } catch (moveCallError) {
        debugLog(
          "ERROR",
          `MoveCall error for accumulator: ${moveCallError.message}`
        );
        throw moveCallError;
      }

      // parse_and_verify VAA
      if (f.vaaBytes) {
        const vaaBytes = Uint8Array.from(f.vaaBytes);
        try {
          await tx.moveCall({
            target: f.vaaTarget,
            typeArguments: [],
            arguments: [
              // Use correct VAA aggregator object
              tx.object(f.vaaAggregatorId || f.aggregatorObjectId),
              tx.pure(vaaBytes, "vector<u8>"),
            ],
          });
        } catch (vaaError) {
          debugLog("ERROR", `VAA verification error: ${vaaError.message}`);
          throw vaaError;
        }
      }

      // update_single_price_feed
      if (f.updateTarget) {
        try {
          await tx.moveCall({
            target: f.updateTarget,
            typeArguments: [],
            arguments: [
              // Use the price info object ID
              tx.object(f.priceInfoObjectId),
            ],
          });
        } catch (updateError) {
          debugLog("ERROR", `Price feed update error: ${updateError.message}`);
          throw updateError;
        }
      }
    }
    debugLog("ORACLE", "All price updates added successfully");
    return true;
  } catch (error) {
    debugLog("ERROR", `Failed to add price updates: ${error.message}`);
    // Don't re-throw, allow fallback to default price update mechanism
    return false;
  }
}

/**
 * Main price update function with fallback to SDK's updateAssetPricesQuick
 * @param {object} tx - Transaction builder
 * @param {string} coin - Coin symbol
 * @param {function} debugLog - Logging function
 */
async function updatePricesWithFallback(tx, coin, debugLog) {
  try {
    // Try our optimized price update first
    debugLog(
      "ORACLE",
      `Attempting to update prices for ${coin} with fresh data`
    );
    const priceFeeds = await getFreshPriceFeeds(coin, debugLog);
    const success = await addFreshPriceUpdates(tx, priceFeeds, debugLog);

    if (!success || !priceFeeds || priceFeeds.length === 0) {
      // Fallback to SDK's built-in method if our approach fails
      debugLog("ORACLE", "⚠️ Falling back to SDK's updateAssetPricesQuick");
      await tx.updateAssetPricesQuick([coin.toLowerCase()]);
    }

    return true;
  } catch (error) {
    debugLog("ERROR", `Price update failed: ${error.message}`);

    // Final fallback - try the SDK's method directly
    try {
      debugLog(
        "ORACLE",
        "🔄 Using emergency fallback to updateAssetPricesQuick"
      );
      await tx.updateAssetPricesQuick([coin.toLowerCase()]);
      return true;
    } catch (fallbackError) {
      debugLog(
        "ERROR",
        `Even fallback price update failed: ${fallbackError.message}`
      );
      throw fallbackError;
    }
  }
}

module.exports = {
  getFreshPriceFeeds,
  addFreshPriceUpdates,
  updatePricesWithFallback,
};
