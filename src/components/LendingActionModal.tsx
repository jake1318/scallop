import React, { useState } from "react";
import { useWallet } from "@suiet/wallet-kit";
import scallopService from "../scallop/ScallopService";
import "../styles/LendingActionModal.scss";

interface AssetInfo {
  symbol: string;
  coinType: string;
  depositApy: number;
  borrowApy: number;
  decimals: number;
  price: number;
}

interface LendingActionModalProps {
  open: boolean;
  onClose: () => void;
  asset: AssetInfo;
  action: "deposit" | "withdraw" | "borrow" | "repay";
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

  // Get the full wallet object
  const wallet = useWallet();

  // Handle amount change
  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    // Allow only numbers and a single decimal point
    if (value === "" || /^[0-9]*\.?[0-9]*$/.test(value)) {
      setAmount(value);
      setError(null); // Clear any previous error
    }
  };

  // Validate amount
  const validateAmount = (): boolean => {
    if (!amount || parseFloat(amount) <= 0) {
      setError("Amount must be greater than 0");
      return false;
    }

    // Add other validation rules as needed
    return true;
  };

  const getMaxAmount = (): string => {
    // This is placeholder logic, you'd need to implement proper max amount
    // calculations based on your business rules
    if (action === "deposit") {
      // Max deposit might be limited by the wallet balance
      return "10"; // Example
    } else if (action === "withdraw") {
      // Max withdraw would be the user's supplied balance
      return "5"; // Example
    } else if (action === "borrow") {
      // Max borrow might be limited by collateral
      return "2"; // Example
    } else {
      // Max repay would be the user's borrowed balance
      return "1"; // Example
    }
  };

  // Set maximum amount
  const handleSetMax = () => {
    setAmount(getMaxAmount());
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
  };

  // Handle the lending action
  const performTransaction = async () => {
    if (!validateAmount()) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const amountNum = parseFloat(amount);

      console.log(`Performing ${action} with:`, {
        amount: amountNum,
        asset: asset.symbol,
        coinType: asset.coinType,
        decimals: asset.decimals,
        walletConnected: !!wallet.connected,
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
          txResult = await scallopService.withdraw(
            wallet,
            asset.coinType,
            amountNum,
            asset.decimals
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
        default:
          throw new Error("Invalid action");
      }

      console.log(`${action} result:`, txResult);

      if (txResult.success) {
        setResult({
          success: true,
          message: `Successfully ${action}ed ${amountNum} ${asset.symbol}`,
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
          message: `Failed to ${action} ${amountNum} ${asset.symbol}`,
          error: txResult.error,
        });
        setError(txResult.error || `Transaction failed`);
      }
    } catch (err: any) {
      console.error(`Error in ${action}:`, err);
      setResult({
        success: false,
        message: `Error ${action}ing ${asset.symbol}`,
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
            {getActionLabel()} {asset.symbol}
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
                  <div className="info-row">
                    <span>Supply APY:</span>
                    <span>{asset.depositApy.toFixed(2)}%</span>
                  </div>
                )}
                {action === "borrow" && (
                  <div className="info-row">
                    <span>Borrow APY:</span>
                    <span>{asset.borrowApy.toFixed(2)}%</span>
                  </div>
                )}
              </div>

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
              </div>

              {error && <div className="error-message">{error}</div>}

              <button
                className="submit-btn"
                onClick={performTransaction}
                disabled={loading || !amount || parseFloat(amount) <= 0}
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
