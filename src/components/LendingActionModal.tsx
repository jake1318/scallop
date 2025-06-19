// LendingActionModal.tsx
// Last Updated: 2025-06-13 01:45:46 UTC by jake1318

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useWallet } from "@suiet/wallet-kit";
import scallopService from "../scallop/ScallopService";
import {
  getAccountCoins,
  getCoinBalance,
} from "../services/blockvisionService";
import "../styles/LendingActionModal.scss";

interface AssetInfo {
  symbol: string;
  coinType: string;
  depositApy: number;
  borrowApy: number;
  decimals: number;
  price: number;
  suppliedAmount?: number; // Optional - amount user has supplied
}

interface LendingActionModalProps {
  open: boolean;
  onClose: () => void;
  asset: AssetInfo;
  action: "deposit" | "withdraw" | "borrow" | "repay" | "claim";
  onSuccess?: () => void;
}

const LendingActionModal: React.FC<LendingActionModalProps> = ({
  open,
  onClose,
  asset,
  action,
  onSuccess,
}) => {
  const [amount, setAmount] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [isMaxAmount, setIsMaxAmount] = useState(false);

  // Get the full wallet object
  const wallet = useWallet();

  // -----------------------------------------------------------------
  // Fetch wallet balance whenever:
  //   • the modal opens
  //   • the connected account changes
  //   • the asset being shown changes
  // -----------------------------------------------------------------
  const refreshBalance = useCallback(async () => {
    try {
      if (!wallet.connected) return setWalletBalance(null);

      const coins = await getAccountCoins(wallet.address as string);
      const bal = getCoinBalance(coins, asset.coinType, asset.decimals);
      setWalletBalance(bal);
    } catch (e) {
      console.warn("Could not fetch wallet balance:", e);
      setWalletBalance(null); // show "—" in UI on failure
    }
  }, [wallet.connected, wallet.address, asset.coinType, asset.decimals]);

  useEffect(() => {
    if (open) {
      refreshBalance();
      setIsMaxAmount(false); // Reset MAX flag when modal opens
    }
  }, [open, refreshBalance]);

  // -----------------------------------------------------------------
  // Helpers now rely on the fetched balance
  // -----------------------------------------------------------------
  const maxAmount = useMemo(() => {
    if (action === "deposit") return walletBalance ?? 0;
    if (action === "withdraw") return asset.suppliedAmount ?? 0;
    if (action === "borrow") return 0; // TODO: use HF
    return 0; // repay
  }, [action, walletBalance, asset.suppliedAmount]);

  // Handle amount change
  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    // Allow only numbers and a single decimal point
    if (value === "" || /^[0-9]*\.?[0-9]*$/.test(value)) {
      setAmount(value);
      setError(null); // Clear any previous error

      // Check if this amount equals the max amount (within a small epsilon)
      const parsedAmount = parseFloat(value);
      setIsMaxAmount(Math.abs(parsedAmount - maxAmount) < 0.000001);
    }
  };

  // Validate amount
  const validateAmount = (): boolean => {
    if (!amount || parseFloat(amount) <= 0) {
      setError("Amount must be greater than 0");
      return false;
    }

    if (action === "deposit" && walletBalance != null) {
      if (parseFloat(amount) > walletBalance) {
        setError("Amount exceeds wallet balance");
        return false;
      }
    }

    // Add other validation rules as needed
    return true;
  };

  // Set maximum amount
  const handleSetMax = () => {
    setAmount(maxAmount.toString());
    setIsMaxAmount(true); // Set the MAX flag when MAX button is clicked
  };

  // Get action label
  const getActionLabel = (): string => {
    switch (action) {
      case "deposit":
        return "Deposit";
      case "withdraw":
        return "Withdraw";
      case "borrow":
        return "Borrow";
      case "repay":
        return "Repay";
      case "claim":
        return "Claim";
      default:
        return "Submit";
    }
  };

  // Get action verb for UI
  const getActionVerb = (): string => {
    switch (action) {
      case "deposit":
        return "Depositing";
      case "withdraw":
        return "Withdrawing";
      case "borrow":
        return "Borrowing";
      case "repay":
        return "Repaying";
      case "claim":
        return "Claiming";
      default:
        return "Processing";
    }
  };

  const resetForm = () => {
    setAmount("");
    setError(null);
    setResult(null);
    setTxHash(null);
    setLoading(false);
    setIsMaxAmount(false);
  };

  // Handle the lending action
  const performTransaction = async () => {
    if (action !== "claim" && !validateAmount()) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const amountNum = parseFloat(amount);

      console.log(`Performing ${action} with:`, {
        amount: action !== "claim" ? amountNum : "N/A",
        asset: asset.symbol,
        coinType: asset.coinType,
        decimals: asset.decimals,
        walletConnected: !!wallet.connected,
        isMax: isMaxAmount,
      });

      if (!wallet.connected) {
        throw new Error("Wallet is not connected");
      }

      // Pass the entire wallet object instead of just the signer
      let txResult;

      switch (action) {
        case "deposit":
          txResult = await scallopService.supply(
            wallet,
            asset.coinType,
            amountNum,
            asset.decimals
          );
          break;
        case "withdraw":
          // Pass the isMax flag to help with withdraw strategy selection
          txResult = await scallopService.withdraw(
            wallet,
            asset.coinType,
            amountNum,
            asset.decimals,
            isMaxAmount
          );
          break;
        case "borrow":
          txResult = await scallopService.borrow(
            wallet,
            asset.coinType,
            amountNum,
            asset.decimals
          );
          break;
        case "repay":
          txResult = await scallopService.repay(
            wallet,
            asset.coinType,
            amountNum,
            asset.decimals
          );
          break;
        case "claim":
          txResult = await scallopService.claimSupplyRewards(wallet);
          break;
        default:
          throw new Error("Invalid action");
      }

      console.log(`${action} result:`, txResult);

      if (txResult.success) {
        setResult({
          success: true,
          message:
            action === "claim"
              ? `Successfully claimed rewards`
              : `Successfully ${action}ed ${amountNum} ${asset.symbol}`,
          txHash: txResult.digest,
          txLink: txResult.txLink,
        });
        setTxHash(txResult.digest);

        // If a success callback was provided, call it
        if (onSuccess) {
          onSuccess();
        }
      } else {
        setResult({
          success: false,
          message:
            action === "claim"
              ? `Failed to claim rewards`
              : `Failed to ${action} ${amountNum} ${asset.symbol}`,
          error: txResult.error,
        });
        setError(txResult.error || `Transaction failed`);
      }
    } catch (err: any) {
      console.error(`Error in ${action}:`, err);
      setResult({
        success: false,
        message:
          action === "claim"
            ? `Error claiming rewards`
            : `Error ${action}ing ${asset.symbol}`,
        error: err.message || String(err),
      });
      setError(
        err.message || `An error occurred while ${action}ing ${asset.symbol}`
      );
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return null;
  }

  return (
    <div className="modal-overlay">
      <div className="modal-container">
        <div className="modal-header">
          <h2>
            {getActionLabel()} {action !== "claim" ? asset.symbol : "Rewards"}
          </h2>
          <button className="close-btn" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-body">
          {result ? (
            <div
              className={`result-container ${
                result.success ? "success" : "error"
              }`}
            >
              <h3>
                {result.success
                  ? "Transaction Submitted"
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
              <div className="asset-info">
                <div className="info-row">
                  <span>Asset:</span>
                  <span>{asset.symbol}</span>
                </div>
                <div className="info-row">
                  <span>Price:</span>
                  <span>${asset.price.toFixed(4)}</span>
                </div>
                {action === "deposit" && (
                  <>
                    <div className="info-row">
                      <span>Supply APY:</span>
                      <span>{asset.depositApy.toFixed(2)}%</span>
                    </div>
                    <div className="info-row">
                      <span>Wallet Balance:</span>
                      <span>
                        {walletBalance == null
                          ? "—"
                          : `${walletBalance.toFixed(4)} ${asset.symbol}`}
                      </span>
                    </div>
                  </>
                )}
                {action === "withdraw" &&
                  asset.suppliedAmount !== undefined && (
                    <div className="info-row">
                      <span>Supplied Balance:</span>
                      <span>
                        {asset.suppliedAmount.toFixed(4)} {asset.symbol}
                      </span>
                    </div>
                  )}
                {action === "borrow" && (
                  <div className="info-row">
                    <span>Borrow APY:</span>
                    <span>{asset.borrowApy.toFixed(2)}%</span>
                  </div>
                )}
              </div>

              {action !== "claim" && (
                <div className="amount-input-container">
                  <label htmlFor="amount">Amount</label>
                  <div className="input-with-max">
                    <input
                      type="text"
                      id="amount"
                      value={amount}
                      onChange={handleAmountChange}
                      placeholder="0.00"
                      disabled={loading}
                    />
                    <button
                      className="max-btn"
                      onClick={handleSetMax}
                      disabled={loading}
                    >
                      MAX
                    </button>
                  </div>
                  <div className="amount-in-usd">
                    ≈ ${(parseFloat(amount || "0") * asset.price).toFixed(2)}
                  </div>

                  {/* Add a hint for withdraw that using MAX is more reliable */}
                  {action === "withdraw" && !isMaxAmount && (
                    <div className="hint-text">
                      For most reliable withdrawals, we recommend using MAX
                    </div>
                  )}
                </div>
              )}

              {error && <div className="error-message">{error}</div>}

              <button
                className="submit-btn"
                onClick={performTransaction}
                disabled={
                  loading ||
                  (action !== "claim" && (!amount || parseFloat(amount) <= 0))
                }
              >
                {loading ? `${getActionVerb()}...` : getActionLabel()}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default LendingActionModal;
