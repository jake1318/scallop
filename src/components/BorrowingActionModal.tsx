// src/components/BorrowingActionModal.tsx
// Enhanced with advanced debugging tools and alternative borrow methods
// Last updated: 2025-06-07 02:13:12 UTC by jake1318

import React, { useState, useEffect } from "react";
import { useWallet } from "@suiet/wallet-kit";
import { Transaction } from "@mysten/sui/transactions";
import scallopLendingService from "../scallop/scallopLendingService";
import scallopBackendService from "../scallop/scallopBackendService";
import "../styles/BorrowingActionModal.scss";

// Constants for coin configuration
const COINS = {
  SUI: {
    symbol: "SUI",
    decimals: 9,
    name: "sui",
  },
  USDC: {
    symbol: "USDC",
    decimals: 6,
    name: "usdc",
  },
};

// Minimum borrow amounts for reliable transactions
const MIN_BORROW_AMOUNTS = {
  USDC: 3, // Recommended minimum for USDC
  SUI: 2, // Recommended minimum for SUI
};

interface BorrowingActionModalProps {
  onClose: () => void;
  onSuccess?: () => void;
  defaultBorrowAmount?: string;
  hasObligation?: boolean;
}

const BorrowingActionModal: React.FC<BorrowingActionModalProps> = ({
  onClose,
  onSuccess,
  defaultBorrowAmount = "",
  hasObligation = false,
}) => {
  // Get wallet from Suiet context
  const wallet = useWallet();

  // Form state
  const [borrowAmount, setBorrowAmount] = useState<string>(defaultBorrowAmount);
  const [borrowAsset, setBorrowAsset] = useState<keyof typeof COINS>("USDC");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [txLink, setTxLink] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState<boolean>(false);
  const [suggestedAmount, setSuggestedAmount] = useState<number | null>(null);
  const [maxSafeBorrowAmount, setMaxSafeBorrowAmount] = useState<number | null>(
    null
  );
  const [processingStep, setProcessingStep] = useState<string | null>(null);
  const [solutions, setSolutions] = useState<string[] | null>(null);

  // Asset price
  const [assetPrice, setAssetPrice] = useState<number | null>(null);
  const [usdValue, setUsdValue] = useState<string | null>(null);
  const [isLoadingPrice, setIsLoadingPrice] = useState<boolean>(false);

  // For debugging display
  const [obligationId, setObligationId] = useState<string | null>(null);
  const [sdkInfo, setSdkInfo] = useState<any>(null);
  const [debugInfo, setDebugInfo] = useState<any>(null);
  const [onChainMinimum, setOnChainMinimum] = useState<number | null>(null);
  const [borrowMethod, setBorrowMethod] = useState<string>("regular");

  // Load obligation ID and SDK info when component mounts
  useEffect(() => {
    if (wallet.connected) {
      // Get obligation ID
      scallopBackendService
        .getObligationId(wallet)
        .then((id) => setObligationId(id));

      // Get basic SDK info
      try {
        const info = scallopLendingService.getSdkInfo();
        setSdkInfo(info);
      } catch (err) {
        console.error("Error getting SDK info:", err);
      }

      // Check max safe borrow amount
      checkMaxSafeBorrowAmount();

      // Check on-chain minimum
      checkOnChainMinimum();
    }
  }, [wallet.connected]);

  // Update values when borrowAsset changes
  useEffect(() => {
    if (wallet.connected) {
      checkMaxSafeBorrowAmount();
      checkOnChainMinimum();
      setError(null);
      setSuggestedAmount(null);
    }
  }, [borrowAsset]);

  // Check on-chain minimum borrow amount
  const checkOnChainMinimum = async () => {
    if (!wallet.address) return;

    try {
      const result = await scallopBackendService.checkDirectMinBorrow(
        COINS[borrowAsset].name
      );

      if (result.success && result.recommendedMinimum) {
        const chainMin = result.recommendedMinimum.displayAmount;
        console.log(
          `On-chain minimum borrow amount: ${chainMin} ${COINS[borrowAsset].symbol}`
        );
        setOnChainMinimum(chainMin);

        // Update our display min if on-chain min is higher
        if (chainMin > MIN_BORROW_AMOUNTS[borrowAsset]) {
          console.log(
            `Updating displayed minimum from ${MIN_BORROW_AMOUNTS[borrowAsset]} to ${chainMin}`
          );
        }
      }
    } catch (err) {
      console.warn("Error checking on-chain minimum:", err);
    }
  };

  // Get max safe borrow amount
  const checkMaxSafeBorrowAmount = async () => {
    if (!wallet.address) return;

    try {
      const result = await scallopBackendService.getMaxBorrowAmount(
        wallet.address,
        COINS[borrowAsset].name
      );

      if (result.success && result.maxAmount > 0) {
        console.log(
          `Maximum safe borrow amount: ${result.maxAmount} ${COINS[borrowAsset].symbol}`
        );
        setMaxSafeBorrowAmount(result.maxAmount);

        // Check if current amount exceeds safe maximum
        if (borrowAmount && Number(borrowAmount) > result.maxAmount) {
          setError(
            `Warning: Your requested amount exceeds the safe maximum of ${result.maxAmount} ${COINS[borrowAsset].symbol}.`
          );
        }
      }
    } catch (err) {
      console.warn("Error checking max borrow amount:", err);
    }
  };

  // Get market price data
  useEffect(() => {
    const fetchPrice = async () => {
      if (!borrowAsset) return;

      setIsLoadingPrice(true);
      try {
        const prices = await scallopBackendService.getMarketPrices();
        const assetName = COINS[borrowAsset].name;

        if (prices.pools && prices.pools[assetName]?.coinPrice) {
          setAssetPrice(prices.pools[assetName].coinPrice);

          // Calculate USD value if amount is provided
          if (borrowAmount && !isNaN(Number(borrowAmount))) {
            const amountNum = Number(borrowAmount);
            setUsdValue(
              (amountNum * prices.pools[assetName].coinPrice).toFixed(2)
            );
          }
        }
      } catch (error) {
        console.error("Failed to fetch market data:", error);
      } finally {
        setIsLoadingPrice(false);
      }
    };

    fetchPrice();
  }, [borrowAsset, borrowAmount]);

  // Debug the borrow_internal function
  const debugBorrowInternal = async () => {
    try {
      setIsLoading(true);
      setProcessingStep("Deep debugging borrow_internal function...");

      const response = await fetch("/api/debug/borrow-internal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: wallet.address,
          coin: COINS[borrowAsset].name,
          obligationId,
        }),
      });

      const data = await response.json();
      setDebugInfo((prev) => ({
        ...prev,
        borrowInternalDebug: data,
        timestamp: new Date().toISOString(),
      }));

      setError(
        `Deep debugging completed. Check server console for detailed analysis.`
      );
    } catch (error) {
      console.error("Error debugging borrow_internal:", error);
      setError(`Error during debugging: ${error.message}`);
    } finally {
      setIsLoading(false);
      setProcessingStep(null);
    }
  };

  // Analyze transaction structure
  const analyzeTransactionStructure = async () => {
    try {
      setIsLoading(true);
      setProcessingStep("Analyzing transaction structure...");

      const response = await fetch("/api/analyze-transaction-structure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: wallet.address,
        }),
      });

      const data = await response.json();
      setDebugInfo((prev) => ({
        ...prev,
        transactionAnalysis: data,
        timestamp: new Date().toISOString(),
      }));

      setError(`Transaction structure analysis completed. Check server logs.`);
    } catch (error) {
      console.error("Error analyzing transaction structure:", error);
      setError(`Error during analysis: ${error.message}`);
    } finally {
      setIsLoading(false);
      setProcessingStep(null);
    }
  };

  // Try direct borrow without price updates
  const tryDirectBorrow = async () => {
    if (!wallet.connected) {
      setError("Wallet not connected");
      return;
    }

    const borrowAmtNum = Number(borrowAmount);
    if (isNaN(borrowAmtNum) || borrowAmtNum <= 0) {
      setError("Please enter a valid borrow amount");
      return;
    }

    setIsLoading(true);
    setError(null);
    setTxLink(null);
    setSolutions(null);
    setProcessingStep("Creating direct borrow transaction...");

    try {
      const directResponse = await fetch("/api/direct-borrow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: wallet.address,
          coin: COINS[borrowAsset].name,
          amount: borrowAmtNum,
          decimals: COINS[borrowAsset].decimals,
          obligationId,
        }),
      });

      const directData = await directResponse.json();

      if (!directData.success) {
        setError(
          `Failed to create direct borrow transaction: ${directData.error}`
        );
        return;
      }

      // Execute the transaction
      setProcessingStep("Executing direct borrow transaction...");
      const txb = Transaction.from(directData.serializedTx);
      const txResult = await wallet.signAndExecuteTransactionBlock({
        transactionBlock: txb,
        options: { showEffects: true, showEvents: true },
      });

      if (txResult.effects?.status?.status === "success") {
        setTxLink(`https://suivision.xyz/txblock/${txResult.digest}`);
        setShowSuccess(true);

        if (onSuccess) {
          onSuccess();
        }
      } else {
        const errorText = String(txResult.effects?.status?.error || "");
        setError(`Direct borrow transaction failed: ${errorText}`);

        // Log detailed error info
        setDebugInfo((prev) => ({
          ...prev,
          directBorrowError: errorText,
          txDigest: txResult.digest,
          timestamp: new Date().toISOString(),
        }));

        setSolutions([
          "Try a different borrow method",
          "Add more collateral to your lending account",
          "Contact Scallop support for assistance",
        ]);
      }
    } catch (error) {
      console.error("Error with direct borrow:", error);
      setError(`Error: ${error.message}`);
    } finally {
      setIsLoading(false);
      setProcessingStep(null);
    }
  };

  // Try large borrow test
  const tryLargeBorrowTest = async () => {
    if (!wallet.connected) return;

    setIsLoading(true);
    setProcessingStep("Testing with larger amount...");
    setError(null);
    setTxLink(null);
    setSolutions(null);

    try {
      const result = await scallopBackendService.borrowLarge(
        wallet,
        COINS[borrowAsset].name
      );

      if (result.success) {
        setTxLink(result.txLink);
        setShowSuccess(true);

        // Add note about using large amount
        setDebugInfo((prev) => ({
          ...prev,
          largeAmountSuccess: true,
          amount: result.amount,
          timestamp: new Date().toISOString(),
        }));

        // Call success callback if provided
        if (onSuccess) {
          onSuccess();
        }
      } else {
        setError(`Large amount test failed: ${result.error}`);
      }
    } catch (error: any) {
      console.error("Large borrow test failed:", error);
      setError(error.message || "Test failed. Please try another approach.");
    } finally {
      setIsLoading(false);
      setProcessingStep(null);
    }
  };

  // Regular borrow with SDK
  const handleRegularBorrow = async () => {
    if (!wallet.connected) {
      setError("Wallet not connected");
      return;
    }

    // Validate input values
    const borrowAmtNum = Number(borrowAmount);

    if (isNaN(borrowAmtNum) || borrowAmtNum <= 0) {
      setError("Please enter a valid borrow amount.");
      return;
    }

    // Check minimum borrow amount
    const minAmount = MIN_BORROW_AMOUNTS[borrowAsset];
    if (borrowAmtNum < minAmount) {
      setError(
        `Minimum borrow amount for ${COINS[borrowAsset].symbol} is ${minAmount}.`
      );
      return;
    }

    // Also check on-chain minimum if we have it
    if (onChainMinimum && borrowAmtNum < onChainMinimum) {
      setError(
        `On-chain minimum borrow amount is ${onChainMinimum} ${COINS[borrowAsset].symbol}.`
      );
      return;
    }

    setIsLoading(true);
    setError(null);
    setTxLink(null);
    setSolutions(null);
    setProcessingStep("Creating borrow transaction");

    try {
      // Get selected coin
      const selectedCoin = COINS[borrowAsset];

      // Execute the borrow
      console.log(`Starting borrow process using backend service`);

      const result = await scallopBackendService.borrow(
        wallet,
        selectedCoin.name,
        borrowAmtNum,
        selectedCoin.decimals
      );

      if (result.success) {
        // Set transaction link for UI
        setTxLink(result.txLink);
        setShowSuccess(true);

        // Call success callback if provided
        if (onSuccess) {
          onSuccess();
        }
      } else {
        // Check if there's a suggested amount or specific error code
        if (result.errorCode === "1281") {
          setError(
            `Transaction failed with error 1281: Minimum borrow amount not met. Please try borrowing at least ${
              onChainMinimum || minAmount
            } ${COINS[borrowAsset].symbol}.`
          );
          setSuggestedAmount(onChainMinimum || minAmount);
          setSolutions([
            `Try one of the alternative borrow methods below`,
            `Borrow at least ${onChainMinimum || minAmount} ${
              COINS[borrowAsset].symbol
            }`,
            "Add more collateral to your lending account",
            "Wait a few minutes and try again (price feeds may need to update)",
          ]);
        } else if (result.suggestedAmount) {
          // Show suggested amount
          setError(result.error || "Transaction failed. Try suggested amount.");
          setSuggestedAmount(Math.max(minAmount, result.suggestedAmount));
        } else if (result.minimumAmount) {
          // Minimum amount required
          setError(
            `${
              result.error || "Transaction failed."
            } The minimum borrow amount is ${result.minimumAmount} ${
              COINS[borrowAsset].symbol
            }.`
          );
          setSuggestedAmount(result.minimumAmount);
        } else {
          // Regular error
          setError(result.error || "Transaction failed. Please try again.");

          // Add solutions if provided
          if (result.solutions) {
            setSolutions(result.solutions);
          } else {
            setSolutions([
              `Make sure you're borrowing at least ${
                onChainMinimum || minAmount
              } ${COINS[borrowAsset].symbol}`,
              "Try one of the alternative borrow methods below",
              "Add more collateral to your lending account",
              "Try again in a few minutes when price feeds update",
            ]);
          }
        }
      }
    } catch (err: any) {
      console.error("Borrow transaction failed:", err);
      setError(err.message || "Borrow failed. Please try again.");
    } finally {
      setIsLoading(false);
      setProcessingStep(null);
    }
  };

  // Handle borrow based on selected method
  const handleBorrow = async () => {
    switch (borrowMethod) {
      case "direct":
        await tryDirectBorrow();
        break;
      case "large":
        await tryLargeBorrowTest();
        break;
      case "regular":
      default:
        await handleRegularBorrow();
        break;
    }
  };

  // Update USD value when amount changes
  const handleAmountChange = (value: string) => {
    setBorrowAmount(value);

    // Clear suggested amount when user changes the amount
    if (suggestedAmount !== null) {
      setSuggestedAmount(null);
    }

    // Check minimum borrow amount - show warnings but don't block UI
    const minAmount = MIN_BORROW_AMOUNTS[borrowAsset];
    const effectiveMin =
      onChainMinimum && onChainMinimum > minAmount ? onChainMinimum : minAmount;
    const amountNum = Number(value);

    if (!isNaN(amountNum) && amountNum > 0 && amountNum < effectiveMin) {
      setError(
        `Minimum borrow amount for ${COINS[borrowAsset].symbol} is ${effectiveMin}.`
      );
    } else if (
      maxSafeBorrowAmount !== null &&
      amountNum > maxSafeBorrowAmount
    ) {
      setError(
        `Warning: Your requested amount exceeds the safe maximum of ${maxSafeBorrowAmount} ${COINS[borrowAsset].symbol}.`
      );
    } else {
      setError(null);
    }

    // Update USD value
    if (assetPrice && !isNaN(amountNum)) {
      setUsdValue((amountNum * assetPrice).toFixed(2));
    } else {
      setUsdValue(null);
    }
  };

  // Use suggested amount handler
  const handleUseSuggestedAmount = () => {
    if (suggestedAmount !== null) {
      setBorrowAmount(suggestedAmount.toString());
      setError(null);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-container">
        <div className="modal-header">
          <h2>Borrow Assets</h2>
          <button className="close-btn" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className="modal-body">
          {isLoading ? (
            <div className="loading-container">
              <span className="loader"></span>
              <p>Processing your transaction...</p>
              {processingStep && (
                <p className="processing-step">{processingStep}</p>
              )}
              <p className="small-text">
                This may take a moment while we prepare your transaction.
              </p>
            </div>
          ) : showSuccess ? (
            <div className="result-container success">
              <h3>Transaction Successful!</h3>
              <p>
                You've successfully borrowed {borrowAmount}{" "}
                {COINS[borrowAsset].symbol}.
              </p>

              {txLink && (
                <div className="tx-details">
                  <div className="tx-hash">Transaction completed</div>
                  <a
                    href={txLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="tx-link"
                  >
                    View on SuiVision
                  </a>
                </div>
              )}

              <div className="action-buttons">
                <button className="primary-btn" onClick={onClose}>
                  Close
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="asset-selection">
                <label>Select Asset:</label>
                <div className="asset-buttons">
                  {Object.keys(COINS).map((coin) => (
                    <button
                      key={coin}
                      className={`asset-btn ${
                        borrowAsset === coin ? "selected" : ""
                      }`}
                      onClick={() => setBorrowAsset(coin as keyof typeof COINS)}
                    >
                      {coin}
                    </button>
                  ))}
                </div>
              </div>

              <div className="asset-info">
                <div className="info-row">
                  <span>Asset to Borrow:</span>
                  <span>{COINS[borrowAsset].symbol}</span>
                </div>
                <div className="info-row">
                  <span>Decimals:</span>
                  <span>{COINS[borrowAsset].decimals}</span>
                </div>
                <div className="info-row">
                  <span>Current Price:</span>
                  <span>
                    {assetPrice
                      ? `$${assetPrice.toFixed(2)}`
                      : isLoadingPrice
                      ? "Loading..."
                      : "N/A"}
                  </span>
                </div>
                {obligationId && (
                  <div className="info-row">
                    <span>Obligation ID:</span>
                    <span className="obligation-id">
                      {obligationId.substring(0, 10)}...
                      {obligationId.substring(obligationId.length - 10)}
                    </span>
                  </div>
                )}

                {maxSafeBorrowAmount !== null && (
                  <div className="info-row safe-borrow">
                    <span>Safe Borrow Amount:</span>
                    <span className="max-safe">
                      Up to {maxSafeBorrowAmount} {COINS[borrowAsset].symbol}
                    </span>
                  </div>
                )}

                <div className="info-row">
                  <span>Minimum Amount:</span>
                  <span className="min-amount">
                    {onChainMinimum &&
                    onChainMinimum > MIN_BORROW_AMOUNTS[borrowAsset]
                      ? `${onChainMinimum} ${COINS[borrowAsset].symbol} (on-chain)`
                      : `${MIN_BORROW_AMOUNTS[borrowAsset]} ${COINS[borrowAsset].symbol}`}
                  </span>
                </div>

                <div className="info-row">
                  <span>Borrow Method:</span>
                  <span className="borrow-method">
                    <select
                      value={borrowMethod}
                      onChange={(e) => setBorrowMethod(e.target.value)}
                    >
                      <option value="regular">
                        Regular (With Price Update)
                      </option>
                      <option value="direct">Direct (No Price Update)</option>
                      <option value="large">Large Amount Test</option>
                    </select>
                  </span>
                </div>
              </div>

              <div className="amount-input-container">
                <label>Amount to Borrow</label>
                <div className="min-amount-note">
                  Minimum:{" "}
                  {onChainMinimum &&
                  onChainMinimum > MIN_BORROW_AMOUNTS[borrowAsset]
                    ? onChainMinimum
                    : MIN_BORROW_AMOUNTS[borrowAsset]}{" "}
                  {COINS[borrowAsset].symbol}
                </div>
                <div className="input-with-max">
                  <input
                    type="number"
                    value={borrowAmount}
                    onChange={(e) => handleAmountChange(e.target.value)}
                    placeholder={`Enter amount of ${COINS[borrowAsset].symbol}`}
                    disabled={isLoading}
                    min={MIN_BORROW_AMOUNTS[borrowAsset]}
                    step="0.1"
                  />
                  {maxSafeBorrowAmount !== null && (
                    <button
                      className="max-btn"
                      onClick={() =>
                        handleAmountChange(maxSafeBorrowAmount.toString())
                      }
                    >
                      MAX SAFE
                    </button>
                  )}
                </div>
                {usdValue && (
                  <div className="amount-in-usd">≈ ${usdValue} USD</div>
                )}
              </div>

              {error && <div className="error-message">{error}</div>}

              {solutions && (
                <div className="solutions-container">
                  <h4>Suggested solutions:</h4>
                  <ul className="solutions-list">
                    {solutions.map((solution, index) => (
                      <li key={index}>{solution}</li>
                    ))}
                  </ul>
                </div>
              )}

              {suggestedAmount !== null && (
                <div className="suggested-amount-container">
                  <p>
                    Suggested amount: {suggestedAmount}{" "}
                    {COINS[borrowAsset].symbol}
                  </p>
                  <button
                    className="use-suggested-btn"
                    onClick={handleUseSuggestedAmount}
                  >
                    Use Suggested Amount
                  </button>
                </div>
              )}

              <div className="action-buttons">
                <button
                  className="submit-btn primary-btn"
                  onClick={handleBorrow}
                  disabled={
                    !wallet.connected ||
                    isLoading ||
                    borrowAmount === "" ||
                    Number(borrowAmount) <= 0
                  }
                >
                  Borrow {COINS[borrowAsset].symbol}
                </button>

                <div className="debug-buttons">
                  <button
                    className="debug-btn secondary-btn"
                    onClick={debugBorrowInternal}
                    disabled={isLoading || !wallet.connected}
                  >
                    Debug Internal
                  </button>

                  <button
                    className="analyze-btn secondary-btn"
                    onClick={analyzeTransactionStructure}
                    disabled={isLoading || !wallet.connected}
                  >
                    Analyze TX Structure
                  </button>
                </div>
              </div>

              <div className="borrowing-info">
                <p>
                  Borrowing assets requires collateral in your lending account.
                  Your health factor must remain above 1.0 after borrowing.
                </p>
                <p className="min-borrow-warning">
                  <strong>Note:</strong> Minimum borrow amounts apply:{" "}
                  {MIN_BORROW_AMOUNTS[borrowAsset]} {COINS[borrowAsset].symbol}{" "}
                  for standard transactions.
                </p>

                {onChainMinimum &&
                  onChainMinimum > MIN_BORROW_AMOUNTS[borrowAsset] && (
                    <p className="on-chain-min-note">
                      <strong>On-chain minimum:</strong> {onChainMinimum}{" "}
                      {COINS[borrowAsset].symbol}
                    </p>
                  )}

                {sdkInfo && (
                  <div className="sdk-info">
                    <p>
                      <small>Network: {sdkInfo.networkType}</small>
                    </p>
                    <p>
                      <small>SDK Version: {sdkInfo.sdkVersion}</small>
                    </p>
                    <p>
                      <small>
                        Last Updated: 2025-06-07 02:13:12 by jake1318
                      </small>
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default BorrowingActionModal;
