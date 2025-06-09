import React, { useEffect, useState, useRef, useMemo } from "react";
import scallopService from "../scallop/ScallopService";
import LendingActionModal from "../components/LendingActionModal";
import BorrowingActionModal from "../components/BorrowingActionModal";
import { useWallet } from "@suiet/wallet-kit";
import "../styles/LendingPage.scss";

interface AssetInfo {
  symbol: string;
  coinType: string;
  depositApy: number;
  borrowApy: number;
  decimals: number;
  marketSize: number;
  totalBorrow: number;
  utilization: number;
  price: number;
}

interface UserPosition {
  symbol: string;
  coinType: string;
  amount: number;
  valueUSD: number;
  apy: number;
  decimals: number;
  price: number;
}

// Token display preferences - which tokens to prioritize when duplicates exist
const TOKEN_PREFERENCES = {
  // For duplicate tokens, prefer the token on the left
  duplicatePreferences: {
    sui: ["sui", "vsui"], // Prefer SUI over vSUI
  },
};

// Default placeholder for all coin images
const DEFAULT_COIN_IMAGE = "/icons/default-coin.svg";

const LendingPage: React.FC = () => {
  // Extract all wallet properties for debugging and usage
  const wallet = useWallet();
  const { connected, account, connecting, select, availableWallets } = wallet;

  const [assets, setAssets] = useState<AssetInfo[]>([]);
  const [userSupplied, setUserSupplied] = useState<UserPosition[]>([]);
  const [userBorrowed, setUserBorrowed] = useState<UserPosition[]>([]);
  const [loading, setLoading] = useState(false);
  const [dataFetched, setDataFetched] = useState(false);
  const [activeTab, setActiveTab] = useState<"lending" | "borrowing">(
    "lending"
  );

  // Lending modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalAsset, setModalAsset] = useState<AssetInfo | null>(null);
  const [modalAction, setModalAction] = useState<
    "deposit" | "withdraw" | "borrow" | "repay"
  >("deposit");

  // Borrowing modal state
  const [borrowingModalOpen, setBorrowingModalOpen] = useState(false);
  const [borrowingModalAsset, setBorrowingModalAsset] =
    useState<AssetInfo | null>(null);
  const [borrowingModalAction, setBorrowingModalAction] = useState<
    "deposit-collateral" | "withdraw-collateral" | "borrow" | "repay"
  >("deposit-collateral");

  const [debugInfo, setDebugInfo] = useState<string | null>(null);
  const [walletInitialized, setWalletInitialized] = useState(false);
  const [hasObligationAccount, setHasObligationAccount] = useState(false);

  // Use a ref to track initial load
  const initialLoadComplete = useRef(false);
  const fetchInProgress = useRef(false);

  // Debug function for wallet information
  const debugWallet = () => {
    console.group("Wallet Debug Info");
    console.log("Wallet connected:", connected);
    console.log("Account:", account);
    console.log("Account address:", account?.address);
    console.log("Available wallets:", availableWallets);
    console.groupEnd();

    // Also trigger a connection test with the SDK
    if (connected && account?.address) {
      scallopService
        .debugWalletConnection(account.address)
        .then((result) => {
          console.log("Wallet connection test result:", result);
          setDebugInfo(`Wallet connection test: ${
            result.success ? "SUCCESS" : "FAILED"
          }. 
            Found ${result.primaryCoinsCount} primary coins, ${
            result.marketCoinsCount
          } market coins.`);
          setTimeout(() => setDebugInfo(null), 8000);
        })
        .catch((error) => {
          console.error("Wallet connection test error:", error);
          setDebugInfo(
            `Wallet connection test error: ${error.message || String(error)}`
          );
          setTimeout(() => setDebugInfo(null), 8000);
        });
    } else {
      setDebugInfo("Wallet not connected. Cannot test connection.");
      setTimeout(() => setDebugInfo(null), 5000);
    }
  };

  // Attempt to connect wallet if not connected
  const connectWallet = async () => {
    if (connecting || connected) return;

    console.log("Attempting to connect wallet...");
    try {
      if (availableWallets && availableWallets.length > 0) {
        // Use the first available wallet (usually Suiet)
        await select(availableWallets[0].name);
        console.log(`Selected wallet: ${availableWallets[0].name}`);
        // No need to call fetchData here as the useEffect will handle it
      } else {
        console.error("No available wallets found");
        setDebugInfo(
          "No available wallets found. Please install the Sui wallet extension."
        );
        setTimeout(() => setDebugInfo(null), 5000);
      }
    } catch (error) {
      console.error("Error connecting wallet:", error);
      setDebugInfo(
        `Error connecting wallet: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      setTimeout(() => setDebugInfo(null), 5000);
    }
  };

  // Debug function to log SDK structures
  const debugScallopSDK = async () => {
    console.log("Running Scallop SDK debug...");
    if (connected && account?.address) {
      await scallopService.debugScallopStructures(account.address);
    } else {
      await scallopService.debugScallopStructures(null);
    }

    setDebugInfo(
      "Debug info logged to console. Please check your browser's developer tools."
    );
    setTimeout(() => setDebugInfo(null), 5000);
  };

  // Filter and process market assets
  const processMarketAssets = (allAssets: AssetInfo[]): AssetInfo[] => {
    const tokenGroups: Record<string, AssetInfo[]> = {};

    // Group tokens by lowercase symbol
    allAssets.forEach((asset) => {
      const lowerSymbol = asset.symbol.toLowerCase();
      if (!tokenGroups[lowerSymbol]) {
        tokenGroups[lowerSymbol] = [];
      }
      tokenGroups[lowerSymbol].push(asset);
    });

    const result: AssetInfo[] = [];

    // Process each group to handle duplicates
    Object.entries(tokenGroups).forEach(([symbol, tokens]) => {
      if (tokens.length === 1) {
        // No duplicates, just add the token
        result.push(tokens[0]);
      } else {
        // Handle duplicates based on preferences
        const preferences = TOKEN_PREFERENCES.duplicatePreferences[symbol];
        if (preferences) {
          // Use preferences to select token
          for (const pref of preferences) {
            const match = tokens.find((t) => t.symbol.toLowerCase() === pref);
            if (match) {
              result.push(match);
              return;
            }
          }
        }

        // If no preference matched or no preference exists, just use the first one
        result.push(tokens[0]);
      }
    });

    // Sort the results alphabetically by symbol
    return result.sort((a, b) => a.symbol.localeCompare(b.symbol));
  };

  // Check if user has an obligation account
  const checkObligationAccount = async () => {
    if (connected && account?.address) {
      try {
        const hasObligation = await scallopService.hasObligationAccount(
          account.address
        );
        setHasObligationAccount(hasObligation);
        console.log("User has obligation account:", hasObligation);
      } catch (err) {
        console.error("Error checking obligation account:", err);
      }
    }
  };

  // Fetch all market assets and user positions
  const fetchData = async () => {
    // Don't allow multiple fetches to run at the same time
    if (fetchInProgress.current) {
      console.log("Fetch already in progress, skipping");
      return;
    }

    fetchInProgress.current = true;
    setLoading(true);
    try {
      console.log(`Fetching market assets at ${new Date().toISOString()}`);
      // Fetch market assets
      const marketAssets = await scallopService.fetchMarketAssets();
      console.log("Market assets fetched:", marketAssets);

      // Filter and process assets to remove duplicates
      const processedAssets = processMarketAssets(marketAssets);
      console.log("Processed assets (filtered):", processedAssets);

      setAssets(processedAssets);

      // Fetch user positions if connected - key part that needs to work
      if (connected && account?.address) {
        console.log(`Fetching positions for user: ${account.address}`);
        try {
          // Added explicit logging to debug
          console.log(
            "Starting fetchUserPositions with address:",
            account.address
          );

          const positions = await scallopService.fetchUserPositions(
            account.address
          );
          console.log("User positions returned:", positions);

          if (positions && positions.suppliedAssets) {
            console.log(
              `Setting ${positions.suppliedAssets.length} supplied assets`
            );
            setUserSupplied(positions.suppliedAssets);
          } else {
            console.log("No supplied assets returned");
            setUserSupplied([]);
          }

          if (positions && positions.borrowedAssets) {
            console.log(
              `Setting ${positions.borrowedAssets.length} borrowed assets`
            );
            setUserBorrowed(positions.borrowedAssets);
          } else {
            console.log("No borrowed assets returned");
            setUserBorrowed([]);
          }

          // Check if user has an obligation account
          await checkObligationAccount();
        } catch (error) {
          console.error("Error fetching user positions:", error);
          setUserSupplied([]);
          setUserBorrowed([]);
        }
      } else {
        console.log(
          "No wallet connected, skipping user position fetch. Details:",
          {
            connected,
            accountExists: !!account,
            address: account?.address,
          }
        );
        setUserSupplied([]);
        setUserBorrowed([]);
      }

      setDataFetched(true);
    } catch (error) {
      console.error("Error fetching lending data:", error);
    } finally {
      setLoading(false);
      fetchInProgress.current = false;
    }
  };

  // Initial wallet check and setup
  useEffect(() => {
    const checkWallet = async () => {
      // Log initial wallet state
      console.log("Initial wallet check:", { connected, account });

      // If wallet is connected, make sure we use it
      if (connected && account?.address) {
        console.log("Wallet already connected on page load:", account.address);
        setWalletInitialized(true);
      } else if (
        availableWallets &&
        availableWallets.length > 0 &&
        !connecting
      ) {
        // Try to connect to wallet automatically if available
        console.log("Attempting to auto-connect wallet");
        try {
          await select(availableWallets[0].name);
          console.log("Auto-connected to wallet:", availableWallets[0].name);
        } catch (error) {
          console.error("Failed to auto-connect wallet:", error);
        } finally {
          // Mark wallet initialization as complete
          setWalletInitialized(true);
        }
      } else {
        console.log("No wallet available for auto-connection");
        setWalletInitialized(true);
      }
    };

    // Run wallet check
    checkWallet();
  }, []); // Run once on component mount

  // Load data only once on initial render or when wallet changes
  useEffect(() => {
    // Wait until wallet initialization is complete
    if (!walletInitialized) {
      return;
    }

    console.log("Wallet state for data loading:", {
      connected,
      account,
      walletInitialized,
    });

    // Only fetch data if this is the first time or wallet connection changed
    if (!initialLoadComplete.current || (connected && account?.address)) {
      initialLoadComplete.current = true;
      fetchData();
    }
  }, [connected, account?.address, walletInitialized]);

  // Memoize the getUserSuppliedAmount function to prevent unnecessary rerenders
  const getUserSuppliedAmount = useMemo(() => {
    return (symbol: string) => {
      const position = userSupplied.find(
        (p) => p.symbol.toLowerCase() === symbol.toLowerCase()
      );
      return position ? position.amount : 0;
    };
  }, [userSupplied]);

  // Memoize the getUserBorrowedAmount function
  const getUserBorrowedAmount = useMemo(() => {
    return (symbol: string) => {
      const position = userBorrowed.find(
        (p) => p.symbol.toLowerCase() === symbol.toLowerCase()
      );
      return position ? position.amount : 0;
    };
  }, [userBorrowed]);

  // Prepare assets table data once and memoize it
  const tableData = useMemo(() => {
    return assets.map((asset) => {
      const suppliedAmount = getUserSuppliedAmount(asset.symbol);
      const borrowedAmount = getUserBorrowedAmount(asset.symbol);
      return {
        ...asset,
        suppliedAmount,
        hasSupply: suppliedAmount > 0,
        borrowedAmount,
        hasBorrow: borrowedAmount > 0,
      };
    });
  }, [assets, getUserSuppliedAmount, getUserBorrowedAmount]);

  // Lending modal functions
  const openModal = (
    asset: AssetInfo,
    action: "deposit" | "withdraw" | "borrow" | "repay"
  ) => {
    setModalAsset(asset);
    setModalAction(action);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setTimeout(() => {
      setModalAsset(null);
    }, 200);
  };

  // Borrowing modal functions
  const openBorrowingModal = (
    asset: AssetInfo,
    action: "deposit-collateral" | "withdraw-collateral" | "borrow" | "repay"
  ) => {
    setBorrowingModalAsset(asset);
    setBorrowingModalAction(action);
    setBorrowingModalOpen(true);
  };

  const closeBorrowingModal = () => {
    setBorrowingModalOpen(false);
    setTimeout(() => {
      setBorrowingModalAsset(null);
    }, 200);
  };

  // Handle successful transaction
  const handleSuccess = () => {
    // Refresh data after a successful transaction
    fetchData();
  };

  const forceRefresh = () => {
    // Force-reset the initialLoadComplete so fetchData runs again
    initialLoadComplete.current = false;
    fetchData();
  };

  // Function to create obligation account
  const createObligationAccount = async () => {
    if (!connected || !wallet) {
      setDebugInfo("Wallet not connected. Cannot create obligation account.");
      setTimeout(() => setDebugInfo(null), 5000);
      return;
    }

    try {
      setDebugInfo("Creating obligation account...");
      const result = await scallopService.createObligationAccount(wallet);

      if (result.success) {
        setDebugInfo("Successfully created obligation account!");
        setHasObligationAccount(true);
        fetchData(); // Refresh data to show updated status
      } else {
        setDebugInfo(`Failed to create obligation account: ${result.error}`);
      }

      setTimeout(() => setDebugInfo(null), 5000);
    } catch (err) {
      console.error("Error creating obligation account:", err);
      setDebugInfo(
        `Error creating obligation account: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      setTimeout(() => setDebugInfo(null), 5000);
    }
  };

  return (
    <div className="lending-page">
      <h1>Scallop Lending Markets</h1>

      {/* Debug and refresh buttons */}
      <div className="debug-section">
        <button
          onClick={debugScallopSDK}
          className="debug-btn"
          disabled={loading}
        >
          Debug Scallop SDK
        </button>
        <button onClick={debugWallet} className="debug-btn wallet-debug-btn">
          Debug Wallet
        </button>
        <button
          onClick={forceRefresh}
          className="debug-btn refresh-btn"
          disabled={loading}
        >
          {loading ? "Loading..." : "Refresh Data"}
        </button>
        {!connected && (
          <button
            onClick={connectWallet}
            className="debug-btn connect-btn"
            disabled={connecting}
          >
            {connecting ? "Connecting..." : "Connect Wallet"}
          </button>
        )}
        {connected && !hasObligationAccount && (
          <button
            onClick={createObligationAccount}
            className="debug-btn obligation-btn"
          >
            Create Obligation Account
          </button>
        )}
        {debugInfo && <div className="debug-info">{debugInfo}</div>}
      </div>

      {/* Wallet status indicator */}
      <div className="wallet-status">
        {connected && account?.address ? (
          <div className="connected-status">
            <span className="status-dot connected"></span>
            <span>
              Wallet Connected: {account.address.slice(0, 6)}...
              {account.address.slice(-4)}
            </span>
            {hasObligationAccount && (
              <span className="obligation-status">
                <span className="status-dot obligation"></span>
                <span>Obligation Account Ready</span>
              </span>
            )}
          </div>
        ) : (
          <div className="disconnected-status">
            <span className="status-dot disconnected"></span>
            <span>Wallet Not Connected</span>
          </div>
        )}
      </div>

      {/* User Supply Positions */}
      {connected && account?.address && userSupplied.length > 0 && (
        <div className="user-positions-summary">
          <h3>Your Supply Positions</h3>
          <div className="user-positions-grid">
            {userSupplied.map((asset) => (
              <div
                className="user-position-card"
                key={`supply-${asset.symbol}`}
              >
                <div className="position-icon">
                  {/* Use default placeholder */}
                  <img
                    src={DEFAULT_COIN_IMAGE}
                    alt={asset.symbol}
                    className="coin-icon"
                  />
                </div>
                <div className="position-details">
                  <h4>{asset.symbol}</h4>
                  <div className="position-values">
                    <div>
                      <span className="label">Amount:</span>
                      <span className="value">
                        {asset.amount.toLocaleString(undefined, {
                          maximumFractionDigits: 6,
                        })}
                      </span>
                    </div>
                    <div>
                      <span className="label">Value:</span>
                      <span className="value">
                        $
                        {asset.valueUSD.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </span>
                    </div>
                    <div>
                      <span className="label">APY:</span>
                      <span className="value positive">
                        {asset.apy.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                        %
                      </span>
                    </div>
                  </div>
                  <div className="position-actions">
                    <button
                      className="deposit-btn"
                      onClick={() => {
                        const marketAsset = assets.find(
                          (a) =>
                            a.symbol.toLowerCase() ===
                            asset.symbol.toLowerCase()
                        );
                        if (marketAsset) {
                          openModal(marketAsset, "deposit");
                        }
                      }}
                      disabled={loading}
                    >
                      Supply More
                    </button>
                    <button
                      className="withdraw-btn"
                      onClick={() => {
                        const marketAsset = assets.find(
                          (a) =>
                            a.symbol.toLowerCase() ===
                            asset.symbol.toLowerCase()
                        );
                        if (marketAsset) {
                          openModal(marketAsset, "withdraw");
                        }
                      }}
                      disabled={loading}
                    >
                      Withdraw
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* User Borrow Positions */}
      {connected && account?.address && userBorrowed.length > 0 && (
        <div className="user-positions-summary borrowed">
          <h3>Your Borrow Positions</h3>
          <div className="user-positions-grid">
            {userBorrowed.map((asset) => (
              <div
                className="user-position-card borrowed"
                key={`borrow-${asset.symbol}`}
              >
                <div className="position-icon">
                  {/* Use default placeholder */}
                  <img
                    src={DEFAULT_COIN_IMAGE}
                    alt={asset.symbol}
                    className="coin-icon"
                  />
                </div>
                <div className="position-details">
                  <h4>{asset.symbol}</h4>
                  <div className="position-values">
                    <div>
                      <span className="label">Amount:</span>
                      <span className="value">
                        {asset.amount.toLocaleString(undefined, {
                          maximumFractionDigits: 6,
                        })}
                      </span>
                    </div>
                    <div>
                      <span className="label">Value:</span>
                      <span className="value">
                        $
                        {asset.valueUSD.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </span>
                    </div>
                    <div>
                      <span className="label">APY:</span>
                      <span className="value negative">
                        {asset.apy.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                        %
                      </span>
                    </div>
                  </div>
                  <div className="position-actions">
                    <button
                      className="repay-btn"
                      onClick={() => {
                        const marketAsset = assets.find(
                          (a) =>
                            a.symbol.toLowerCase() ===
                            asset.symbol.toLowerCase()
                        );
                        if (marketAsset) {
                          openBorrowingModal(marketAsset, "repay");
                        }
                      }}
                      disabled={loading}
                    >
                      Repay
                    </button>
                    <button
                      className="borrow-btn"
                      onClick={() => {
                        const marketAsset = assets.find(
                          (a) =>
                            a.symbol.toLowerCase() ===
                            asset.symbol.toLowerCase()
                        );
                        if (marketAsset) {
                          openBorrowingModal(marketAsset, "borrow");
                        }
                      }}
                      disabled={loading}
                    >
                      Borrow More
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="tabs">
        <button
          className={activeTab === "lending" ? "active" : ""}
          onClick={() => setActiveTab("lending")}
        >
          LENDING
        </button>
        <button
          className={activeTab === "borrowing" ? "active" : ""}
          onClick={() => setActiveTab("borrowing")}
        >
          BORROWING
        </button>
      </div>

      {/* Market Table */}
      <div className="lending-table-container">
        <table className="lending-table">
          <thead>
            <tr>
              <th>Asset</th>
              <th>Price (USD)</th>
              <th>Total Supply</th>
              <th>Total Borrow</th>
              <th>Utilization</th>
              <th>{activeTab === "lending" ? "Supply APY" : "Borrow APY"}</th>
              <th>{activeTab === "lending" ? "Your Supply" : "Your Borrow"}</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && !dataFetched ? (
              <tr>
                <td colSpan={8} className="loading">
                  Loading market data...
                </td>
              </tr>
            ) : tableData.length === 0 ? (
              <tr>
                <td colSpan={8} className="no-data">
                  No assets available
                </td>
              </tr>
            ) : (
              tableData.map(
                ({
                  symbol,
                  coinType,
                  price,
                  marketSize,
                  totalBorrow,
                  utilization,
                  depositApy,
                  borrowApy,
                  decimals,
                  suppliedAmount,
                  hasSupply,
                  borrowedAmount,
                  hasBorrow,
                }) => (
                  <tr key={symbol}>
                    <td className="asset-cell">
                      <span className="asset-text">{symbol}</span>
                    </td>
                    <td>${price.toFixed(4)}</td>
                    <td>
                      {marketSize.toLocaleString(undefined, {
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td>
                      {totalBorrow.toLocaleString(undefined, {
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td>{utilization.toFixed(2)}%</td>
                    <td className="apy-cell">
                      {activeTab === "lending" ? (
                        <span className="positive">
                          {depositApy.toFixed(2)}%
                        </span>
                      ) : (
                        <span className="negative">
                          {borrowApy.toFixed(2)}%
                        </span>
                      )}
                    </td>
                    <td>
                      {connected && account?.address ? (
                        activeTab === "lending" ? (
                          hasSupply ? (
                            <span className="user-value">
                              {suppliedAmount.toLocaleString(undefined, {
                                maximumFractionDigits: 6,
                              })}
                            </span>
                          ) : (
                            "--"
                          )
                        ) : hasBorrow ? (
                          <span className="user-value">
                            {borrowedAmount.toLocaleString(undefined, {
                              maximumFractionDigits: 6,
                            })}
                          </span>
                        ) : (
                          "--"
                        )
                      ) : (
                        "--"
                      )}
                    </td>
                    <td className="actions-cell">
                      {activeTab === "lending" ? (
                        <>
                          <button
                            onClick={() =>
                              openModal(
                                {
                                  symbol,
                                  coinType,
                                  depositApy,
                                  borrowApy,
                                  decimals,
                                  marketSize,
                                  totalBorrow,
                                  utilization,
                                  price,
                                },
                                "deposit"
                              )
                            }
                            className="deposit-btn"
                            disabled={loading || !connected}
                          >
                            Deposit
                          </button>
                          {hasSupply && (
                            <button
                              onClick={() =>
                                openModal(
                                  {
                                    symbol,
                                    coinType,
                                    depositApy,
                                    borrowApy,
                                    decimals,
                                    marketSize,
                                    totalBorrow,
                                    utilization,
                                    price,
                                  },
                                  "withdraw"
                                )
                              }
                              className="withdraw-btn"
                              disabled={loading || !connected}
                            >
                              Withdraw
                            </button>
                          )}
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() =>
                              openBorrowingModal(
                                {
                                  symbol,
                                  coinType,
                                  depositApy,
                                  borrowApy,
                                  decimals,
                                  marketSize,
                                  totalBorrow,
                                  utilization,
                                  price,
                                },
                                "deposit-collateral"
                              )
                            }
                            className="deposit-collateral-btn"
                            disabled={loading || !connected}
                          >
                            Deposit Collateral
                          </button>
                          <button
                            onClick={() =>
                              openBorrowingModal(
                                {
                                  symbol,
                                  coinType,
                                  depositApy,
                                  borrowApy,
                                  decimals,
                                  marketSize,
                                  totalBorrow,
                                  utilization,
                                  price,
                                },
                                "borrow"
                              )
                            }
                            className="borrow-btn"
                            disabled={
                              loading || !connected || !hasObligationAccount
                            }
                          >
                            Borrow
                          </button>
                          {hasBorrow && (
                            <button
                              onClick={() =>
                                openBorrowingModal(
                                  {
                                    symbol,
                                    coinType,
                                    depositApy,
                                    borrowApy,
                                    decimals,
                                    marketSize,
                                    totalBorrow,
                                    utilization,
                                    price,
                                  },
                                  "repay"
                                )
                              }
                              className="repay-btn"
                              disabled={loading || !connected}
                            >
                              Repay
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                )
              )
            )}
          </tbody>
        </table>
      </div>

      {/* Lending Action Modal */}
      {modalAsset && (
        <LendingActionModal
          open={modalOpen}
          onClose={closeModal}
          asset={modalAsset}
          action={modalAction}
          onSuccess={handleSuccess}
        />
      )}

      {/* Borrowing Action Modal */}
      {borrowingModalAsset && (
        <BorrowingActionModal
          open={borrowingModalOpen}
          onClose={closeBorrowingModal}
          asset={borrowingModalAsset}
          action={borrowingModalAction}
          onSuccess={handleSuccess}
        />
      )}
    </div>
  );
};

export default LendingPage;
