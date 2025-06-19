// src/components/CollateralManagementModal.tsx
// Last updated: 2025-06-18 06:44:43 UTC by jake1318

import React, { useState, useEffect } from "react";
import { useWallet } from "@suiet/wallet-kit";
import scallopService from "../scallop/ScallopService";
import scallopCollateralService from "../scallop/ScallopCollateralService";
import scallopBorrowService from "../scallop/ScallopBorrowService";
import {
  getAccountCoins,
  getCoinBalance,
} from "../services/blockvisionService";
import "../styles/CollateralManagementModal.scss";

// Constants for coin configuration with improved coin type handling
const COINS = {
  SUI: {
    symbol: "SUI",
    decimals: 9,
    name: "sui",
    coinTypes: ["0x2::sui::SUI"],
  },
  USDC: {
    symbol: "USDC",
    decimals: 6,
    name: "usdc",
    coinTypes: [
      "0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN",
      "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
      "0xc3f8927de33d3deb52c282a836082a413bc73c6ee0bd4d7ec7e3b6b4c28e9abf::coin::COIN",
    ],
  },
  USDT: {
    symbol: "USDT",
    decimals: 6,
    name: "usdt",
    coinTypes: [
      "0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN",
      "0x375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT",
    ],
  },
};

// Function to get total balance across multiple coin types
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

// Recommended minimum collateral amounts
const MIN_COLLATERAL_AMOUNTS = {
  SUI: 0.1, // 0.1 SUI
  USDC: 1.0, // 1 USDC
  USDT: 1.0, // 1 USDT
};

interface CollateralManagementModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  asset: {
    symbol: string;
    coinType: string;
    decimals: number;
    price: number;
  };
  action: "deposit-collateral" | "withdraw-collateral";
  hasObligationAccount?: boolean;
  obligationId: string; // Add this to ensure we use a specific obligation
}

const CollateralManagementModal: React.FC<CollateralManagementModalProps> = ({
  open,
  onClose,
  onSuccess,
  asset,
  action,
  hasObligationAccount = false,
  obligationId, // Use this parameter for obligation-specific operations
}) => {
  // Get wallet from Suiet context
  const wallet = useWallet();

  // Form state
  const [collateralAmount, setCollateralAmount] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  // Asset price and portfolio data
  const [assetPrice, setAssetPrice] = useState<number | null>(asset.price);
  const [usdValue, setUsdValue] = useState<string | null>(null);
  const [collateralBalance, setCollateralBalance] = useState<number | null>(
    null
  );
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [isLoadingWallet, setIsLoadingWallet] = useState<boolean>(true);

  // Add state for obligation information
  const [isEmptyObligation, setIsEmptyObligation] = useState<boolean>(false);
  const [obligationData, setObligationData] = useState<any>(null);
  const [accountCoins, setAccountCoins] = useState<any[]>([]);
  const [showDebugInfo, setShowDebugInfo] = useState<boolean>(false);

  // Reset modal state when asset or action changes
  useEffect(() => {
    if (open) {
      resetForm();

      // Set asset price from passed prop
      setAssetPrice(asset.price);

      // Reset loading states
      setIsLoadingWallet(true);

      // Fetch data
      if (wallet.connected && wallet.address) {
        fetchObligationDetails();
        fetchUserCollateral();
        fetchWalletCoins();
      }
    }
  }, [open, asset, action, wallet.connected, wallet.address, obligationId]);

  // Update USD value when amount changes
  useEffect(() => {
    if (assetPrice && collateralAmount && !isNaN(Number(collateralAmount))) {
      const amountNum = Number(collateralAmount);
      setUsdValue((amountNum * assetPrice).toFixed(2));
    } else {
      setUsdValue(null);
    }
  }, [collateralAmount, assetPrice]);

  // Fetch obligation details to check if it's an empty obligation
  const fetchObligationDetails = async () => {
    if (!wallet.address || !obligationId) return;

    try {
      console.log(
        `[fetchObligationDetails] Fetching details for obligation ${obligationId}`
      );
      const result = await scallopBorrowService.getObligationDetails(
        obligationId,
        wallet.address
      );

      if (result.success && result.obligation) {
        setObligationData(result.obligation);

        // Check if this is an empty obligation (no collateral)
        const isEmpty = result.obligation.collaterals.length === 0;
        setIsEmptyObligation(isEmpty);

        console.log(
          `[fetchObligationDetails] Obligation ${obligationId} is empty: ${isEmpty}`
        );

        // Find collateral for the selected asset if not empty
        if (!isEmpty) {
          const assetCollateral = result.obligation.collaterals.find(
            (c: any) => c.symbol.toLowerCase() === asset.symbol.toLowerCase()
          );

          if (assetCollateral) {
            setCollateralBalance(assetCollateral.amount);
            console.log(
              `[fetchObligationDetails] Found ${asset.symbol} collateral balance in obligation:`,
              assetCollateral.amount
            );
          } else {
            setCollateralBalance(0);
            console.log(
              `[fetchObligationDetails] No ${asset.symbol} collateral in this obligation`
            );
          }
        } else {
          setCollateralBalance(0);
        }
      } else {
        console.error(
          "[fetchObligationDetails] Failed to get obligation details:",
          result.error
        );
        setCollateralBalance(0);
      }
    } catch (error) {
      console.error("[fetchObligationDetails] Error:", error);
      setCollateralBalance(0);
    }
  };

  // Fetch user's collateral for the selected asset
  const fetchUserCollateral = async () => {
    try {
      if (!wallet.address) return;

      console.log(
        "[fetchUserCollateral] Fetching collateral data for wallet:",
        wallet.address
      );

      // Get user portfolio data using the combined method
      const portfolioData = await scallopService.fetchUserPositions(
        wallet.address
      );

      if (portfolioData && portfolioData.collateralAssets) {
        // Find collateral for the selected asset
        const assetCollateral = portfolioData.collateralAssets.find(
          (item) => item.symbol.toLowerCase() === asset.symbol.toLowerCase()
        );

        if (assetCollateral) {
          console.log(
            `[fetchUserCollateral] Found ${asset.symbol} collateral balance:`,
            assetCollateral.amount
          );
          // We don't set collateralBalance here anymore as we use the obligation-specific one
        } else {
          console.log(
            `[fetchUserCollateral] No ${asset.symbol} collateral found in portfolio`
          );
        }
      } else {
        console.log(
          "[fetchUserCollateral] No collateral assets found in portfolio data"
        );
      }
    } catch (error) {
      console.error("[fetchUserCollateral] Error:", error);
    }
  };

  // Fetch wallet balance using BlockvisionService
  const fetchWalletCoins = async () => {
    setIsLoadingWallet(true);
    try {
      if (!wallet.address) {
        setIsLoadingWallet(false);
        return;
      }

      console.log(
        "[fetchWalletCoins] Fetching wallet balance from Blockvision for:",
        wallet.address
      );

      // Get coins using the blockvision service
      const coins = await getAccountCoins(wallet.address);
      setAccountCoins(coins);

      console.log("[fetchWalletCoins] Coins fetched:", coins.length);

      // Update the wallet balance for the selected asset
      updateWalletBalance(coins);
    } catch (error) {
      console.error("[fetchWalletCoins] Error getting wallet balance:", error);
      // Fallback to zero
      setWalletBalance(0);
    }
    setIsLoadingWallet(false);
  };

  // Update wallet balance when coins are fetched
  const updateWalletBalance = (coins: any[] = accountCoins) => {
    if (!coins.length) return;

    const coinConfig = COINS[asset.symbol as keyof typeof COINS];
    if (!coinConfig) {
      console.error(`[updateWalletBalance] Unknown coin type: ${asset.symbol}`);
      setWalletBalance(0);
      return;
    }

    // Use new function to get total balance across all possible coin types
    const balance = getTotalCoinBalance(coins, coinConfig);

    console.log(
      `[updateWalletBalance] Balance for ${asset.symbol}: ${balance}`
    );
    setWalletBalance(balance);
  };

  // Reset form state
  const resetForm = () => {
    setCollateralAmount("");
    setError(null);
    setResult(null);
    setTxHash(null);
    setIsLoading(false);
    setCollateralBalance(null);
    setWalletBalance(null);
  };

  // Handle amount change
  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    // Allow only numbers and a single decimal point
    if (value === "" || /^[0-9]*\.?[0-9]*$/.test(value)) {
      setCollateralAmount(value);
      setError(null); // Clear any previous error
    }
  };

  // Validate amount
  const validateAmount = (): boolean => {
    if (!collateralAmount || parseFloat(collateralAmount) <= 0) {
      setError("Amount must be greater than 0");
      return false;
    }

    const amountNum = Number(collateralAmount);

    // Check minimum deposit amount
    if (action === "deposit-collateral") {
      const minAmount =
        MIN_COLLATERAL_AMOUNTS[
          asset.symbol as keyof typeof MIN_COLLATERAL_AMOUNTS
        ] || 0.1;
      if (amountNum < minAmount) {
        setError(`Minimum deposit amount is ${minAmount} ${asset.symbol}`);
        return false;
      }

      // Check wallet balance
      if (walletBalance !== null && amountNum > walletBalance) {
        setError(
          `You only have ${walletBalance.toLocaleString(undefined, {
            maximumFractionDigits: 6,
          })} ${asset.symbol} in your wallet`
        );
        return false;
      }
    } else if (action === "withdraw-collateral") {
      // Check if user has enough collateral
      if (collateralBalance !== null && amountNum > collateralBalance) {
        setError(
          `You only have ${collateralBalance.toLocaleString(undefined, {
            maximumFractionDigits: 6,
          })} ${asset.symbol} as collateral`
        );
        return false;
      }
    }

    return true;
  };

  // Set max amount for deposit/withdraw
  const handleSetMax = () => {
    // For deposit, we use wallet balance
    // For withdraw, we use collateral balance
    if (action === "deposit-collateral" && walletBalance !== null) {
      // Use 95% of balance to account for gas fees
      const maxBalance = Math.floor(walletBalance * 0.95 * 10000) / 10000;
      setCollateralAmount(maxBalance.toString());
    } else if (action === "withdraw-collateral" && collateralBalance !== null) {
      setCollateralAmount(collateralBalance.toString());
    }
  };

  // Get action label
  const getActionLabel = (): string => {
    switch (action) {
      case "deposit-collateral":
        return "Deposit Collateral";
      case "withdraw-collateral":
        return "Withdraw Collateral";
      default:
        return "Submit";
    }
  };

  // Get action verb for UI
  const getActionVerb = (): string => {
    switch (action) {
      case "deposit-collateral":
        return "Depositing collateral";
      case "withdraw-collateral":
        return "Withdrawing collateral";
      default:
        return "Processing";
    }
  };

  // Format number with commas
  const formatNumber = (num: number, decimals: number = 2): string => {
    return num.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  };

  // Perform transaction
  const performTransaction = async () => {
    if (!validateAmount()) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const amountNum = parseFloat(collateralAmount);

      console.log(`[performTransaction] Performing ${action} with:`, {
        amount: amountNum,
        asset: asset.symbol,
        coinType: asset.coinType,
        decimals: asset.decimals,
        obligationId: obligationId,
        walletConnected: !!wallet.connected,
        isEmptyObligation: isEmptyObligation,
      });

      if (!wallet.connected) {
        throw new Error("Wallet not connected");
      }

      // Use the collateral service methods based on the action
      let txResult;
      try {
        if (action === "deposit-collateral") {
          // Use scallopBorrowService.depositCollateral directly with the specific obligation ID
          txResult = await scallopBorrowService.depositCollateral(
            wallet,
            obligationId,
            asset.symbol.toLowerCase() as "usdc" | "sui" | "usdt",
            amountNum,
            asset.decimals
          );
        } else if (action === "withdraw-collateral") {
          // For withdrawals, continue using the previous method
          txResult = await scallopCollateralService.withdrawCollateral(
            wallet,
            asset.coinType,
            amountNum,
            asset.decimals
          );
        } else {
          throw new Error("Invalid action");
        }
      } catch (txError) {
        console.error(
          `[performTransaction] Transaction error in ${action}:`,
          txError
        );
        throw new Error(
          txError instanceof Error
            ? txError.message
            : `Failed to ${
                action === "deposit-collateral" ? "deposit" : "withdraw"
              } collateral`
        );
      }

      console.log(`[performTransaction] ${action} result:`, txResult);

      if (txResult.success) {
        setResult({
          success: true,
          message: `Successfully ${
            action === "deposit-collateral" ? "deposited" : "withdrawn"
          } ${amountNum} ${asset.symbol} ${
            action === "deposit-collateral"
              ? "as collateral"
              : "from collateral"
          }`,
          txHash: txResult.digest,
          txLink:
            txResult.txLink ||
            `https://suivision.xyz/txblock/${txResult.digest}`,
        });
        setTxHash(txResult.digest);

        // If a success callback was provided, call it
        if (onSuccess) {
          onSuccess();
        }

        // Refresh collateral balance and wallet balance after transaction
        setTimeout(() => {
          fetchObligationDetails();
          fetchUserCollateral();
          fetchWalletCoins();
        }, 2000);
      } else {
        setResult({
          success: false,
          message: `Failed to ${
            action === "deposit-collateral" ? "deposit" : "withdraw"
          } ${amountNum} ${asset.symbol} ${
            action === "deposit-collateral"
              ? "as collateral"
              : "from collateral"
          }`,
          error: txResult.error,
        });
        setError(txResult.error || `Transaction failed`);
      }
    } catch (err: any) {
      console.error(`[performTransaction] Error in ${action}:`, err);
      setResult({
        success: false,
        message: `Error ${
          action === "deposit-collateral" ? "depositing" : "withdrawing"
        } ${asset.symbol} ${
          action === "deposit-collateral" ? "as collateral" : "from collateral"
        }`,
        error: err.message || String(err),
      });
      setError(
        err.message ||
          `An error occurred while ${
            action === "deposit-collateral" ? "depositing" : "withdrawing"
          } ${asset.symbol} ${
            action === "deposit-collateral"
              ? "as collateral"
              : "from collateral"
          }`
      );
    } finally {
      setIsLoading(false);
    }
  };

  // Don't render if not open
  if (!open) return null;

  // Modal title based on action
  const modalTitle =
    action === "deposit-collateral"
      ? `Deposit ${asset.symbol} Collateral`
      : `Withdraw ${asset.symbol} Collateral`;

  return (
    <div className="modal-overlay">
      <div className="modal-container collateral-modal">
        <div className="modal-header">
          <h2>{modalTitle}</h2>
          <button className="close-btn" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-body">
          {isLoading ? (
            <div className="loading-container">
              <span className="loader"></span>
              <p>{getActionVerb()}...</p>
              <p className="small-text">
                This may take a moment while we process your transaction.
              </p>
            </div>
          ) : result ? (
            <div
              className={`result-container ${
                result.success ? "success" : "error"
              }`}
            >
              <h3>
                {result.success
                  ? "Transaction Successful"
                  : "Transaction Failed"}
              </h3>
              <p>{result.message}</p>

              {result.txHash && (
                <div className="tx-details">
                  <p>
                    Transaction Hash:{" "}
                    <span className="tx-hash">
                      {result.txHash.slice(0, 10)}...{result.txHash.slice(-8)}
                    </span>
                  </p>
                  {result.txLink && (
                    <a
                      href={result.txLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="tx-link"
                    >
                      View Transaction
                    </a>
                  )}
                </div>
              )}

              {result.error && (
                <p className="error-message">Error: {result.error}</p>
              )}

              <div className="action-buttons">
                <button
                  className="primary-btn"
                  onClick={result.success ? onClose : resetForm}
                >
                  {result.success ? "Close" : "Try Again"}
                </button>

                {result.success && (
                  <button className="secondary-btn" onClick={resetForm}>
                    New Transaction
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* Add banner for empty obligations */}
              {isEmptyObligation && action === "deposit-collateral" && (
                <div className="info-banner">
                  <p>
                    This is a new obligation. Adding collateral will enable
                    borrowing.
                  </p>
                </div>
              )}

              <div className="asset-info">
                <div className="info-row">
                  <span>Asset:</span>
                  <span>{asset.symbol}</span>
                </div>
                <div className="info-row">
                  <span>Price:</span>
                  <span>${assetPrice?.toFixed(4) || "Loading..."}</span>
                </div>
                <div className="info-row">
                  <span>
                    {action === "deposit-collateral"
                      ? "Wallet Balance:"
                      : "Collateral Balance:"}
                  </span>
                  <span>
                    {action === "deposit-collateral"
                      ? isLoadingWallet
                        ? "Loading..."
                        : walletBalance !== null
                        ? `${formatNumber(walletBalance, 6)} ${asset.symbol}`
                        : "0 " + asset.symbol
                      : collateralBalance !== null
                      ? `${formatNumber(collateralBalance, 6)} ${asset.symbol}`
                      : "Loading..."}
                  </span>
                </div>
                <div className="info-row">
                  <span>Obligation ID:</span>
                  <span>
                    {obligationId.slice(0, 8)}...{obligationId.slice(-6)}
                  </span>
                </div>
                <div className="info-row wallet-status">
                  <span>Wallet Status:</span>
                  <span
                    className={wallet.connected ? "connected" : "disconnected"}
                  >
                    {wallet.connected ? (
                      <>
                        <span className="status-dot connected"></span>
                        Connected
                      </>
                    ) : (
                      <>
                        <span className="status-dot disconnected"></span>
                        Disconnected
                      </>
                    )}
                  </span>
                </div>
              </div>

              <div className="amount-input-container">
                <label htmlFor="collateral-amount">
                  {action === "deposit-collateral"
                    ? "Amount to Deposit as Collateral"
                    : "Amount to Withdraw from Collateral"}
                </label>
                <div className="input-with-max">
                  <input
                    type="text"
                    id="collateral-amount"
                    value={collateralAmount}
                    onChange={handleAmountChange}
                    placeholder="0.00"
                    className="amount-input"
                    disabled={isLoading || isLoadingWallet}
                  />
                  <button
                    className="max-btn"
                    onClick={handleSetMax}
                    disabled={
                      isLoading ||
                      isLoadingWallet ||
                      (action === "deposit-collateral"
                        ? walletBalance === null || walletBalance === 0
                        : collateralBalance === null || collateralBalance === 0)
                    }
                  >
                    MAX
                  </button>
                </div>
                {usdValue && (
                  <div className="amount-in-usd">≈ ${usdValue} USD</div>
                )}
              </div>

              {error && <div className="error-message">{error}</div>}

              <div className="collateral-info">
                <p className="info-text">
                  {action === "deposit-collateral" ? (
                    isEmptyObligation ? (
                      <>
                        This obligation has no collateral yet. Adding collateral
                        is required before you can borrow assets. The minimum
                        collateral amount for {asset.symbol} is{" "}
                        {MIN_COLLATERAL_AMOUNTS[
                          asset.symbol as keyof typeof MIN_COLLATERAL_AMOUNTS
                        ] || 0.1}{" "}
                        {asset.symbol}.
                      </>
                    ) : (
                      <>
                        Depositing collateral allows you to borrow assets
                        against it. The minimum collateral amount for{" "}
                        {asset.symbol} is{" "}
                        {MIN_COLLATERAL_AMOUNTS[
                          asset.symbol as keyof typeof MIN_COLLATERAL_AMOUNTS
                        ] || 0.1}{" "}
                        {asset.symbol}.
                      </>
                    )
                  ) : (
                    <>
                      You can withdraw collateral that isn't being used to
                      secure borrowings. If you have active borrows, you may be
                      limited in how much collateral you can withdraw.
                    </>
                  )}
                </p>
              </div>

              <button
                className="submit-btn primary-btn"
                onClick={performTransaction}
                disabled={
                  !wallet.connected ||
                  isLoading ||
                  isLoadingWallet ||
                  collateralAmount === "" ||
                  Number(collateralAmount) <= 0 ||
                  (action === "withdraw-collateral" &&
                    (collateralBalance === null || collateralBalance === 0)) ||
                  (action === "deposit-collateral" &&
                    (walletBalance === null ||
                      Number(collateralAmount) > walletBalance))
                }
              >
                {isLoading ? `${getActionVerb()}...` : getActionLabel()}
              </button>

              {/* Add debug button to see what's going on */}
              <button
                className="debug-btn"
                onClick={() => setShowDebugInfo(!showDebugInfo)}
                style={{ marginTop: "15px", backgroundColor: "#444" }}
              >
                {showDebugInfo ? "Hide Debug Info" : "Show Debug Info"}
              </button>

              {showDebugInfo && (
                <div
                  className="debug-info"
                  style={{
                    marginTop: "15px",
                    padding: "10px",
                    backgroundColor: "#1a1a2e",
                    borderRadius: "5px",
                    fontSize: "12px",
                  }}
                >
                  <p>Asset Symbol: {asset.symbol}</p>
                  <p>Asset Coin Type: {asset.coinType}</p>
                  <p>Obligation ID: {obligationId}</p>
                  <p>Is Empty Obligation: {isEmptyObligation ? "Yes" : "No"}</p>
                  <p>
                    Wallet Balance:{" "}
                    {walletBalance !== null ? walletBalance.toFixed(6) : "N/A"}
                  </p>
                  <p>
                    Collateral Balance:{" "}
                    {collateralBalance !== null
                      ? collateralBalance.toFixed(6)
                      : "N/A"}
                  </p>
                  <p>Account Coins: {accountCoins.length}</p>

                  <h5>Matching Coins:</h5>
                  <div style={{ maxHeight: "150px", overflowY: "auto" }}>
                    {accountCoins
                      .filter(
                        (coin) =>
                          coin.balance !== "0" &&
                          (coin.symbol === asset.symbol ||
                            COINS[
                              asset.symbol as keyof typeof COINS
                            ]?.coinTypes.some((type) => coin.coinType === type))
                      )
                      .map((coin, idx) => {
                        const decimals =
                          coin.decimals ||
                          COINS[asset.symbol as keyof typeof COINS]?.decimals ||
                          9;
                        const humanReadable =
                          Number(coin.balance) / Math.pow(10, decimals);

                        return (
                          <div
                            key={`coin-${idx}`}
                            style={{ marginBottom: "5px" }}
                          >
                            <span style={{ fontWeight: "bold" }}>
                              {coin.coinType?.slice(0, 8)}...
                              {coin.coinType?.slice(-6)}:
                            </span>
                            <span>
                              {" "}
                              {humanReadable.toFixed(6)}{" "}
                              {coin.symbol || asset.symbol}
                            </span>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Last updated timestamp */}
        <div className="last-updated">
          Last updated: 2025-06-18 06:44:43 UTC by jake1318
        </div>
      </div>
    </div>
  );
};

export default CollateralManagementModal;
