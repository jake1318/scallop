// src/components/RepaymentModal.tsx
// Last Updated: 2025-06-19 02:19:42 UTC by jake1318

import React, { useState, useEffect } from "react";
import { useWallet } from "@suiet/wallet-kit";
import scallopService from "../scallop/ScallopService";
import scallopBorrowService from "../scallop/ScallopBorrowService";
import { getObligationId } from "../scallop/ScallopCollateralService";
import {
  repayObligation,
  unlockAndRepayObligation,
  isObligationLocked,
} from "../scallop/ScallopIncentiveService";
import "../styles/BorrowingActionModal.scss";
import * as blockvisionService from "../services/blockvisionService"; // Import the blockvision service

// Simple utility functions
const formatNumber = (num: number, decimals: number = 2): string => {
  return num.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
};

const truncateAddress = (address: string): string => {
  if (!address) return "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

// Info icon component
const InfoIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10"></circle>
    <line x1="12" y1="16" x2="12" y2="12"></line>
    <line x1="12" y1="8" x2="12.01" y2="8"></line>
  </svg>
);

// Lock icon component
const LockIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
    <path d="M7 11V7a5 5 0 0110 0v4"></path>
  </svg>
);

// Constants for coin configuration - updated to handle multiple coin types
const COINS = {
  SUI: {
    symbol: "SUI",
    name: "sui",
    decimals: 9,
    icon: "/icons/sui-icon.svg",
    coinTypes: ["0x2::sui::SUI"],
  },
  USDC: {
    symbol: "USDC",
    name: "usdc",
    decimals: 6,
    icon: "/icons/usdc-icon.svg",
    coinTypes: [
      "0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN",
      "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
      "0xc3f8927de33d3deb52c282a836082a413bc73c6ee0bd4d7ec7e3b6b4c28e9abf::coin::COIN",
    ],
  },
  USDT: {
    symbol: "USDT",
    name: "usdt",
    decimals: 6,
    icon: "/icons/usdt-icon.svg",
    coinTypes: [
      "0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN",
      "0x375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT",
    ],
  },
};

// Modified function to get total balance across all coin types with the same symbol
function getTotalCoinBalance(coins: any[], coinConfig: any): number {
  if (!coins || !coinConfig || !coinConfig.coinTypes) return 0;

  let totalBalance = 0;

  // Check each possible coin type for the symbol and sum their balances
  for (const coinType of coinConfig.coinTypes) {
    const matchingCoins = coins.filter((coin) => coin.coinType === coinType);

    for (const coin of matchingCoins) {
      if (coin && coin.balance) {
        // Apply correct decimals (from coin.decimals if available, otherwise from coinConfig)
        const decimals = coin.decimals || coinConfig.decimals;
        totalBalance += Number(coin.balance) / Math.pow(10, decimals);
      }
    }
  }

  return totalBalance;
}

// Safe amounts for repaying
const SAFE_REPAY_AMOUNTS = {
  USDC: 0.1, // 0.1 USDC
  SUI: 0.01, // 0.01 SUI
  USDT: 0.1, // 0.1 USDT
};

interface RepaymentModalProps {
  onClose: () => void;
  onSuccess?: () => void;
  defaultRepayAmount?: string;
  obligationId?: string;
}

const RepaymentModal: React.FC<RepaymentModalProps> = ({
  onClose,
  onSuccess,
  defaultRepayAmount = "",
  obligationId: propObligationId,
}) => {
  const wallet = useWallet();

  // State
  const [repayAmount, setRepayAmount] = useState<string>(defaultRepayAmount);
  const [selectedAsset, setSelectedAsset] = useState<string>("USDC");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [transactionResult, setTransactionResult] = useState<any>(null);
  const [currentDebt, setCurrentDebt] = useState<number | null>(null);
  const [showDebugInfo, setShowDebugInfo] = useState<boolean>(false);
  const [obligationId, setObligationId] = useState<string | null>(
    propObligationId || null
  );
  const [isObligationLocked, setIsObligationLocked] = useState<boolean>(false);
  const [healthFactor, setHealthFactor] = useState<number | null>(null);
  const [borrowedAssets, setBorrowedAssets] = useState<any[]>([]);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState<boolean>(true);
  const [accountCoins, setAccountCoins] = useState<any[]>([]); // Store all account coins from blockvision
  const [obligationDetails, setObligationDetails] = useState<any>(null);

  // Fetch obligation ID and user portfolio data when component mounts
  useEffect(() => {
    if (wallet.connected && wallet.address) {
      setIsInitialLoading(true);
      Promise.all([fetchObligationIdIfNeeded(), fetchWalletCoins()]).finally(
        () => {
          setIsInitialLoading(false);
        }
      );
    }
  }, [wallet.connected, wallet.address, selectedAsset]);

  // Fetch all wallet coins using blockvision service
  const fetchWalletCoins = async () => {
    if (!wallet.address) return;

    try {
      console.log(`Fetching wallet coins for address: ${wallet.address}`);
      const coins = await blockvisionService.getAccountCoins(wallet.address);
      setAccountCoins(coins);
      console.log("Account coins:", coins);

      // Update the wallet balance for the selected asset
      updateSelectedAssetBalance(coins);
    } catch (err) {
      console.error("Error fetching account coins:", err);
    }
  };

  // Update wallet balance when selected asset changes or when coins are fetched
  const updateSelectedAssetBalance = (coins: any[] = accountCoins) => {
    if (!coins.length) return;

    const coinConfig = COINS[selectedAsset as keyof typeof COINS];
    if (!coinConfig) {
      console.error(`Unknown coin type: ${selectedAsset}`);
      setWalletBalance(0);
      return;
    }

    // Use new function to get total balance across all possible coin types
    const balance = getTotalCoinBalance(coins, coinConfig);

    console.log(`Updated wallet balance for ${selectedAsset}: ${balance}`);
    setWalletBalance(balance);
  };

  // Update wallet balance when selected asset changes
  useEffect(() => {
    updateSelectedAssetBalance();
  }, [selectedAsset, accountCoins]);

  // Check if obligation is locked
  const checkObligationLockedStatus = async (oblId: string) => {
    if (!wallet.address || !oblId) return false;

    try {
      const isLocked = await isObligationLocked(oblId, wallet.address);
      console.log(`Obligation ${oblId} locked status: ${isLocked}`);
      setIsObligationLocked(isLocked);
      return isLocked;
    } catch (err) {
      console.error("Error checking obligation lock status:", err);
      return false;
    }
  };

  // Only fetch obligation ID if it wasn't provided in props
  const fetchObligationIdIfNeeded = async () => {
    // Skip if we already have the obligation ID from props
    if (propObligationId) {
      console.log("Using obligation ID from props:", propObligationId);
      setObligationId(propObligationId);

      // Check if obligation is locked and fetch its details
      await checkObligationLockedStatus(propObligationId);
      await fetchUserPortfolioData(propObligationId);
      return;
    }

    try {
      if (!wallet.address) return;

      const id = await getObligationId(wallet.address);
      setObligationId(id);

      console.log("Fetched obligation ID:", id);

      // Check if obligation is locked and fetch its details
      if (id) {
        await checkObligationLockedStatus(id);
        await fetchUserPortfolioData(id);
      }
    } catch (err) {
      console.error("Error fetching obligation ID:", err);
    }
  };

  // Fetch user portfolio data to get current debt
  const fetchUserPortfolioData = async (specificObligationId?: string) => {
    try {
      if (!wallet.address) return;

      // If we have an obligation ID, use it to fetch debt for that specific obligation
      if (specificObligationId || obligationId) {
        const targetObligationId = specificObligationId || obligationId;

        // Get data for the specific obligation
        console.log(
          "Fetching data for specific obligation:",
          targetObligationId
        );

        // Use scallopBorrowService.getObligationDetails
        const { success, obligation: obligationData } =
          await scallopBorrowService.getObligationDetails(
            targetObligationId!,
            wallet.address
          );

        console.log("Obligation-specific data:", obligationData);

        // Store the obligation details for later use
        setObligationDetails(obligationData);

        if (obligationData && obligationData.borrows) {
          // Format borrowed assets to match the expected structure
          const formattedBorrows = obligationData.borrows.map((borrow) => ({
            symbol: borrow.symbol,
            amount: borrow.amount,
            valueUSD: borrow.usd,
            apy: borrow.interestRate || 0,
          }));

          setBorrowedAssets(formattedBorrows);

          // Set default selected asset to the first borrowed asset if available
          if (formattedBorrows.length > 0) {
            if (!formattedBorrows.find((a) => a.symbol === selectedAsset)) {
              setSelectedAsset(formattedBorrows[0].symbol);
              setCurrentDebt(formattedBorrows[0].amount);
            } else {
              const debt = formattedBorrows.find(
                (asset) => asset.symbol === selectedAsset
              );
              setCurrentDebt(debt ? debt.amount : 0);
            }
          }

          // Calculate health factor from collateral and borrows
          if (
            obligationData.totalCollateralUSD > 0 &&
            obligationData.totalBorrowUSD > 0
          ) {
            const calculatedHealthFactor =
              (obligationData.totalCollateralUSD * 0.8) /
              obligationData.totalBorrowUSD;
            setHealthFactor(Math.min(calculatedHealthFactor, 999));
          } else {
            setHealthFactor(999);
          }

          // Update lock status from obligation data
          setIsObligationLocked(obligationData.isLocked || false);

          return; // Skip the general portfolio fetch below
        }
      }

      // Fallback to using general user positions if we don't have obligation-specific data
      const userPositions = await scallopService.fetchUserPositions(
        wallet.address
      );
      console.log("User positions:", userPositions);

      // Store borrowed assets
      setBorrowedAssets(userPositions.borrowedAssets || []);

      // Calculate total collateral value in USD
      const totalCollateralUSD = userPositions.collateralAssets.reduce(
        (sum, asset) => sum + asset.valueUSD,
        0
      );

      // Calculate total borrowed value in USD
      const totalBorrowedUSD = userPositions.borrowedAssets.reduce(
        (sum, asset) => sum + asset.valueUSD,
        0
      );

      // Calculate health factor
      let calculatedHealthFactor =
        totalBorrowedUSD > 0
          ? (totalCollateralUSD * 0.8) / totalBorrowedUSD
          : 999;

      calculatedHealthFactor = Math.min(calculatedHealthFactor, 999);
      setHealthFactor(calculatedHealthFactor);

      // Find current debt for the selected asset
      const debt = userPositions.borrowedAssets.find(
        (asset) => asset.symbol === selectedAsset
      );

      // Set default selected asset to the first borrowed asset if available
      if (
        userPositions.borrowedAssets &&
        userPositions.borrowedAssets.length > 0 &&
        !userPositions.borrowedAssets.find((a) => a.symbol === selectedAsset)
      ) {
        setSelectedAsset(userPositions.borrowedAssets[0].symbol);
        setCurrentDebt(userPositions.borrowedAssets[0].amount);
      } else {
        setCurrentDebt(debt ? debt.amount : 0);
      }

      console.log(`Current debt for ${selectedAsset}: ${debt?.amount || 0}`);
    } catch (err) {
      console.error("Error fetching portfolio data:", err);
    }
  };

  // Handle amount change
  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    // Allow only numbers and a single decimal point
    if (value === "" || /^[0-9]*\.?[0-9]*$/.test(value)) {
      setRepayAmount(value);
      setError(null); // Clear any previous error
    }
  };

  // Handle asset selection
  const handleAssetChange = (asset: string) => {
    setSelectedAsset(asset);
    setRepayAmount(""); // Reset amount when asset changes

    // Update current debt based on selected asset
    const debt = borrowedAssets.find((a) => a.symbol === asset);
    setCurrentDebt(debt ? debt.amount : 0);

    // Update wallet balance for the new asset
    updateSelectedAssetBalance();
  };

  // Use safe amount
  const handleUseSafeAmount = () => {
    const safeAmount =
      SAFE_REPAY_AMOUNTS[selectedAsset as keyof typeof SAFE_REPAY_AMOUNTS] ??
      SAFE_REPAY_AMOUNTS.USDC;
    setRepayAmount(safeAmount.toString());
  };

  // Set maximum amount (repay full debt)
  const handleUseMaxAmount = () => {
    if (currentDebt !== null) {
      if (walletBalance !== null && walletBalance < currentDebt) {
        // If wallet balance is less than debt, use all available balance
        setRepayAmount(walletBalance.toString());
      } else {
        // Otherwise use the full debt amount
        setRepayAmount(currentDebt.toString());
      }
    }
  };

  // Validate form before submission
  const validateForm = (): boolean => {
    if (!wallet.connected) {
      setError("Please connect your wallet first");
      return false;
    }

    if (!repayAmount || parseFloat(repayAmount) <= 0) {
      setError("Please enter a valid repayment amount");
      return false;
    }

    const amount = parseFloat(repayAmount);

    if (currentDebt !== null && amount > currentDebt) {
      setError(
        `You only have ${currentDebt.toFixed(6)} ${selectedAsset} debt to repay`
      );
      return false;
    }

    if (walletBalance !== null && amount > walletBalance) {
      setError(
        `You don't have enough ${selectedAsset} in your wallet. Balance: ${walletBalance.toFixed(
          6
        )}`
      );
      return false;
    }

    if (!obligationId) {
      setError("No debt to repay");
      return false;
    }

    return true;
  };

  // Handle form submission
  const handleSubmit = async () => {
    if (!validateForm() || !wallet.connected) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const amt = parseFloat(repayAmount);
      const coinCfg = COINS[selectedAsset as keyof typeof COINS];

      if (!coinCfg) {
        throw new Error(`Unknown coin: ${selectedAsset}`);
      }

      // Convert to base units using BigInt
      const baseUnits = BigInt(
        Math.floor(amt * Math.pow(10, coinCfg.decimals))
      );

      // Choose the appropriate function based on lock status
      let result;

      if (isObligationLocked) {
        // Will unlock + repay in one go
        console.log("Using unlockAndRepayObligation due to locked obligation");
        result = await unlockAndRepayObligation(
          wallet,
          obligationId!,
          coinCfg.name as any,
          baseUnits,
          false // Not repaying maximum
        );
      } else {
        // Simple repay using client API
        console.log("Using regular repayObligation with client API");
        result = await repayObligation(
          wallet,
          obligationId!,
          coinCfg.name as any,
          baseUnits,
          false // Not repaying maximum
        );
      }

      console.log("Repayment result:", result);

      if (result.success) {
        const successMessage = isObligationLocked
          ? `Successfully unlocked obligation and repaid ${amt} ${selectedAsset}`
          : `Successfully repaid ${amt} ${selectedAsset}`;

        setTransactionResult({
          success: true,
          message: successMessage,
          txHash: result.digest,
          txLink: result.txLink,
        });

        // If a success callback was provided, call it
        if (onSuccess) {
          onSuccess();
        }

        // Update obligation lock status if it was locked and now unlocked
        if (isObligationLocked) {
          setIsObligationLocked(false);
        }

        // Refresh portfolio data after a short delay
        setTimeout(() => {
          fetchUserPortfolioData(obligationId!);
          fetchWalletCoins(); // Also refresh wallet coins
        }, 2000);
      } else {
        setTransactionResult({
          success: false,
          message: `Failed to repay ${amt} ${selectedAsset}`,
          error: result.error,
        });
        setError(result.error || `Transaction failed`);
      }
    } catch (err: any) {
      console.error("Error in repayment transaction:", err);
      setTransactionResult({
        success: false,
        message: `Error repaying ${selectedAsset}`,
        error: err.message || String(err),
      });
      setError(
        err.message || `An error occurred while repaying ${selectedAsset}`
      );
    } finally {
      setIsLoading(false);
    }
  };

  // Debug function to show all coin balances
  const renderCoinBalances = () => {
    if (!accountCoins.length) return "No coins found";

    const relevantCoins = accountCoins.filter(
      (coin) =>
        coin.balance !== "0" &&
        (coin.symbol === selectedAsset ||
          (coin.coinType &&
            COINS[selectedAsset as keyof typeof COINS]?.coinTypes.includes(
              coin.coinType
            )))
    );

    return relevantCoins
      .map((coin, idx) => {
        const decimals =
          coin.decimals ||
          COINS[selectedAsset as keyof typeof COINS]?.decimals ||
          9;
        const humanReadable = Number(coin.balance) / Math.pow(10, decimals);

        return (
          <div key={`coin-${idx}`}>
            {coin.symbol || selectedAsset}: {humanReadable.toFixed(6)}(
            {coin.coinType?.slice(0, 10)}...{coin.coinType?.slice(-4)})
          </div>
        );
      })
      .join("");
  };

  // Don't render if not open
  if (!onClose) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-container borrowing-modal">
        <div className="modal-header">
          <h2>Repay Debt</h2>
          <button className="close-btn" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-body">
          {isLoading ? (
            <div className="loading-container">
              <span className="loader"></span>
              <p>Repaying...</p>
              <p className="small-text">
                This may take a moment while we process your transaction.
              </p>
            </div>
          ) : isInitialLoading ? (
            <div className="loading-container">
              <span className="loader"></span>
              <p>Loading your debt information...</p>
            </div>
          ) : transactionResult ? (
            <div
              className={`result-container ${
                transactionResult.success ? "success" : "error"
              }`}
            >
              <h3>
                {transactionResult.success
                  ? "Transaction Successful"
                  : "Transaction Failed"}
              </h3>
              <p>{transactionResult.message}</p>

              {transactionResult.txHash && (
                <div className="tx-details">
                  <p>
                    Transaction Hash:{" "}
                    <span className="tx-hash">
                      {transactionResult.txHash.slice(0, 10)}...
                      {transactionResult.txHash.slice(-8)}
                    </span>
                  </p>
                  {transactionResult.txLink && (
                    <a
                      href={transactionResult.txLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="tx-link"
                    >
                      View Transaction
                    </a>
                  )}
                </div>
              )}

              {transactionResult.error && (
                <p className="error-message">
                  Error: {transactionResult.error}
                </p>
              )}

              <div className="action-buttons">
                <button
                  className="primary-btn"
                  onClick={
                    transactionResult.success
                      ? onClose
                      : () => setTransactionResult(null)
                  }
                >
                  {transactionResult.success ? "Close" : "Try Again"}
                </button>
              </div>
            </div>
          ) : borrowedAssets.length === 0 ? (
            <div className="no-debt-container">
              <p>
                You don't have any outstanding debt to repay in this obligation.
              </p>
              <button className="primary-btn" onClick={onClose}>
                Close
              </button>
            </div>
          ) : (
            <>
              {isObligationLocked && (
                <div className="locked-obligation-warning">
                  <LockIcon />
                  <div className="warning-text">
                    <strong>This obligation is locked.</strong>
                    <p>
                      The repayment will automatically unlock your obligation
                      and then repay your debt in a single transaction.
                    </p>
                  </div>
                </div>
              )}

              <div className="section-title">
                <h3>Select Asset to Repay</h3>
              </div>

              <div className="asset-selector">
                <div className="asset-options">
                  {borrowedAssets.map((asset, idx) => (
                    <div
                      key={`borrowed-${asset.symbol}-${idx}`}
                      className={`asset-option ${
                        selectedAsset === asset.symbol ? "selected" : ""
                      }`}
                      onClick={() => handleAssetChange(asset.symbol)}
                    >
                      <img
                        src={
                          COINS[asset.symbol as keyof typeof COINS]?.icon ||
                          "/icons/default-coin.svg"
                        }
                        alt={asset.symbol}
                      />
                      {asset.symbol}
                    </div>
                  ))}

                  {/* Only show fallback if we explicitly know there are no borrowed assets */}
                  {borrowedAssets.length === 0 && !isInitialLoading && (
                    <>
                      <div
                        className={`asset-option ${
                          selectedAsset === "SUI" ? "selected" : ""
                        }`}
                        onClick={() => handleAssetChange("SUI")}
                      >
                        <img src="/icons/sui-icon.svg" alt="SUI" />
                        SUI
                      </div>
                      <div
                        className={`asset-option ${
                          selectedAsset === "USDC" ? "selected" : ""
                        }`}
                        onClick={() => handleAssetChange("USDC")}
                      >
                        <img src="/icons/usdc-icon.svg" alt="USDC" />
                        USDC
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="amount-section">
                <div className="label">Amount to Repay</div>
                <div className="input-container">
                  <input
                    type="text"
                    value={repayAmount}
                    onChange={handleAmountChange}
                    placeholder="0.00"
                    className="amount-input"
                  />
                  <div className="button-group">
                    <button
                      className="safe-amount-btn"
                      onClick={handleUseSafeAmount}
                    >
                      Use Safe Amount
                    </button>
                    {currentDebt !== null && currentDebt > 0 && (
                      <button className="max-btn" onClick={handleUseMaxAmount}>
                        Max
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Add obligation ID display if provided */}
              {obligationId && (
                <div className="obligation-info">
                  <div className="info-row">
                    <InfoIcon />
                    <span>
                      Obligation: {obligationId.slice(0, 8)}...
                      {obligationId.slice(-6)}
                      {isObligationLocked && (
                        <span className="locked-indicator"> 🔒 Locked</span>
                      )}
                    </span>
                  </div>
                </div>
              )}

              <div className="info-section">
                <div className="info-row">
                  <InfoIcon />
                  <span>
                    Current {selectedAsset} debt:{" "}
                    {currentDebt !== null
                      ? formatNumber(currentDebt, 6)
                      : "Loading..."}{" "}
                    {selectedAsset}
                  </span>
                </div>
                <div className="info-row">
                  <InfoIcon />
                  <span>
                    Wallet balance:{" "}
                    {walletBalance !== null
                      ? formatNumber(walletBalance, 6)
                      : "Loading..."}{" "}
                    {selectedAsset}
                  </span>
                </div>
                <div className="info-row">
                  <InfoIcon />
                  <span>
                    Current health factor:
                    <span
                      className={`health-factor ${
                        healthFactor !== null && healthFactor < 1.2
                          ? "warning"
                          : healthFactor !== null && healthFactor < 1.5
                          ? "caution"
                          : "good"
                      }`}
                    >
                      {healthFactor !== null
                        ? healthFactor > 99
                          ? "∞"
                          : formatNumber(healthFactor, 2)
                        : "Loading..."}
                    </span>
                  </span>
                </div>
              </div>

              <div className="wallet-status">
                <div className="status-indicator">
                  <span className="status-dot"></span>
                  Connected ({truncateAddress(wallet.address || "")})
                </div>
              </div>

              {error && <div className="error-message">{error}</div>}

              <button
                className={`repay-btn ${
                  isObligationLocked ? "unlock-repay-btn" : ""
                }`}
                onClick={handleSubmit}
                disabled={
                  !wallet.connected ||
                  isLoading ||
                  repayAmount === "" ||
                  !currentDebt ||
                  currentDebt <= 0
                }
              >
                {isObligationLocked
                  ? `Unlock Obligation & Repay ${selectedAsset}`
                  : `Repay ${selectedAsset}`}
              </button>

              <button
                className="debug-btn"
                onClick={() => setShowDebugInfo(!showDebugInfo)}
              >
                {showDebugInfo ? "Hide Debug Info" : "Show Debug Info"}
              </button>

              {showDebugInfo && (
                <div className="debug-info">
                  <p>Obligation ID: {obligationId || "None"}</p>
                  <p>Prop Obligation ID: {propObligationId || "None"}</p>
                  <p>Obligation Locked: {isObligationLocked ? "Yes" : "No"}</p>
                  <p>
                    Current Debt:{" "}
                    {currentDebt !== null ? currentDebt.toFixed(6) : "N/A"}{" "}
                    {selectedAsset}
                  </p>
                  <p>
                    Wallet Balance (Combined):{" "}
                    {walletBalance !== null ? walletBalance.toFixed(6) : "N/A"}{" "}
                    {selectedAsset}
                  </p>
                  <h4>Individual {selectedAsset} Coins:</h4>
                  <div className="coin-list">
                    {accountCoins
                      .filter(
                        (coin) =>
                          coin.balance !== "0" &&
                          (coin.symbol === selectedAsset ||
                            COINS[
                              selectedAsset as keyof typeof COINS
                            ]?.coinTypes.some((type) => coin.coinType === type))
                      )
                      .map((coin, idx) => {
                        const decimals =
                          coin.decimals ||
                          COINS[selectedAsset as keyof typeof COINS]
                            ?.decimals ||
                          9;
                        const humanReadable =
                          Number(coin.balance) / Math.pow(10, decimals);

                        return (
                          <div key={`coin-${idx}`} className="coin-entry">
                            <span className="coin-type">
                              {coin.coinType?.slice(0, 8)}...
                              {coin.coinType?.slice(-6)}
                            </span>
                            <span className="coin-balance">
                              {humanReadable.toFixed(6)}{" "}
                              {coin.symbol || selectedAsset}
                            </span>
                          </div>
                        );
                      })}
                  </div>
                  <p>
                    Health Factor:{" "}
                    {healthFactor !== null ? healthFactor.toFixed(2) : "N/A"}
                  </p>
                  <p>Connected: {wallet.connected ? "Yes" : "No"}</p>
                  <p>Address: {wallet.address || "None"}</p>
                  <p>
                    Borrowed Assets:{" "}
                    {borrowedAssets.map((a) => a.symbol).join(", ") || "None"}
                  </p>
                  <p>Account Coins Count: {accountCoins.length}</p>
                  <p>Is Initial Loading: {isInitialLoading ? "Yes" : "No"}</p>
                </div>
              )}
            </>
          )}
        </div>

        <div className="modal-footer">
          <p className="disclaimer">
            Repaying your debt will reduce your interest costs and improve your
            position's health factor.
            {isObligationLocked &&
              " Since this obligation is locked, repaying will first unlock it."}
          </p>
        </div>
      </div>
    </div>
  );
};

export default RepaymentModal;
