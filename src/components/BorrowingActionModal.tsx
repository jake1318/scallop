// src/components/BorrowingActionModal.tsx
// Last Updated: 2025-06-19 01:48:29 UTC by jake1318

import React, { useState, useEffect } from "react";
import { useWallet } from "@suiet/wallet-kit";
import scallopService from "../scallop/ScallopService";
import scallopBorrowService from "../scallop/ScallopBorrowService";
import scallopRepayService from "../scallop/ScallopRepayService";
import { getObligationId } from "../scallop/ScallopCollateralService";
import { unlockObligation } from "../scallop/ScallopIncentiveService";
import { scallop } from "../scallop/ScallopService";
import "../styles/BorrowingActionModal.scss";

// Components to match the screenshot
const ObligationItem = ({
  obligation,
  onUseForBorrow,
  onDepositCollateral,
  onUnstake,
  isUnlocking,
}) => {
  const {
    obligationId,
    collaterals,
    borrows,
    hasBorrowIncentiveStake,
    hasBoostStake,
  } = obligation;
  const hasStake = hasBorrowIncentiveStake || hasBoostStake;

  // Calculate total values
  const totalCollateralUsd = collaterals.reduce((sum, c) => sum + c.usd, 0);
  const totalBorrowsUsd = borrows.reduce((sum, b) => sum + b.usd, 0);

  // Format display for collateral and borrows
  const collateralDisplay =
    collaterals.length > 0
      ? collaterals
          .map(
            (c) =>
              `${formatNumber(c.amount, 2)} ${c.symbol} ($${formatNumber(
                c.usd
              )})`
          )
          .join(", ")
      : "No collateral";

  const borrowsDisplay =
    borrows.length > 0
      ? borrows
          .map(
            (b) =>
              `${formatNumber(b.amount, 2)} ${b.symbol} ($${formatNumber(
                b.usd
              )})`
          )
          .join(", ")
      : "No borrows";

  return (
    <div className="obligation-card">
      <div className="obligation-header">
        <div className="obligation-id">
          ID: {obligation.obligationId.slice(0, 8)}...
          {obligation.obligationId.slice(-4)}
          <span
            className={`status-indicator ${hasStake ? "staked" : "unlocked"}`}
          >
            {hasStake ? "🟠 Staked" : "🟢 Unlocked"}
          </span>
        </div>
      </div>

      <div className="obligation-details">
        <div className="collateral">
          <div className="label">
            Collateral (${formatNumber(totalCollateralUsd)})
          </div>
          <div className="value">{collateralDisplay}</div>
        </div>

        <div className="borrows">
          <div className="label">
            Borrows (${formatNumber(totalBorrowsUsd)})
          </div>
          <div className="value">{borrowsDisplay}</div>
        </div>
      </div>

      <div className="obligation-actions">
        <button
          className="action-btn primary"
          onClick={() => onUseForBorrow(obligation)}
          disabled={hasStake}
        >
          Use for Borrow
        </button>

        <button
          className="action-btn secondary"
          onClick={() => onDepositCollateral(obligation)}
        >
          Deposit Collateral
        </button>

        {hasStake && (
          <button
            className="action-btn warning"
            onClick={() => onUnstake(obligation)}
            disabled={isUnlocking === obligation.obligationId}
          >
            {isUnlocking === obligation.obligationId
              ? "Unstaking..."
              : "Unstake"}
          </button>
        )}
      </div>
    </div>
  );
};

// Simple utility functions since imports aren't available
const formatNumber = (num: number, decimals: number = 2): string => {
  return num.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
};

const truncateAddress = (address: string): string => {
  if (!address) return "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

// Constants for coin configuration
const COINS = {
  SUI: {
    symbol: "SUI",
    name: "sui",
    decimals: 9,
    icon: "/icons/sui-icon.svg",
  },
  USDC: {
    symbol: "USDC",
    name: "usdc",
    decimals: 6,
    icon: "/icons/usdc-icon.svg",
  },
};

// Safe amounts for borrowing
const SAFE_AMOUNTS = {
  borrow: { USDC: 0.1, SUI: 0.01 },
  repay: { USDC: 0.1, SUI: 0.1 },
};

interface BorrowingActionModalProps {
  onClose: () => void;
  onSuccess?: () => void;
  defaultBorrowAmount?: string;
  hasObligation?: boolean;
  mode?: "borrow" | "repay";
  obligationId: string; // Required obligationId prop
}

interface Obligation {
  obligationId: string;
  collaterals: Array<{ symbol: string; amount: number; usd: number }>;
  borrows: Array<{ symbol: string; amount: number; usd: number }>;
  lockType: "boost" | "borrow-incentive" | null;
  lockEnds: number | null;
  hasBorrowIncentiveStake?: boolean;
  hasBoostStake?: boolean;
  isLocked?: boolean;
  isEmpty?: boolean;
  totalCollateralUSD?: number;
  totalBorrowUSD?: number;
  riskLevel?: number;
}

interface DepositModalProps {
  obligationId: string;
  onClose(): void;
  refresh(): void;
}

// Deposit Collateral Modal Component
const DepositModal: React.FC<DepositModalProps> = ({
  obligationId,
  onClose,
  refresh,
}) => {
  const [amount, setAmount] = useState<string>("");
  const [coin, setCoin] = useState<string>("sui");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [depositResult, setDepositResult] = useState<any>(null);
  const wallet = useWallet();

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === "" || /^[0-9]*\.?[0-9]*$/.test(value)) {
      setAmount(value);
      setError(null);
    }
  };

  async function handleDeposit() {
    const amt = Number(amount);
    if (amt <= 0) {
      setError("Please enter a valid amount");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const decimals = coin === "sui" ? 9 : 6;
      // Using explicitly specified obligationId for deposit
      const result = await scallopBorrowService.depositCollateral(
        wallet,
        obligationId,
        coin as "usdc" | "sui" | "usdt",
        amt,
        decimals
      );

      if (result.success) {
        setDepositResult({
          success: true,
          message: `Successfully deposited ${amt} ${coin.toUpperCase()} as collateral`,
          txHash: result.digest,
          txLink: result.txLink,
        });

        // Refresh data after success, but don't close modal yet
        // so the user can see the transaction result
        refresh();
      } else {
        setError(result.error || "Failed to deposit collateral");
      }
    } catch (err) {
      console.error("[Deposit] Error depositing collateral:", err);
      setError(
        err instanceof Error ? err.message : "Failed to deposit collateral"
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-container deposit-modal">
        <div className="modal-header">
          <h2>Deposit Collateral</h2>
          <button className="close-btn" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-body">
          {isLoading ? (
            <div className="loading-container">
              <span className="loader"></span>
              <p>Depositing collateral...</p>
              <p className="small-text">
                This may take a moment while we process your transaction.
              </p>
            </div>
          ) : depositResult ? (
            <div
              className={`result-container ${
                depositResult.success ? "success" : "error"
              }`}
            >
              <h3>Transaction Successful</h3>
              <p>{depositResult.message}</p>

              <div className="tx-details">
                <p>
                  Transaction Hash:{" "}
                  <span className="tx-hash">
                    {depositResult.txHash.slice(0, 10)}...
                    {depositResult.txHash.slice(-8)}
                  </span>
                </p>
                {depositResult.txLink && (
                  <a
                    href={depositResult.txLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="tx-link"
                  >
                    View Transaction
                  </a>
                )}
              </div>

              <button
                className="primary-btn"
                onClick={onClose}
                style={{ marginTop: "15px" }}
              >
                Close
              </button>
            </div>
          ) : (
            <>
              <p className="obligation-info">
                Adding collateral to obligation: {obligationId.slice(0, 6)}...
                {obligationId.slice(-4)}
              </p>

              <div className="asset-selector">
                <h3>Select Asset</h3>
                <div className="asset-options">
                  {Object.entries(COINS).map(([symbol, data]) => (
                    <div
                      key={`deposit-asset-${symbol}`}
                      className={`asset-option ${
                        coin === data.name ? "selected" : ""
                      }`}
                      onClick={() => setCoin(data.name)}
                    >
                      <img
                        src={data.icon}
                        alt={symbol}
                        className="asset-icon"
                      />
                      <span>{symbol}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="amount-input-container">
                <label htmlFor="deposit-amount">Amount to Deposit</label>
                <input
                  type="text"
                  id="deposit-amount"
                  value={amount}
                  onChange={handleAmountChange}
                  placeholder="0.00"
                  disabled={isLoading}
                />
              </div>

              {error && <div className="error-message">{error}</div>}

              <div className="action-buttons">
                <button
                  className="secondary-btn"
                  onClick={onClose}
                  disabled={isLoading}
                >
                  Cancel
                </button>
                <button
                  className="primary-btn"
                  onClick={handleDeposit}
                  disabled={isLoading || !amount || parseFloat(amount) <= 0}
                >
                  {isLoading ? "Depositing..." : "Deposit"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const BorrowingActionModal: React.FC<BorrowingActionModalProps> = ({
  onClose,
  onSuccess,
  defaultBorrowAmount = "",
  hasObligation = false,
  mode = "borrow",
  obligationId, // Use the passed obligationId
}) => {
  const wallet = useWallet();

  // State
  const [actionAmount, setActionAmount] = useState<string>(defaultBorrowAmount);
  const [borrowAsset, setBorrowAsset] = useState<string>("USDC");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [transactionResult, setTransactionResult] = useState<any>(null);
  const [healthFactor, setHealthFactor] = useState<number | null>(null);
  const [userCollateral, setUserCollateral] = useState<any[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState<boolean>(true);
  const [userObligations, setUserObligations] = useState<Obligation[]>([]);
  const [showObligations, setShowObligations] = useState<boolean>(false);
  const [showDepositModal, setShowDepositModal] = useState<boolean>(false);
  const [depositObligationId, setDepositObligationId] = useState<string | null>(
    null
  );
  const [selectedObl, setSelectedObl] = useState<Obligation | null>(null);
  const [unlockingObligationId, setUnlockingObligationId] = useState<
    string | null
  >(null);
  const [unlockResult, setUnlockResult] = useState<any>(null);
  const [isCreatingObligation, setIsCreatingObligation] =
    useState<boolean>(false);
  const [currentView, setCurrentView] = useState<"borrowing" | "obligations">(
    "borrowing"
  );

  // NEW: State to track the external obligationId prop
  const [currentObligationId, setCurrentObligationId] =
    useState<string>(obligationId);

  // NEW: State for max borrow in both USD and tokens
  const [maxBorrowUsd, setMaxBorrowUsd] = useState<number>(0);
  const [maxBorrowTokens, setMaxBorrowTokens] = useState<number>(0);

  // NEW: Update currentObligationId when props change
  useEffect(() => {
    setCurrentObligationId(obligationId);
  }, [obligationId]);

  // Helper function to check if an obligation has collateral
  const hasCollateral = (
    obligation: Obligation | null | undefined
  ): boolean => {
    if (!obligation) return false;

    // Check if the obligation has collateral with value
    return obligation.collaterals.some((c) => c.amount > 0 && c.usd > 0);
  };

  // Get total collateral value from an obligation
  const getTotalCollateralValue = (
    obligation: Obligation | null | undefined
  ): number => {
    if (!obligation) return 0;
    return obligation.totalCollateralUSD || 0;
  };

  // Calculate maximum safe borrow amount based on collateral
  const calculateSafeBorrowAmount = (
    obligation: Obligation | null | undefined,
    assetPrice: number = 1
  ): { usd: number; tokens: number } => {
    if (!obligation) return { usd: 0, tokens: 0 };

    // A conservative health factor - can be adjusted (70% of collateral)
    const healthFactor = 0.7;

    // Calculate max borrow in USD
    const maxBorrowUsd = (obligation.totalCollateralUSD || 0) * healthFactor;

    // Convert USD amount to token amount
    const safeAmount = assetPrice > 0 ? maxBorrowUsd / assetPrice : 0;

    console.log(
      `Calculated max borrow amount: $${maxBorrowUsd.toFixed(
        2
      )} USD (${safeAmount.toFixed(6)} ${borrowAsset})`
    );

    return {
      usd: maxBorrowUsd,
      tokens: safeAmount,
    };
  };

  // Fetch user portfolio data when component mounts
  useEffect(() => {
    if (wallet.connected && wallet.address) {
      setIsInitialLoading(true);
      Promise.all([fetchUserObligations(), fetchUserPortfolioData()]).finally(
        () => {
          setIsInitialLoading(false);
        }
      );
    }
  }, [wallet.connected, wallet.address, borrowAsset]);

  // Check if the current obligation matches one from our list
  useEffect(() => {
    if (currentObligationId && userObligations.length > 0) {
      // Find the obligation in the list that matches our external ID
      const foundObligation = userObligations.find(
        (o) => o.obligationId === currentObligationId
      );

      if (foundObligation) {
        // Update the selected obligation to reflect current state
        setSelectedObl(foundObligation);

        // Get the asset price
        const assetPrice =
          borrowAsset === "USDC" ? 1 : borrowAsset === "SUI" ? 3.0 : 1;

        // Calculate max borrow amounts
        if (foundObligation.collaterals.length > 0) {
          const safeAmountData = calculateSafeBorrowAmount(
            foundObligation,
            assetPrice
          );
          setMaxBorrowUsd(safeAmountData.usd);
          setMaxBorrowTokens(safeAmountData.tokens);

          console.log(
            `Setting max borrow: $${safeAmountData.usd.toFixed(
              2
            )} (${safeAmountData.tokens.toFixed(6)} ${borrowAsset})`
          );
        } else {
          setMaxBorrowUsd(0);
          setMaxBorrowTokens(0);
        }
      }
    }
  }, [userObligations, currentObligationId, borrowAsset]);

  // Fetch user obligations
  const fetchUserObligations = async () => {
    try {
      if (!wallet.address) return;

      const obligations = await scallopBorrowService.getUserObligations(
        wallet.address
      );
      setUserObligations(obligations);

      console.log(
        "%c[BorrowingActionModal] userObligations set to:",
        "color:#ffb300;font-weight:bold",
        JSON.parse(JSON.stringify(obligations))
      );

      // Find the obligation that matches our current ID
      const matchingObligation = obligations.find(
        (o) => o.obligationId === currentObligationId
      );

      if (matchingObligation) {
        setSelectedObl(matchingObligation);
      }
    } catch (err) {
      console.error("Error fetching obligations:", err);
    }
  };

  // Fetch user portfolio data to calculate max borrow amount and current debt
  const fetchUserPortfolioData = async () => {
    try {
      if (!wallet.address) return;

      const userPositions = await scallopService.fetchUserPositions(
        wallet.address
      );
      console.log("User positions:", userPositions);

      // Store collateral assets
      setUserCollateral(userPositions.collateralAssets || []);

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

      // Calculate health factor (simplified)
      let calculatedHealthFactor =
        totalBorrowedUSD > 0
          ? (totalCollateralUSD * 0.8) / totalBorrowedUSD
          : 999;

      // Cap at 999 for display purposes
      calculatedHealthFactor = Math.min(calculatedHealthFactor, 999);
      setHealthFactor(calculatedHealthFactor);
    } catch (err) {
      console.error("Error fetching portfolio data:", err);
    }
  };

  // Handle amount change
  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === "" || /^[0-9]*\.?[0-9]*$/.test(value)) {
      setActionAmount(value);
      setError(null);
    }
  };

  // Handle asset selection
  const handleAssetChange = (asset: string) => {
    setBorrowAsset(asset);
    setActionAmount("");

    // Recalculate max borrow amount for the new asset
    if (selectedObl) {
      const assetPrice = asset === "USDC" ? 1 : asset === "SUI" ? 3.0 : 1;
      const safeAmountData = calculateSafeBorrowAmount(selectedObl, assetPrice);
      setMaxBorrowUsd(safeAmountData.usd);
      setMaxBorrowTokens(safeAmountData.tokens);
    }
  };

  // Use safe amount
  const handleUseSafeAmount = () => {
    // Use the pre-calculated max borrow tokens value
    if (maxBorrowTokens > 0) {
      // Apply a small safety margin to avoid rounding issues
      const safeAmount = maxBorrowTokens * 0.98;
      setActionAmount(safeAmount.toFixed(borrowAsset === "SUI" ? 4 : 2));
    } else {
      // Fallback to the static safe amounts
      const safeAmount = SAFE_AMOUNTS[mode][borrowAsset];
      setActionAmount(safeAmount.toString());
    }
  };

  // Set maximum amount (for repay)
  const handleUseMaxAmount = () => {
    if (mode === "repay" && selectedObl) {
      const borrowedAsset = selectedObl.borrows.find(
        (b) => b.symbol === borrowAsset
      );
      if (borrowedAsset) {
        setActionAmount(borrowedAsset.amount.toString());
      }
    }
  };

  // Check if obligation is locked
  const isObligationLocked = () => {
    if (!selectedObl) return false;
    return selectedObl.hasBorrowIncentiveStake || selectedObl.hasBoostStake;
  };

  // Validate form before submission
  const validateForm = (): boolean => {
    if (!wallet.connected) {
      setError("Please connect your wallet first");
      return false;
    }

    if (!actionAmount || parseFloat(actionAmount) <= 0) {
      setError(`Please enter a valid ${mode} amount`);
      return false;
    }

    const amount = parseFloat(actionAmount);

    if (mode === "borrow") {
      // Check if the selected obligation has collateral
      if (!selectedObl || !hasCollateral(selectedObl)) {
        setError(
          "This obligation has no collateral. Please add collateral first."
        );
        return false;
      }

      // Check if the obligation is locked
      if (isObligationLocked()) {
        setError("This obligation is locked. Please unstake it first.");
        return false;
      }

      // Check against maximum borrow amount
      if (maxBorrowTokens > 0 && amount > maxBorrowTokens) {
        setError(
          `Maximum safe borrow amount is ${formatNumber(
            maxBorrowTokens,
            4
          )} ${borrowAsset} (≈ $${formatNumber(maxBorrowUsd, 2)})`
        );
        return false;
      }

      // Minimum borrow check
      const minBorrowAmount = borrowAsset === "USDC" ? 0.01 : 0.01;
      if (amount < minBorrowAmount) {
        setError(`Minimum borrow amount is ${minBorrowAmount} ${borrowAsset}`);
        return false;
      }
    }

    if (mode === "repay") {
      // Get the borrowed amount of this asset
      if (selectedObl) {
        const borrowedAsset = selectedObl.borrows.find(
          (b) => b.symbol === borrowAsset
        );
        if (borrowedAsset && amount > borrowedAsset.amount) {
          setError(
            `You only have ${borrowedAsset.amount.toFixed(
              6
            )} ${borrowAsset} debt to repay`
          );
          return false;
        }
      }
    }

    return true;
  };

  // Handle unlock/unstaking of the obligation
  const handleUnlockObligation = async () => {
    if (!selectedObl) return;

    setIsLoading(true);
    setError(null);

    try {
      // Use the unified unlockObligation function that detects the lock type
      const result = await unlockObligation(
        wallet,
        currentObligationId,
        selectedObl.lockType
      );

      if (result.success) {
        setUnlockResult({
          success: true,
          message: `Successfully unlocked obligation ${currentObligationId.slice(
            0,
            6
          )}...${currentObligationId.slice(-4)}`,
          txHash: result.digest,
          txLink: result.txLink,
        });

        // Refresh obligation data
        fetchUserObligations();
      } else {
        setError(`Failed to unlock obligation: ${result.error}`);
      }
    } catch (err) {
      console.error("Error unlocking obligation:", err);
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(`Error unlocking obligation: ${errorMsg}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle adding collateral
  const handleAddCollateral = () => {
    if (selectedObl) {
      openDepositModal(selectedObl);
    }
  };

  // Handle form submission
  const handleSubmit = async () => {
    if (!validateForm() || !wallet.connected) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const amt = parseFloat(actionAmount);
      const selectedCoin = COINS[borrowAsset];

      let result;
      if (mode === "borrow") {
        // Always use the externally provided obligationId
        result = await scallopBorrowService.borrowFromObligation(
          wallet,
          currentObligationId, // Use the current obligation ID from props
          selectedCoin.name as "usdc" | "sui" | "usdt",
          amt,
          selectedCoin.decimals
        );
      } else {
        // For repay, also use the obligationId if needed
        result = await scallopRepayService.repay(
          wallet,
          selectedCoin.name as "usdc" | "sui" | "usdt",
          amt,
          selectedCoin.decimals,
          currentObligationId // Pass obligation ID to repay service if it supports it
        );
      }

      if (result.success) {
        setTransactionResult({
          success: true,
          message: `Successfully ${
            mode === "borrow" ? "borrowed" : "repaid"
          } ${amt} ${borrowAsset}`,
          txHash: result.digest,
          txLink: result.txLink,
        });

        if (onSuccess) {
          onSuccess();
        }

        setTimeout(() => {
          fetchUserPortfolioData();
          fetchUserObligations();
        }, 2000);
      } else {
        setTransactionResult({
          success: false,
          message: `Failed to ${
            mode === "borrow" ? "borrow" : "repay"
          } ${amt} ${borrowAsset}`,
          error: result.error,
        });
        setError(result.error || `Transaction failed`);
      }
    } catch (err: any) {
      console.error(`Error in ${mode} transaction:`, err);
      setTransactionResult({
        success: false,
        message: `Error ${
          mode === "borrow" ? "borrowing" : "repaying"
        } ${borrowAsset}`,
        error: err.message || String(err),
      });
      setError(err.message || `An error occurred`);
    } finally {
      setIsLoading(false);
    }
  };

  // Render Obligations View with separate sections for empty and used obligations
  const renderObligationsView = () => {
    // Extract unused/empty obligations
    const emptyObligations = userObligations.filter(
      (ob) => ob.isEmpty && !ob.isLocked
    );
    const usedObligations = userObligations.filter(
      (ob) => !ob.isEmpty || ob.isLocked
    );

    return (
      <div className="modal-obligations-view">
        <h2>Your Obligations</h2>

        {error && <div className="error-message">{error}</div>}

        {unlockResult && (
          <div
            className={`result-message ${
              unlockResult.success ? "success" : "error"
            }`}
          >
            <p>{unlockResult.message}</p>
            {unlockResult.txLink && (
              <a
                href={unlockResult.txLink}
                target="_blank"
                rel="noopener noreferrer"
              >
                View Transaction
              </a>
            )}
          </div>
        )}

        {/* Create Obligation Button - Above the obligation cards */}
        <div className="create-obligation-container">
          <button
            className="create-obligation-btn"
            onClick={handleCreateObligation}
            disabled={isCreatingObligation || !wallet.connected}
          >
            {isCreatingObligation ? "Creating..." : "Create New Obligation"}
          </button>
        </div>

        {/* Display Empty/Unused Obligations First */}
        {emptyObligations.length > 0 && (
          <>
            <h3 className="obligations-section-title">
              New / Unused Obligations
            </h3>
            <div className="obligations-list">
              {emptyObligations.map((obligation) => (
                <div
                  key={obligation.obligationId}
                  className="obligation-card unused"
                >
                  <div className="obligation-header">
                    <div className="obligation-id">
                      ID: {obligation.obligationId.slice(0, 8)}...
                      {obligation.obligationId.slice(-4)}
                    </div>
                    <div className="status unlocked">🟢 Unused</div>
                  </div>

                  <div className="obligation-details">
                    <div className="collateral-section">
                      <div className="label">Collateral ($0.00)</div>
                      <div className="value">No collateral yet</div>
                    </div>

                    <div className="borrows-section">
                      <div className="label">Borrows ($0.00)</div>
                      <div className="value">No borrows yet</div>
                    </div>
                  </div>

                  <div className="action-buttons">
                    <button
                      className="action-btn borrow-btn"
                      onClick={() => {
                        setSelectedObl(obligation);
                        setCurrentView("borrowing");
                      }}
                      disabled={
                        obligation.hasBorrowIncentiveStake ||
                        obligation.hasBoostStake
                      }
                    >
                      Use for Borrow
                    </button>

                    <button
                      className="action-btn deposit-btn"
                      onClick={() => openDepositModal(obligation)}
                    >
                      Deposit Collateral
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Regular/Used Obligations */}
        {usedObligations.length > 0 && (
          <>
            {emptyObligations.length > 0 && (
              <h3 className="obligations-section-title">Active Obligations</h3>
            )}
            <div className="obligations-list">
              {usedObligations.map((obligation) => (
                <div key={obligation.obligationId} className="obligation-card">
                  <div className="obligation-header">
                    <div className="obligation-id">
                      ID: {obligation.obligationId.slice(0, 8)}...
                      {obligation.obligationId.slice(-4)}
                    </div>
                    <div
                      className={`status ${
                        obligation.hasBorrowIncentiveStake ||
                        obligation.hasBoostStake
                          ? "staked"
                          : "unlocked"
                      }`}
                    >
                      {obligation.hasBorrowIncentiveStake ||
                      obligation.hasBoostStake
                        ? "🟠 Staked"
                        : "🟢 Unlocked"}
                    </div>
                  </div>

                  <div className="obligation-details">
                    <div className="collateral-section">
                      <div className="label">
                        Collateral ($
                        {formatNumber(
                          obligation.collaterals.reduce(
                            (sum, c) => sum + c.usd,
                            0
                          )
                        )}
                        )
                      </div>
                      <div className="value">
                        {obligation.collaterals.length > 0
                          ? obligation.collaterals.map((c, idx) => (
                              <div key={idx}>
                                {formatNumber(c.amount)} {c.symbol} ($
                                {formatNumber(c.usd)})
                              </div>
                            ))
                          : "No collateral"}
                      </div>
                    </div>

                    <div className="borrows-section">
                      <div className="label">
                        Borrows ($
                        {formatNumber(
                          obligation.borrows.reduce((sum, b) => sum + b.usd, 0)
                        )}
                        )
                      </div>
                      <div className="value">
                        {obligation.borrows.length > 0
                          ? obligation.borrows.map((b, idx) => (
                              <div key={idx}>
                                {formatNumber(b.amount)} {b.symbol} ($
                                {formatNumber(b.usd)})
                              </div>
                            ))
                          : "No borrows"}
                      </div>
                    </div>
                  </div>

                  <div className="action-buttons">
                    <button
                      className="action-btn borrow-btn"
                      onClick={() => {
                        setSelectedObl(obligation);
                        setCurrentView("borrowing");
                      }}
                      disabled={
                        obligation.hasBorrowIncentiveStake ||
                        obligation.hasBoostStake
                      }
                    >
                      Use for Borrow
                    </button>

                    <button
                      className="action-btn deposit-btn"
                      onClick={() => openDepositModal(obligation)}
                    >
                      Deposit Collateral
                    </button>

                    {/* Unstake button - only show for staked obligations */}
                    {(obligation.hasBorrowIncentiveStake ||
                      obligation.hasBoostStake) && (
                      <button
                        className="action-btn unstake-btn"
                        onClick={() => handleUnlockObligation()}
                        disabled={isLoading}
                      >
                        {isLoading ? "Unstaking..." : "Unstake"}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {userObligations.length === 0 && (
          <div className="no-obligations">
            <p>You don't have any obligations yet.</p>
          </div>
        )}

        <div className="modal-footer-buttons">
          <button
            className="primary-btn back-btn"
            onClick={() => setCurrentView("borrowing")}
          >
            Back to Borrowing
          </button>
        </div>
      </div>
    );
  };

  // Handle opening the deposit modal
  const openDepositModal = (obligation: Obligation) => {
    setDepositObligationId(obligation.obligationId);
    setShowDepositModal(true);
  };

  // Handle creation of a new obligation
  const handleCreateObligation = async () => {
    if (!wallet.connected) {
      setError("Please connect your wallet first");
      return;
    }

    setIsCreatingObligation(true);
    setError(null);

    try {
      const result = await scallopBorrowService.createObligation(wallet);

      if (result.success) {
        console.log("Successfully created obligation:", result);

        // Refresh obligations
        await fetchUserObligations();

        setUnlockResult({
          success: true,
          message: `Successfully created new obligation ${
            result.obligationId
              ? `${result.obligationId.slice(
                  0,
                  6
                )}...${result.obligationId.slice(-4)}`
              : ""
          }`,
          txHash: result.digest,
          txLink: result.txLink,
        });

        setTimeout(() => {
          setUnlockResult(null);
        }, 5000);
      } else {
        setError(`Failed to create obligation: ${result.error}`);
      }
    } catch (err) {
      console.error("Error creating obligation:", err);
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(`Error creating obligation: ${errorMsg}`);
    } finally {
      setIsCreatingObligation(false);
    }
  };

  // Refresh data
  const refreshData = () => {
    fetchUserObligations();
    fetchUserPortfolioData();
  };

  if (!onClose) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-container borrowing-modal">
        <div className="modal-header">
          <h2>
            {currentView === "borrowing"
              ? mode === "borrow"
                ? "Borrow Assets"
                : "Repay Debt"
              : "Your Obligations"}
          </h2>
          <button className="close-btn" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-body">
          {showDepositModal && depositObligationId && (
            <DepositModal
              obligationId={depositObligationId}
              onClose={() => {
                setShowDepositModal(false);
                setDepositObligationId(null);
              }}
              refresh={refreshData}
            />
          )}

          {isLoading || isInitialLoading ? (
            <div className="loading-container">
              <span className="loader"></span>
              <p>
                {isLoading
                  ? `${mode === "borrow" ? "Borrowing" : "Repaying"}...`
                  : "Loading your account data..."}
              </p>
              <p className="small-text">
                This may take a moment while we process your transaction.
              </p>
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
          ) : currentView === "obligations" ? (
            renderObligationsView()
          ) : (
            <div className="borrowing-view">
              {/* Show the active obligation from props */}
              <div className="selected-obligation">
                <div className="obligation-header">
                  <p className="obligation-info">
                    Using obligation: {currentObligationId.slice(0, 8)}...
                    {currentObligationId.slice(-4)}
                    {selectedObl?.isLocked && (
                      <span className="locked-indicator"> 🔒 Locked</span>
                    )}
                  </p>
                  <button
                    className="change-btn"
                    onClick={() => setCurrentView("obligations")}
                  >
                    Change
                  </button>
                </div>

                {/* Display collateral details if available */}
                {selectedObl && selectedObl.collaterals.length > 0 && (
                  <div className="collateral-details">
                    <h4>Collateral in this obligation:</h4>
                    <ul className="collateral-list">
                      {selectedObl.collaterals.map((c, idx) => (
                        <li key={idx}>
                          {formatNumber(c.amount, 4)} {c.symbol} ($
                          {formatNumber(c.usd, 2)})
                        </li>
                      ))}
                    </ul>
                    <p>
                      Total value: $
                      {formatNumber(getTotalCollateralValue(selectedObl), 2)}
                    </p>
                  </div>
                )}

                {/* Show unlock button directly if the obligation is locked */}
                {selectedObl?.isLocked && (
                  <div className="unlock-prompt">
                    <p>
                      This obligation is locked. You need to unstake it before
                      borrowing.
                    </p>
                    <button
                      className="unstake-btn"
                      onClick={handleUnlockObligation}
                      disabled={isLoading}
                    >
                      {isLoading ? "Unstaking..." : "Unstake Obligation"}
                    </button>
                  </div>
                )}

                {/* Show add collateral button if no collateral */}
                {selectedObl && !hasCollateral(selectedObl) && (
                  <div className="no-collateral-prompt">
                    <p>
                      This obligation has no collateral. You need to add some
                      before borrowing.
                    </p>
                    <button
                      className="deposit-btn"
                      onClick={handleAddCollateral}
                    >
                      Add Collateral
                    </button>
                  </div>
                )}
              </div>

              {/* Asset selector and rest of the UI */}
              <div className="asset-selector">
                <h3>
                  Select Asset to {mode === "borrow" ? "Borrow" : "Repay"}
                </h3>
                <div className="asset-options">
                  {Object.entries(COINS).map(([symbol, data]) => (
                    <div
                      key={symbol}
                      className={`asset-option ${
                        borrowAsset === symbol ? "selected" : ""
                      }`}
                      onClick={() => handleAssetChange(symbol)}
                    >
                      <img
                        src={data.icon}
                        alt={symbol}
                        className="asset-icon"
                      />
                      <span>{symbol}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="amount-input-container">
                <label htmlFor="borrow-amount">
                  {mode === "borrow" ? "Amount to Borrow" : "Amount to Repay"}
                </label>
                <div className="input-with-btn">
                  <input
                    type="text"
                    id="borrow-amount"
                    value={actionAmount}
                    onChange={handleAmountChange}
                    placeholder="0.00"
                    disabled={
                      isLoading ||
                      (mode === "borrow" && !hasCollateral(selectedObl))
                    }
                  />
                  <div className="amount-actions">
                    {selectedObl && hasCollateral(selectedObl) && (
                      <button
                        className="safe-btn"
                        onClick={handleUseSafeAmount}
                        disabled={isLoading || maxBorrowTokens <= 0}
                      >
                        Use Safe Amount
                      </button>
                    )}
                    {mode === "repay" &&
                      selectedObl?.borrows.some(
                        (b) => b.symbol === borrowAsset
                      ) && (
                        <button
                          className="max-btn"
                          onClick={handleUseMaxAmount}
                          disabled={isLoading}
                        >
                          Max
                        </button>
                      )}
                  </div>
                </div>
              </div>

              {/* Info sections */}
              {mode === "borrow" &&
                selectedObl &&
                hasCollateral(selectedObl) && (
                  <div className="info-container">
                    <div className="info-row">
                      <span className="info-icon">ℹ️</span>
                      <span>
                        Maximum safe borrow amount: $
                        {maxBorrowUsd > 0
                          ? formatNumber(maxBorrowUsd, 2)
                          : "0.00"}
                      </span>
                    </div>
                    <div className="info-row">
                      <span className="info-icon">ℹ️</span>
                      <span>
                        Maximum {borrowAsset}:{" "}
                        {maxBorrowTokens > 0
                          ? formatNumber(maxBorrowTokens, 6)
                          : "0.00"}
                      </span>
                    </div>
                    <div className="info-row">
                      <span className="info-icon">ℹ️</span>
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
                )}

              {error && <div className="error-message">{error}</div>}

              {unlockResult && (
                <div
                  className={`result-message ${
                    unlockResult.success ? "success" : "error"
                  }`}
                >
                  <p>{unlockResult.message}</p>
                  {unlockResult.txLink && (
                    <a
                      href={unlockResult.txLink}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      View Transaction
                    </a>
                  )}
                </div>
              )}

              {mode === "borrow" && !hasCollateral(selectedObl) ? (
                <button
                  className="submit-btn add-collateral-btn"
                  onClick={handleAddCollateral}
                >
                  Add Collateral First
                </button>
              ) : (
                <button
                  className="submit-btn"
                  onClick={handleSubmit}
                  disabled={
                    !wallet.connected ||
                    isLoading ||
                    actionAmount === "" ||
                    parseFloat(actionAmount) <= 0 ||
                    (mode === "borrow" && !hasCollateral(selectedObl)) ||
                    (mode === "borrow" && isObligationLocked())
                  }
                >
                  {mode === "borrow" && isObligationLocked()
                    ? "Obligation Locked - Unstake First"
                    : `${
                        mode === "borrow" ? "Borrow" : "Repay"
                      } ${borrowAsset}`}
                </button>
              )}

              {maxBorrowUsd <= 0 &&
                selectedObl &&
                mode === "borrow" &&
                hasCollateral(selectedObl) && (
                  <div className="warning-message">
                    Maximum safe borrow amount is approximately $0.00. This
                    could mean either your collateral value is too low or an
                    issue accessing the price feed.
                  </div>
                )}

              <p className="disclaimer">
                {mode === "borrow"
                  ? "Borrowing incurs interest that will need to be repaid. Ensure you maintain sufficient collateral to avoid liquidation."
                  : "Repaying your debt will reduce your interest costs and improve your position's health factor."}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BorrowingActionModal;
