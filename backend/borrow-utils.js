// borrow-utils.js
// Last updated: 2025-06-08 19:05:53 UTC by jake1318please

const { Transaction } = require("@mysten/sui/transactions");
const { getFreshPriceFeeds, addFreshPriceUpdates } = require("./oracle-utils");

// Centralized gas budget constants
const GAS_BUDGETS = {
  DEFAULT: 50_000_000, // 0.05 SUI
  HIGH: 150_000_000, // 0.15 SUI
  EXTREME: 200_000_000, // 0.2 SUI
  ULTRA: 300_000_000, // 0.3 SUI
};

// Known minimum borrow amounts as last-resort fallback
const MIN_HARDCODED_AMOUNTS = {
  sui: 2000000000, // 2 SUI
  usdc: 1061624, // 1.061624 USDC - Verified from successful transaction
  usdt: 3000000, // 3 USDT
};

/**
 * Gets the true minimum borrow amount directly from on-chain data
 * @param {Object} scallop - Initialized Scallop SDK instance
 * @param {String} coin - Lowercase coin symbol ('sui', 'usdc', etc.)
 * @param {Function} debugLog - Logging function
 * @returns {Promise<Number>} Minimum borrow amount in base units
 */
async function getAccurateMinimumBorrowAmount(scallop, coin, debugLog) {
  try {
    const query = await scallop.createScallopQuery();
    await query.init();

    debugLog(
      "MIN_BORROW",
      `Getting true minimum borrow amount for ${coin} from reserves...`
    );

    // Try getting from market reserves first (most accurate source)
    try {
      const reserves = await query.getMarketReserves();
      debugLog("MIN_BORROW", `Raw reserves data:`, reserves);

      const asset = reserves[coin];
      if (asset?.config?.minBorrowAmount) {
        const minBorrowAmount = parseInt(asset.config.minBorrowAmount);
        debugLog(
          "MIN_BORROW",
          `✓ Found on-chain minBorrowAmount for ${coin}: ${minBorrowAmount}`
        );

        // Don't apply safety buffer to USDC to avoid errors
        if (coin !== "usdc") {
          const safeAmount = Math.ceil(minBorrowAmount * 1.1);
          debugLog(
            "MIN_BORROW",
            `Adding 10% safety buffer (except for USDC): ${safeAmount}`
          );
          return safeAmount;
        }
        return minBorrowAmount;
      } else {
        debugLog(
          "MIN_BORROW",
          `❌ No minBorrowAmount in reserves.${coin}.config`
        );
      }
    } catch (reservesErr) {
      debugLog("MIN_BORROW", `Error getting reserves: ${reservesErr.message}`);
    }

    // Backup: try with marketCollaterals
    try {
      const marketCollaterals = await query.getMarketCollaterals([coin]);
      debugLog("MIN_BORROW", `Raw marketCollaterals data:`, marketCollaterals);

      const collateral = marketCollaterals[coin];
      if (collateral) {
        let minBorrowAmount = null;

        if (collateral.minBorrowAmount) {
          minBorrowAmount = parseInt(collateral.minBorrowAmount);
        } else if (collateral.reserves && collateral.reserves.minBorrowAmount) {
          minBorrowAmount = parseInt(collateral.reserves.minBorrowAmount);
        } else if (collateral.config && collateral.config.minBorrowAmount) {
          minBorrowAmount = parseInt(collateral.config.minBorrowAmount);
        }

        if (minBorrowAmount) {
          debugLog(
            "MIN_BORROW",
            `✓ Found minBorrowAmount in marketCollaterals: ${minBorrowAmount}`
          );
          // Don't apply safety buffer to USDC
          if (coin !== "usdc") {
            const safeAmount = Math.ceil(minBorrowAmount * 1.1);
            debugLog(
              "MIN_BORROW",
              `Adding 10% safety buffer (except for USDC): ${safeAmount}`
            );
            return safeAmount;
          }
          return minBorrowAmount;
        }
      }
    } catch (collateralsErr) {
      debugLog(
        "MIN_BORROW",
        `Error getting marketCollaterals: ${collateralsErr.message}`
      );
    }

    // Last resort: use hardcoded values
    const fallbackAmount = MIN_HARDCODED_AMOUNTS[coin];
    debugLog(
      "MIN_BORROW",
      `⚠️ Using hardcoded minBorrowAmount: ${fallbackAmount}`
    );
    return fallbackAmount;
  } catch (error) {
    debugLog("ERROR", `Error getting minimum borrow amount: ${error.message}`);
    return MIN_HARDCODED_AMOUNTS[coin];
  }
}

/**
 * Analyzes a transaction's commands in detail
 * @param {String} serializedTx - Serialized transaction
 * @param {Function} debugLog - Logging function
 */
function analyzeTransactionCommands(serializedTx, debugLog) {
  try {
    const tx = Transaction.from(serializedTx);
    const cmds = tx.blockData.transactions;

    let analysisLog = "🔍 FULL TRANSACTION COMMANDS:\n";
    let borrowArguments = null;

    cmds.forEach((cmd, i) => {
      analysisLog += `\n–– Command ${i + 1} ––\n`;
      analysisLog += ` kind:       ${cmd.kind}\n`;

      if (cmd.kind === "MoveCall") {
        analysisLog += ` target:     ${cmd.target}\n`;
        analysisLog += ` typeArgs:   ${JSON.stringify(cmd.typeArguments)}\n`;

        const args = cmd.arguments.map((arg, idx) => ({
          idx,
          kind: arg.kind,
          value:
            arg.kind === "Pure"
              ? arg.value
              : arg.kind === "Object"
              ? arg.objectId
              : JSON.stringify(arg),
        }));

        analysisLog += ` args:       ${JSON.stringify(args, null, 2)}\n`;

        // Check if this looks like a borrow operation
        if (
          cmd.target &&
          (cmd.target.includes("::borrow::") ||
            cmd.target.includes("::loan::") ||
            cmd.target.toLowerCase().includes("borrow"))
        ) {
          analysisLog += ` 🔴 BORROW OPERATION DETECTED!\n`;
          analysisLog += ` 🔍 DETAILED ARGUMENT INSPECTION:\n`;

          cmd.arguments.forEach((arg, argIdx) => {
            const value =
              arg.kind === "Pure"
                ? arg.value
                : arg.kind === "Object"
                ? arg.objectId
                : JSON.stringify(arg);
            analysisLog += `   Arg ${argIdx}: ${arg.kind} - ${value}\n`;
          });

          // Remember the borrow arguments for later
          borrowArguments = {
            commandIndex: i,
            target: cmd.target,
            typeArguments: cmd.typeArguments,
            arguments: args,
          };
        }
      }
    });

    debugLog("CMD_ANALYSIS", analysisLog);

    return {
      commandCount: cmds.length,
      commands: cmds,
      borrowArguments,
    };
  } catch (error) {
    debugLog("ERROR", `Error analyzing transaction commands: ${error.message}`);
    return {
      error: error.message,
    };
  }
}

/**
 * Builds a robust borrow transaction with extensive error handling and debugging
 */
async function buildRobustBorrowTx({
  scallop,
  sender,
  coin,
  amount,
  decimals,
  obligationId,
  skipPriceUpdates = false,
  debugLog,
}) {
  try {
    // Step 1: Get accurate minimum borrow amount
    const minBorrowAmount = await getAccurateMinimumBorrowAmount(
      scallop,
      coin.toLowerCase(),
      debugLog
    );
    debugLog(
      "BORROW",
      `Minimum borrow amount for ${coin}: ${minBorrowAmount} base units`
    );

    // Step 2: Convert to base units (special case for USDC)
    let baseUnits;
    if (coin.toLowerCase() === "usdc") {
      // IMPORTANT: For USDC, ensure we're at or above the exact minimum
      baseUnits = Math.max(
        Math.floor(amount * Math.pow(10, decimals)),
        minBorrowAmount
      );

      // If amount is different from what user requested, log this clearly
      if (baseUnits !== Math.floor(amount * Math.pow(10, decimals))) {
        const adjustedAmount = baseUnits / Math.pow(10, decimals);
        debugLog(
          "BORROW",
          `⚠️ Adjusting requested amount ${amount} to minimum ${adjustedAmount} ${coin}`
        );
      }
    } else {
      // For other coins, use normal conversion
      baseUnits = Math.floor(amount * Math.pow(10, decimals));
    }

    // Step 3: Validate against minimum
    if (baseUnits < minBorrowAmount) {
      const minAmount = minBorrowAmount / Math.pow(10, decimals);
      throw new Error(
        `Amount (${amount}) is below minimum borrow amount of ${minAmount} ${coin.toUpperCase()}`
      );
    }

    // Step 4: Build transaction
    try {
      const builder = await scallop.createScallopBuilder();
      const tx = builder.createTxBlock();
      tx.setSender(sender);

      // CRITICAL FIX: Fetch fresh price feed data and use it to update prices
      if (!skipPriceUpdates) {
        debugLog("BORROW", "🔄 Fetching fresh price feed data for", coin);

        // Get fresh price feed data from our new endpoint
        const priceFeeds = await getFreshPriceFeeds(coin, debugLog);

        // Add fresh price updates to the transaction
        if (priceFeeds && priceFeeds.length > 0) {
          debugLog(
            "BORROW",
            `📊 Adding ${priceFeeds.length} fresh price updates to transaction`
          );
          await addFreshPriceUpdates(tx, priceFeeds, debugLog);
        } else {
          debugLog(
            "BORROW",
            "⚠️ No fresh price feeds found, using SDK's updateAssetPricesQuick as fallback"
          );
          await tx.updateAssetPricesQuick([coin.toLowerCase()]);
        }
      } else {
        debugLog(
          "BORROW",
          "⚠️ WARNING: Skipping price updates. This will likely cause 1281 error."
        );
        debugLog(
          "BORROW",
          "⚠️ Price updates should always be included before borrowing."
        );
      }

      // Give plenty of gas headroom for the oracle operations and borrow
      tx.setGasBudget(GAS_BUDGETS.ULTRA);
      debugLog("BORROW", "⛽ Setting gas budget to ULTRA", GAS_BUDGETS.ULTRA);

      // Now invoke the borrow
      debugLog("BORROW", `💰 Borrowing ${baseUnits} base-units of ${coin}...`);
      const borrowedCoin = await tx.borrowQuick(
        baseUnits,
        coin.toLowerCase(),
        obligationId
      );

      // Transfer the borrowed coin to sender
      debugLog("BORROW", `📤 Adding transfer command to ${sender}`);
      tx.transferObjects([borrowedCoin], sender);

      // Serialize & analyze transaction
      const serializedTx = tx.txBlock.serialize();
      debugLog("BORROW", "✅ Transaction successfully serialized");

      const commandAnalysis = analyzeTransactionCommands(
        serializedTx,
        debugLog
      );

      // ADDITIONAL DEBUGGING: Find and log the entire borrow command if possible
      try {
        const parsedTx = Transaction.from(serializedTx);
        const cmds = parsedTx.blockData.transactions;
        const borrowCmd = cmds.find(
          (cmd) =>
            cmd.kind === "MoveCall" &&
            cmd.target &&
            cmd.target.includes("::borrow::")
        );

        if (borrowCmd) {
          debugLog(
            "BORROW_INPUTS",
            "Full borrow_internal MoveCall:",
            JSON.stringify(borrowCmd, null, 2)
          );
        }
      } catch (err) {
        debugLog(
          "ERROR",
          `Failed to extract borrow command details: ${err.message}`
        );
      }

      return {
        success: true,
        serializedTx,
        commandAnalysis,
        details: {
          sender,
          coin,
          amount,
          baseUnits,
          requestedBaseUnits: Math.floor(amount * Math.pow(10, decimals)),
          obligationId,
          gasBudget: GAS_BUDGETS.ULTRA,
          skipPriceUpdates,
          minBorrowAmount,
          priceUpdated: !skipPriceUpdates, // Flag to indicate if we updated the price
        },
      };
    } catch (buildError) {
      // If build fails, log the error and re-throw it
      debugLog(
        "BORROW_ERROR",
        `Transaction build failed: ${buildError.message}`
      );
      debugLog("BORROW_ERROR", `Stack trace: ${buildError.stack}`);
      throw buildError;
    }
  } catch (error) {
    debugLog(
      "ERROR",
      `Failed to build robust borrow transaction: ${error.message}`
    );
    throw error;
  }
}

module.exports = {
  GAS_BUDGETS,
  MIN_HARDCODED_AMOUNTS,
  getAccurateMinimumBorrowAmount,
  analyzeTransactionCommands,
  buildRobustBorrowTx,
};
