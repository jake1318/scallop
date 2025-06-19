// src/pages/LendingPage.tsx
// Last Updated: 2025-06-19 00:48:03 UTC by jake1318

import React, { useEffect, useState, useRef, useMemo } from "react";
import scallopService from "../scallop/ScallopService";
import scallopBorrowService from "../scallop/ScallopBorrowService";
import LendingActionModal from "../components/LendingActionModal";
import BorrowingActionModal from "../components/BorrowingActionModal";
import CollateralManagementModal from "../components/CollateralManagementModal";
import RepaymentModal from "../components/RepaymentModal";
import ClaimRewardsModal from "../components/ClaimRewardsModal";
import { useWallet } from "@suiet/wallet-kit";
import "../styles/LendingPage.scss";
import type { ClaimResult } from "../services/rewardService";
import {
  unlockObligation,
  unlockAndRepayObligation,
  isObligationLocked,
} from "../scallop/ScallopIncentiveService";

// Define DisplayObligation interface locally
interface DisplayObligation {
  obligationId: string;
  collaterals: Array<{ symbol: string; amount: number; usd: number }>;
  borrows: Array<{ symbol: string; amount: number; usd: number }>;
  totalCollateralUSD: number;
  totalBorrowUSD: number;
  lockType: "boost" | "borrow-incentive" | null;
  lockEnds: number | null;
  hasBorrowIncentiveStake?: boolean;
  hasBoostStake?: boolean;
  isLocked?: boolean;
  isEmpty?: boolean;
  riskLevel?: number;
}

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

interface RewardInfo {
  symbol: string;
  coinType: string;
  amount: number; // in human units
  valueUSD: number;
}

// Simple utility functions
const formatNumber = (num: number, decimals: number = 2): string => {
  return num.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
};

// Helper function to get LTV class based on the value
const getLtvClass = (ltvPercent: number): string => {
  if (ltvPercent >= 75) return "ltv-high";
  if (ltvPercent >= 50) return "ltv-medium";
  return "ltv-low";
};

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
  const [userCollateral, setUserCollateral] = useState<UserPosition[]>([]);
  const [pendingRewards, setPendingRewards] = useState<RewardInfo[]>([]);
  const [claiming, setClaiming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dataFetched, setDataFetched] = useState(false);
  const [activeTab, setActiveTab] = useState<
    "lending" | "borrowing" | "obligations"
  >("lending");

  // Add state for wallet-wide obligation totals
  const [walletTotals, setWalletTotals] = useState<{
    totalCollateralUSD: number;
    totalBorrowUSD: number;
    activeObligationCount: number;
    collateralsBySymbol: Record<
      string,
      {
        symbol: string;
        totalAmount: number;
        totalUSD: number;
      }
    >;
    borrowsBySymbol: Record<
      string,
      {
        symbol: string;
        totalAmount: number;
        totalUSD: number;
      }
    >;
  } | null>(null);

  // Obligation management state
  const [userObligations, setUserObligations] = useState<DisplayObligation[]>(
    []
  );
  const [selectedObligationId, setSelectedObligationId] = useState<
    string | null
  >(null);
  const [isCreatingObligation, setIsCreatingObligation] =
    useState<boolean>(false);
  const [isUnlockingObligation, setIsUnlockingObligation] =
    useState<boolean>(false);
  const [unlockingObligationId, setUnlockingObligationId] = useState<
    string | null
  >(null);
  const [obligationActionResult, setObligationActionResult] =
    useState<any>(null);

  // Claim rewards modal state
  const [showClaimModal, setShowClaimModal] = useState(false);

  // Lending modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalAsset, setModalAsset] = useState<AssetInfo | null>(null);
  const [modalAction, setModalAction] = useState<
    "deposit" | "withdraw" | "borrow" | "repay" | "claim"
  >("deposit");

  // Borrowing modal state
  const [borrowingModalOpen, setBorrowingModalOpen] = useState(false);
  const [borrowingModalAsset, setBorrowingModalAsset] =
    useState<AssetInfo | null>(null);
  const [borrowingModalAction, setBorrowingModalAction] = useState<
    "borrow" | "repay"
  >("borrow");

  // Repayment modal state
  const [repaymentModalOpen, setRepaymentModalOpen] = useState(false);
  const [repaymentModalAsset, setRepaymentModalAsset] =
    useState<AssetInfo | null>(null);

  // Collateral modal state
  const [collateralModalOpen, setCollateralModalOpen] = useState(false);
  const [collateralModalAsset, setCollateralModalAsset] =
    useState<AssetInfo | null>(null);
  const [collateralModalAction, setCollateralModalAction] = useState<
    "deposit-collateral" | "withdraw-collateral"
  >("deposit-collateral");

  const [debugInfo, setDebugInfo] = useState<string | null>(null);
  const [walletInitialized, setWalletInitialized] = useState(false);
  const [hasObligationAccount, setHasObligationAccount] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  // Add new function to fetch wallet-wide totals
  const fetchWalletObligationTotals = async () => {
    if (!connected || !account?.address) {
      setWalletTotals(null);
      return;
    }

    try {
      console.log(
        `[fetchWalletObligationTotals] Fetching totals for ${account.address}`
      );
      const result = await scallopBorrowService.getWalletObligationTotals(
        account.address
      );

      if (result.success) {
        console.log(
          "[fetchWalletObligationTotals] Got wallet totals:",
          result.totals
        );
        setWalletTotals(result.totals);
      } else {
        console.error(
          "[fetchWalletObligationTotals] Failed to fetch totals:",
          result.error
        );
        setWalletTotals(null);
      }
    } catch (error) {
      console.error("[fetchWalletObligationTotals] Error:", error);
      setWalletTotals(null);
    }
  };

  // Add new function to fetch obligations
  const fetchObligations = async () => {
    if (!connected || !account?.address) {
      setUserObligations([]);
      setSelectedObligationId(null);
      return;
    }
    try {
      console.log(
        `[fetchObligations] Fetching obligations for ${account.address}`
      );
      const obls = await scallopBorrowService.getUserObligations(
        account.address
      );
      setUserObligations(obls);

      console.log(`[fetchObligations] Found ${obls.length} obligations`);

      // We no longer auto-select an obligation
      if (selectedObligationId === null && obls.length > 0) {
        console.log(
          "[fetchObligations] No obligation auto-selected - user must choose"
        );
      }
    } catch (e) {
      console.error("Failed to fetch obligations", e);
    }
  };

  // Helper function to update userCollateral when an obligation is selected
  const updateCollateralFromSelectedObligation = () => {
    if (!selectedObligationId || userObligations.length === 0) return;

    const selectedObl = userObligations.find(
      (obl) => obl.obligationId === selectedObligationId
    );

    if (selectedObl && selectedObl.collaterals.length > 0) {
      console.log(
        `Setting collateral from selected obligation: ${selectedObl.collaterals.length} assets`
      );

      // Convert obligation collaterals to UserPosition format
      const collateralAssets = selectedObl.collaterals.map((c) => {
        const matchingAsset = assets.find((a) => a.symbol === c.symbol);
        return {
          symbol: c.symbol,
          coinType: matchingAsset?.coinType || "",
          amount: c.amount,
          valueUSD: c.usd,
          apy: 0, // Collateral doesn't earn APY directly
          decimals:
            matchingAsset?.decimals ||
            (c.symbol.toLowerCase() === "sui" ? 9 : 6),
          price: matchingAsset?.price || (c.amount > 0 ? c.usd / c.amount : 0),
        };
      });

      setUserCollateral(collateralAssets);
    } else {
      console.log("Selected obligation has no collateral, clearing display");
      setUserCollateral([]);
    }
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

          if (positions && positions.collateralAssets) {
            console.log(
              `Setting ${positions.collateralAssets.length} collateral assets from portfolio`
            );
            // Store these initially, but we'll override with obligation-specific data when selected
            setUserCollateral(positions.collateralAssets);
          } else {
            console.log("No collateral assets returned");
            setUserCollateral([]);
          }

          if (positions && positions.pendingRewards) {
            console.log(
              `Setting ${positions.pendingRewards.length} pending rewards`
            );
            setPendingRewards(positions.pendingRewards);
          } else {
            console.log("No pending rewards returned");
            setPendingRewards([]);
          }

          // Check if user has an obligation account
          await checkObligationAccount();

          // Fetch obligations (new)
          await fetchObligations();

          // Add call to fetch wallet-wide totals
          await fetchWalletObligationTotals();

          // Update collateral display if an obligation is selected
          if (selectedObligationId) {
            updateCollateralFromSelectedObligation();
          }
        } catch (error) {
          console.error("Error fetching user positions:", error);
          setUserSupplied([]);
          setUserBorrowed([]);
          setUserCollateral([]);
          setPendingRewards([]);
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
        setUserCollateral([]);
        setPendingRewards([]);
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

  // Clear any selected obligation ID if wallet changes
  useEffect(() => {
    setSelectedObligationId(null);
  }, [account?.address]);

  // Update collateral display when selected obligation changes
  useEffect(() => {
    if (
      selectedObligationId &&
      userObligations.length > 0 &&
      connected &&
      account?.address
    ) {
      updateCollateralFromSelectedObligation();
    }
  }, [selectedObligationId, userObligations, assets]);

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

  // Memoize the getUserCollateralAmount function
  const getUserCollateralAmount = useMemo(() => {
    return (symbol: string) => {
      const position = userCollateral.find(
        (p) => p.symbol.toLowerCase() === symbol.toLowerCase()
      );
      return position ? position.amount : 0;
    };
  }, [userCollateral]);

  // Prepare assets table data once and memoize it
  const tableData = useMemo(() => {
    return assets.map((asset) => {
      const suppliedAmount = getUserSuppliedAmount(asset.symbol);
      const borrowedAmount = getUserBorrowedAmount(asset.symbol);
      const collateralAmount = getUserCollateralAmount(asset.symbol);
      return {
        ...asset,
        suppliedAmount,
        hasSupply: suppliedAmount > 0,
        borrowedAmount,
        hasBorrow: borrowedAmount > 0,
        collateralAmount,
        hasCollateral: collateralAmount > 0,
      };
    });
  }, [
    assets,
    getUserSuppliedAmount,
    getUserBorrowedAmount,
    getUserCollateralAmount,
  ]);

  // Function to create obligation account
  const createNewObligation = async () => {
    if (!connected || !wallet) {
      setError("Wallet not connected. Cannot create obligation account.");
      setTimeout(() => setError(null), 5000);
      return;
    }

    setIsCreatingObligation(true);
    setError(null);

    try {
      const result = await scallopBorrowService.createObligation(wallet);

      if (result.success) {
        setObligationActionResult({
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

        // Set this new obligation as selected
        setSelectedObligationId(result.obligationId);

        // Refresh obligations list
        fetchObligations();

        setTimeout(() => {
          setObligationActionResult(null);
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

  // Function to handle unlocking obligations
  const handleUnlockObligation = async (
    obligationId: string,
    lockType: "boost" | "borrow-incentive" | null
  ) => {
    if (!connected || !wallet) {
      setError("Wallet not connected");
      return;
    }

    setUnlockingObligationId(obligationId);
    setIsUnlockingObligation(true);
    setError(null);

    try {
      // Use the updated unlockObligation function from ScallopIncentiveService
      const result = await unlockObligation(wallet, obligationId);

      if (result.success) {
        setObligationActionResult({
          success: true,
          message: `Successfully unlocked obligation ${obligationId.slice(
            0,
            6
          )}...${obligationId.slice(-4)}`,
          txHash: result.digest,
          txLink: result.txLink,
        });

        // Refresh obligations to update status
        setTimeout(() => {
          fetchObligations();
          // Also fetch wallet totals to update them
          fetchWalletObligationTotals();
          setObligationActionResult(null);
        }, 2000);
      } else {
        setError(`Failed to unlock obligation: ${result.error}`);
      }
    } catch (err) {
      console.error("Error unlocking obligation:", err);
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(`Error unlocking obligation: ${errorMsg}`);
    } finally {
      setIsUnlockingObligation(false);
      setUnlockingObligationId(null);
    }
  };

  // Function to handle unlock and repay in one transaction
  const handleUnlockAndRepay = async (
    obligationId: string,
    asset: AssetInfo,
    repayAmount: number
  ) => {
    if (!connected || !wallet) {
      setError("Wallet not connected");
      return;
    }

    setUnlockingObligationId(obligationId);
    setIsUnlockingObligation(true);
    setError(null);

    try {
      // Check if the obligation is actually locked first
      const address = await wallet.getAddress();
      const isLocked = await isObligationLocked(obligationId, address);

      if (!isLocked) {
        setError("Obligation is not locked. Use regular repay instead.");
        return;
      }

      // Calculate amount in base units
      const baseUnits = Math.floor(repayAmount * Math.pow(10, asset.decimals));

      // Use the unlockAndRepayObligation function from ScallopIncentiveService
      const result = await unlockAndRepayObligation(
        wallet,
        obligationId,
        asset.symbol.toLowerCase() as "sui" | "usdc" | "usdt",
        baseUnits,
        false // Not repaying maximum
      );

      if (result.success) {
        setObligationActionResult({
          success: true,
          message: `Successfully unlocked obligation and repaid ${repayAmount} ${asset.symbol}`,
          txHash: result.digest,
          txLink: result.txLink,
        });

        // Refresh data to update status
        setTimeout(() => {
          fetchObligations();
          fetchWalletObligationTotals();
          fetchData(); // Refresh all data
          setObligationActionResult(null);
        }, 2000);
      } else {
        setError(`Failed to unlock and repay: ${result.error}`);
      }
    } catch (err) {
      console.error("Error unlocking and repaying:", err);
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(`Error unlocking and repaying: ${errorMsg}`);
    } finally {
      setIsUnlockingObligation(false);
      setUnlockingObligationId(null);
    }
  };

  // Lending modal functions
  const openModal = (
    asset: AssetInfo,
    action: "deposit" | "withdraw" | "borrow" | "repay" | "claim"
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
  const openBorrowingModal = (asset: AssetInfo, action: "borrow" | "repay") => {
    // Check if an obligation is selected
    if (!selectedObligationId) {
      setError("Please select an obligation before borrowing");
      setActiveTab("obligations"); // Switch to obligations tab
      return;
    }

    // Check if selected obligation is locked
    const selectedObl = userObligations.find(
      (o) => o.obligationId === selectedObligationId
    );
    if (selectedObl?.isLocked) {
      setError(
        "The selected obligation is locked. Please unlock it or select another one."
      );
      setActiveTab("obligations"); // Switch to obligations tab
      return;
    }

    // Check if selected obligation has collateral
    if (
      selectedObl &&
      (selectedObl.collaterals.length === 0 ||
        selectedObl.totalCollateralUSD === 0)
    ) {
      setError(
        "The selected obligation has no collateral. Please add collateral first."
      );
      setActiveTab("obligations"); // Switch to obligations tab
      return;
    }

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

  // Repayment modal functions
  const openRepaymentModal = (asset: AssetInfo) => {
    // Check if an obligation is selected
    if (!selectedObligationId) {
      setError("Please select an obligation before repaying");
      setActiveTab("obligations"); // Switch to obligations tab
      return;
    }

    // Check if selected obligation is locked
    // If it's locked, offer to unlock and repay in one transaction
    const selectedObl = userObligations.find(
      (o) => o.obligationId === selectedObligationId
    );

    if (selectedObl?.isLocked) {
      // We could offer to use handleUnlockAndRepay instead
      setError(
        "This obligation is locked. You need to unlock it before repaying."
      );
      setActiveTab("obligations"); // Switch to obligations tab
      return;
    }

    setRepaymentModalAsset(asset);
    setRepaymentModalOpen(true);
  };

  const closeRepaymentModal = () => {
    setRepaymentModalOpen(false);
    setTimeout(() => {
      setRepaymentModalAsset(null);
    }, 200);
  };

  // New function to handle Add Collateral button click from empty obligation warning
  const handleAddCollateralClick = (asset: AssetInfo | null = null) => {
    if (!selectedObligationId) {
      setError("Please select an obligation before adding collateral");
      setActiveTab("obligations"); // Switch to obligations tab
      return;
    }

    let targetAsset: AssetInfo;

    if (asset) {
      // Use the provided asset
      targetAsset = asset;
    } else if (assets.length > 0) {
      // If no asset provided, try to find SUI as default
      const suiAsset = assets.find((a) => a.symbol.toUpperCase() === "SUI");
      // If SUI not found, use the first asset
      targetAsset = suiAsset || assets[0];
    } else {
      setError("No assets available to add as collateral");
      return;
    }

    console.log(`Opening collateral modal for ${targetAsset.symbol}`);
    openCollateralModal(targetAsset, "deposit-collateral");
  };

  // Enhanced collateral modal functions to handle empty obligations
  const openCollateralModal = (
    asset: AssetInfo,
    action: "deposit-collateral" | "withdraw-collateral"
  ) => {
    // Check if an obligation is selected
    if (!selectedObligationId) {
      setError("Please select an obligation before managing collateral");
      setActiveTab("obligations"); // Switch to obligations tab
      return;
    }

    // Check if selected obligation is locked
    const selectedObl = userObligations.find(
      (o) => o.obligationId === selectedObligationId
    );
    if (selectedObl?.isLocked) {
      setError(
        "The selected obligation is locked. Please unlock it or select another one."
      );
      setActiveTab("obligations"); // Switch to obligations tab
      return;
    }

    setCollateralModalAsset(asset);
    setCollateralModalAction(action);
    setCollateralModalOpen(true);
  };

  const closeCollateralModal = () => {
    setCollateralModalOpen(false);
    setTimeout(() => {
      setCollateralModalAsset(null);
    }, 200);
  };

  // Claim Rewards modal functions
  const openClaimRewardsModal = () => {
    console.log("Opening claim rewards modal");
    setShowClaimModal(true);
  };

  const handleClaimSuccess = (result: ClaimResult) => {
    console.log("Claim result:", result);
    if (result.success) {
      // Refresh data to reflect zeroed rewards
      fetchData();
    } else {
      setDebugInfo(`Claim failed: ${result.error}`);
      setTimeout(() => setDebugInfo(null), 5000);
    }
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

  // Debug function to display the selected obligation's collateral
  const debugSelectedObligation = () => {
    if (!selectedObligationId || !connected || !account?.address) {
      setDebugInfo("No obligation selected or wallet not connected.");
      setTimeout(() => setDebugInfo(null), 5000);
      return;
    }

    console.log("Debugging selected obligation:", selectedObligationId);

    // Find the obligation in user obligations
    const obligation = userObligations.find(
      (o) => o.obligationId === selectedObligationId
    );
    if (!obligation) {
      setDebugInfo("Selected obligation not found in user obligations.");
      setTimeout(() => setDebugInfo(null), 5000);
      return;
    }

    console.log("Selected obligation details:", obligation);

    // Check collaterals
    if (obligation.collaterals.length > 0) {
      const collateralInfo = obligation.collaterals
        .map((c) => `${c.amount.toFixed(6)} ${c.symbol} ($${c.usd.toFixed(2)})`)
        .join(", ");

      setDebugInfo(
        `Obligation ${selectedObligationId.slice(
          0,
          8
        )}... has collateral: ${collateralInfo}`
      );
    } else {
      setDebugInfo(
        `Obligation ${selectedObligationId.slice(0, 8)}... has no collateral.`
      );
    }

    // Display for 10 seconds
    setTimeout(() => setDebugInfo(null), 10000);
  };

  // Render Obligations Tab Content
  const renderObligationsTab = () => {
    return (
      <div className="obligations-tab-container">
        <h2>Your Obligation Accounts</h2>

        {error && <div className="error-message">{error}</div>}

        {obligationActionResult && (
          <div
            className={`result-message ${
              obligationActionResult.success ? "success" : "error"
            }`}
          >
            <p>{obligationActionResult.message}</p>
            {obligationActionResult.txLink && (
              <a
                href={obligationActionResult.txLink}
                target="_blank"
                rel="noopener noreferrer"
                className="tx-link"
              >
                View Transaction
              </a>
            )}
          </div>
        )}

        <div className="create-obligation-container">
          <button
            className="create-obligation-btn"
            onClick={createNewObligation}
            disabled={isCreatingObligation || !wallet.connected}
          >
            {isCreatingObligation ? "Creating..." : "Create New Obligation"}
          </button>

          {/* Add debug button here */}
          {selectedObligationId && (
            <button
              className="debug-obligation-btn"
              onClick={debugSelectedObligation}
              style={{ marginLeft: "10px", backgroundColor: "#555" }}
            >
              Debug Selected Obligation
            </button>
          )}
        </div>

        {userObligations.length === 0 ? (
          <div className="no-obligations-message">
            <p>
              You don't have any obligation accounts yet. Create one to get
              started.
            </p>
          </div>
        ) : (
          <div className="obligations-list">
            {/* Unlocked/Empty Obligations Section */}
            <h3>Available Obligations</h3>
            <table className="obligations-table">
              <thead>
                <tr>
                  <th>Obligation ID</th>
                  <th>Status</th>
                  <th>Collateral (USD)</th>
                  <th>Borrows (USD)</th>
                  <th>LTV Ratio</th> {/* Added LTV column */}
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {userObligations.map((obl) => {
                  const isSelected = selectedObligationId === obl.obligationId;
                  const isLocked = obl.isLocked;
                  const isEmpty = obl.isEmpty;
                  const ltvRatio =
                    obl.totalCollateralUSD > 0
                      ? (obl.totalBorrowUSD / obl.totalCollateralUSD) * 100
                      : 0;

                  return (
                    <tr
                      key={obl.obligationId}
                      className={`
                        obligation-row 
                        ${isSelected ? "selected" : ""} 
                        ${isLocked ? "locked" : ""} 
                        ${isEmpty ? "empty" : ""}
                      `}
                    >
                      <td className="id-cell">
                        {obl.obligationId.slice(0, 8)}...
                        {obl.obligationId.slice(-8)}
                      </td>
                      <td className="status-cell">
                        {isLocked ? (
                          <span className="locked-status">🔒 Locked</span>
                        ) : isEmpty ? (
                          <span className="empty-status">🟢 Empty</span>
                        ) : (
                          <span className="active-status">🟢 Active</span>
                        )}
                      </td>
                      <td className="collateral-cell">
                        ${formatNumber(obl.totalCollateralUSD, 2)}
                      </td>
                      <td className="borrows-cell">
                        ${formatNumber(obl.totalBorrowUSD, 2)}
                      </td>
                      <td className={`ltv-cell ${getLtvClass(ltvRatio)}`}>
                        {formatNumber(ltvRatio, 2)}%
                      </td>
                      <td className="actions-cell">
                        {isSelected ? (
                          <button
                            className="deselect-btn"
                            onClick={() => setSelectedObligationId(null)}
                          >
                            Deselect
                          </button>
                        ) : (
                          <button
                            className="select-btn"
                            onClick={() =>
                              setSelectedObligationId(obl.obligationId)
                            }
                          >
                            Select
                          </button>
                        )}

                        {isLocked && (
                          <button
                            className="unlock-btn"
                            onClick={() =>
                              handleUnlockObligation(
                                obl.obligationId,
                                obl.lockType
                              )
                            }
                            disabled={
                              isUnlockingObligation &&
                              unlockingObligationId === obl.obligationId
                            }
                          >
                            {isUnlockingObligation &&
                            unlockingObligationId === obl.obligationId
                              ? "Unlocking..."
                              : "Unlock"}
                          </button>
                        )}

                        {/* Add collateral button for empty obligations */}
                        {isEmpty && !isLocked && (
                          <button
                            className="add-collateral-btn"
                            onClick={() => {
                              setSelectedObligationId(obl.obligationId);
                              handleAddCollateralClick();
                            }}
                          >
                            Add Collateral
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Selected Obligation Details */}
            {selectedObligationId && (
              <div className="selected-obligation-details">
                <h3>Selected Obligation Details</h3>
                {(() => {
                  const obl = userObligations.find(
                    (o) => o.obligationId === selectedObligationId
                  );
                  if (!obl) return <p>Obligation not found</p>;

                  // Calculate LTV ratio for this obligation
                  const ltvRatio =
                    obl.totalCollateralUSD > 0
                      ? (obl.totalBorrowUSD / obl.totalCollateralUSD) * 100
                      : 0;

                  return (
                    <div className="obligation-detail-card">
                      <div className="obligation-header">
                        <h4>
                          {obl.obligationId.slice(0, 8)}...
                          {obl.obligationId.slice(-8)}
                          {obl.isLocked && (
                            <span className="locked-badge">🔒 Locked</span>
                          )}
                        </h4>
                      </div>

                      <div className="obligation-stats">
                        <div className="stat-item">
                          <span className="stat-label">Total Collateral:</span>
                          <span className="stat-value">
                            ${formatNumber(obl.totalCollateralUSD, 2)}
                          </span>
                        </div>
                        <div className="stat-item">
                          <span className="stat-label">Total Borrows:</span>
                          <span className="stat-value">
                            ${formatNumber(obl.totalBorrowUSD, 2)}
                          </span>
                        </div>
                        <div className="stat-item">
                          <span className="stat-label">Loan-to-Value:</span>
                          <span
                            className={`stat-value ltv ${getLtvClass(
                              ltvRatio
                            )}`}
                          >
                            {formatNumber(ltvRatio, 2)}%
                          </span>
                        </div>
                        {obl.riskLevel !== undefined && (
                          <div className="stat-item">
                            <span className="stat-label">Risk Level:</span>
                            <span
                              className={`stat-value risk-${getRiskCategory(
                                obl.riskLevel
                              )}`}
                            >
                              {getRiskCategory(obl.riskLevel).toUpperCase()}
                            </span>
                          </div>
                        )}
                      </div>

                      {obl.collaterals.length > 0 && (
                        <div className="collateral-list">
                          <h5>Collateral Assets</h5>
                          <ul>
                            {obl.collaterals.map((c, index) => (
                              <li key={`coll-${index}`}>
                                {formatNumber(c.amount, 6)} {c.symbol} ($
                                {formatNumber(c.usd, 2)})
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {obl.borrows.length > 0 && (
                        <div className="borrows-list">
                          <h5>Borrowed Assets</h5>
                          <ul>
                            {obl.borrows.map((b, index) => (
                              <li key={`borrow-${index}`}>
                                {formatNumber(b.amount, 6)} {b.symbol} ($
                                {formatNumber(b.usd, 2)})
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {obl.isLocked && (
                        <div className="unlock-container">
                          <button
                            className="unlock-btn"
                            onClick={() =>
                              handleUnlockObligation(
                                obl.obligationId,
                                obl.lockType
                              )
                            }
                            disabled={isUnlockingObligation}
                          >
                            {isUnlockingObligation
                              ? "Unlocking..."
                              : "Unlock Obligation"}
                          </button>
                          <p className="lock-info">
                            {obl.lockType === "boost"
                              ? "This obligation is locked due to boost staking."
                              : "This obligation is locked due to borrow incentive staking."}
                          </p>
                        </div>
                      )}

                      {/* Add collateral button for empty obligations in details section */}
                      {obl.isEmpty && !obl.isLocked && (
                        <div className="add-collateral-container">
                          <button
                            className="add-collateral-btn"
                            onClick={() => handleAddCollateralClick()}
                          >
                            Add Collateral
                          </button>
                          <p className="info-text">
                            This obligation has no collateral. Add collateral to
                            enable borrowing.
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // Helper function to classify risk levels
  const getRiskCategory = (riskLevel?: number): string => {
    if (riskLevel === undefined) return "unknown";
    if (riskLevel < 0.25) return "low";
    if (riskLevel < 0.5) return "medium";
    if (riskLevel < 0.75) return "high";
    return "extreme";
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

      {/* Wallet Totals Summary */}
      {connected && account?.address && walletTotals && (
        <div className="wallet-totals-summary">
          <h2>Your Wallet Positions</h2>
          <div className="totals-container">
            <div className="total-item">
              <span className="total-label">Total Collateral:</span>
              <span className="total-value">
                ${formatNumber(walletTotals.totalCollateralUSD, 2)}
              </span>
            </div>
            <div className="total-item">
              <span className="total-label">Total Borrowed:</span>
              <span className="total-value">
                ${formatNumber(walletTotals.totalBorrowUSD, 2)}
              </span>
            </div>
            <div className="total-item">
              <span className="total-label">Active Obligations:</span>
              <span className="total-value">
                {walletTotals.activeObligationCount} of {userObligations.length}
              </span>
            </div>
            {walletTotals.totalBorrowUSD > 0 &&
              walletTotals.totalCollateralUSD > 0 && (
                <div className="total-item">
                  <span className="total-label">Overall Loan-to-Value:</span>
                  <span className="total-value">
                    {formatNumber(
                      (walletTotals.totalBorrowUSD /
                        walletTotals.totalCollateralUSD) *
                        100,
                      2
                    )}
                    %
                  </span>
                  <span className="total-note">
                    (Individual obligation LTVs determine liquidation risk)
                  </span>
                </div>
              )}
          </div>

          {/* Top Collaterals Summary */}
          {Object.keys(walletTotals.collateralsBySymbol).length > 0 && (
            <div className="assets-summary">
              <h3>Top Collaterals</h3>
              <div className="assets-grid">
                {Object.values(walletTotals.collateralsBySymbol)
                  .sort((a, b) => b.totalUSD - a.totalUSD)
                  .slice(0, 3)
                  .map((asset) => (
                    <div className="asset-item" key={`coll-${asset.symbol}`}>
                      <span className="asset-symbol">{asset.symbol}</span>
                      <span className="asset-amount">
                        {formatNumber(asset.totalAmount, 4)}
                      </span>
                      <span className="asset-value">
                        ${formatNumber(asset.totalUSD, 2)}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Top Borrows Summary */}
          {Object.keys(walletTotals.borrowsBySymbol).length > 0 && (
            <div className="assets-summary">
              <h3>Top Borrows</h3>
              <div className="assets-grid">
                {Object.values(walletTotals.borrowsBySymbol)
                  .sort((a, b) => b.totalUSD - a.totalUSD)
                  .slice(0, 3)
                  .map((asset) => (
                    <div className="asset-item" key={`borr-${asset.symbol}`}>
                      <span className="asset-symbol">{asset.symbol}</span>
                      <span className="asset-amount">
                        {formatNumber(asset.totalAmount, 4)}
                      </span>
                      <span className="asset-value">
                        ${formatNumber(asset.totalUSD, 2)}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Enhanced Selected Obligation Banner */}
      {connected && selectedObligationId && (
        <div className="selected-obligation-banner">
          <div className="selected-obligation-header">
            <div className="obligation-title">
              <span className="label">Selected Obligation:</span>
              <span className="value">
                {selectedObligationId.slice(0, 8)}...
                {selectedObligationId.slice(-8)}
              </span>
              {(() => {
                const obl = userObligations.find(
                  (o) => o.obligationId === selectedObligationId
                );
                if (obl?.isLocked) {
                  return <span className="locked-indicator">🔒 Locked</span>;
                }
                return null;
              })()}
              <button
                className="change-btn"
                onClick={() => setActiveTab("obligations")}
              >
                Change
              </button>
            </div>

            {(() => {
              const obl = userObligations.find(
                (o) => o.obligationId === selectedObligationId
              );
              if (!obl) return null;

              // Calculate LTV ratio for this obligation
              const ltvRatio =
                obl.totalCollateralUSD > 0
                  ? (obl.totalBorrowUSD / obl.totalCollateralUSD) * 100
                  : 0;

              return (
                <div className="obligation-summary">
                  <div className="summary-item">
                    <span className="summary-label">Collateral:</span>
                    <span className="summary-value">
                      ${formatNumber(obl.totalCollateralUSD, 2)}
                    </span>
                  </div>
                  <div className="summary-item">
                    <span className="summary-label">Borrowed:</span>
                    <span className="summary-value">
                      ${formatNumber(obl.totalBorrowUSD, 2)}
                    </span>
                  </div>
                  <div className="summary-item">
                    <span className="summary-label">LTV:</span>
                    <span className={`summary-value ${getLtvClass(ltvRatio)}`}>
                      {formatNumber(ltvRatio, 2)}%
                    </span>
                  </div>
                  {obl.riskLevel !== undefined && (
                    <div className="summary-item">
                      <span className="summary-label">Risk:</span>
                      <span
                        className={`summary-value risk-${getRiskCategory(
                          obl.riskLevel
                        )}`}
                      >
                        {getRiskCategory(obl.riskLevel).toUpperCase()}
                      </span>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {(() => {
            const obl = userObligations.find(
              (o) => o.obligationId === selectedObligationId
            );
            if (!obl) return null;

            return (
              <div className="obligation-details-preview">
                {obl.isLocked && (
                  <div className="warning-message locked">
                    <span className="icon">🔒</span>
                    This obligation is locked. You need to unlock it before
                    making changes.
                    <button
                      className="action-btn unlock-btn"
                      onClick={() =>
                        handleUnlockObligation(obl.obligationId, obl.lockType)
                      }
                      disabled={isUnlockingObligation}
                    >
                      {isUnlockingObligation ? "Unlocking..." : "Unlock"}
                    </button>
                  </div>
                )}

                {!obl.isLocked && obl.collaterals.length === 0 && (
                  <div className="warning-message empty">
                    <span className="icon">⚠️</span>
                    This obligation has no collateral yet. Add collateral to
                    enable borrowing.
                    <button
                      className="action-btn add-collateral-btn"
                      onClick={() => handleAddCollateralClick()}
                    >
                      Add Collateral
                    </button>
                  </div>
                )}

                {obl.collaterals.length > 0 && (
                  <div className="assets-preview">
                    <div className="collateral-preview">
                      <h4>Collateral</h4>
                      <div className="assets-list">
                        {obl.collaterals.map((c, index) => (
                          <div
                            className="asset-item"
                            key={`coll-preview-${index}`}
                          >
                            {c.symbol}: {formatNumber(c.amount, 4)} ($
                            {formatNumber(c.usd, 2)})
                          </div>
                        ))}
                      </div>
                    </div>

                    {obl.borrows.length > 0 && (
                      <div className="borrows-preview">
                        <h4>Borrows</h4>
                        <div className="assets-list">
                          {obl.borrows.map((b, index) => (
                            <div
                              className="asset-item"
                              key={`borr-preview-${index}`}
                            >
                              {b.symbol}: {formatNumber(b.amount, 4)} ($
                              {formatNumber(b.usd, 2)})
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* Warning/Error Message Area */}
      {error && <div className="error-message">{error}</div>}

      {/* Obligation Selection Prompt (if no obligation is selected) */}
      {connected && !selectedObligationId && activeTab !== "obligations" && (
        <div className="obligation-prompt">
          <p>You need to select an obligation account first.</p>
          <button
            className="select-obligation-btn"
            onClick={() => setActiveTab("obligations")}
          >
            Select Obligation
          </button>
        </div>
      )}

      {/* Pending Rewards Banner */}
      {connected && pendingRewards.length > 0 && (
        <div className="rewards-banner">
          <h3>Pending Rewards</h3>
          <ul>
            {pendingRewards.map((r) => (
              <li key={r.symbol}>
                {r.amount.toFixed(6)} {r.symbol} (~$
                {r.valueUSD.toFixed(4)})
              </li>
            ))}
          </ul>
          <button
            className="claim-btn"
            onClick={() => {
              console.log("Claim All button clicked");
              openClaimRewardsModal();
            }}
          >
            Claim All
          </button>
        </div>
      )}

      {/* User Collateral Positions */}
      {connected && account?.address && userCollateral.length > 0 && (
        <div className="user-positions-summary collateral">
          <h3>Your Collateral Positions</h3>
          <div className="user-positions-grid">
            {userCollateral.map((asset) => (
              <div
                className="user-position-card collateral"
                key={`collateral-${asset.symbol}`}
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
                  </div>
                  <div className="position-actions">
                    <button
                      className="deposit-collateral-btn"
                      onClick={() => {
                        const marketAsset = assets.find(
                          (a) =>
                            a.symbol.toLowerCase() ===
                            asset.symbol.toLowerCase()
                        );
                        if (marketAsset) {
                          openCollateralModal(
                            marketAsset,
                            "deposit-collateral"
                          );
                        }
                      }}
                      disabled={loading || !selectedObligationId}
                    >
                      Add Collateral
                    </button>
                    <button
                      className="withdraw-collateral-btn"
                      onClick={() => {
                        const marketAsset = assets.find(
                          (a) =>
                            a.symbol.toLowerCase() ===
                            asset.symbol.toLowerCase()
                        );
                        if (marketAsset) {
                          openCollateralModal(
                            marketAsset,
                            "withdraw-collateral"
                          );
                        }
                      }}
                      disabled={loading || !selectedObligationId}
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
                          // Pass the current supplied amount to the modal
                          openModal(
                            {
                              ...marketAsset,
                              suppliedAmount: asset.amount,
                            },
                            "withdraw"
                          );
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
                          openRepaymentModal(marketAsset);
                        }
                      }}
                      disabled={loading || !selectedObligationId}
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
                      disabled={loading || !selectedObligationId}
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
        <button
          className={activeTab === "obligations" ? "active" : ""}
          onClick={() => setActiveTab("obligations")}
        >
          OBLIGATIONS
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === "obligations" ? (
        renderObligationsTab()
      ) : (
        /* Market Table for Lending and Borrowing tabs */
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
                <th>
                  {activeTab === "lending" ? "Your Supply" : "Your Collateral"}
                </th>
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
                    collateralAmount,
                    hasCollateral,
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
                          ) : hasCollateral ? (
                            <span className="user-value">
                              {collateralAmount.toLocaleString(undefined, {
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
                                      suppliedAmount,
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
                                handleAddCollateralClick({
                                  symbol,
                                  coinType,
                                  depositApy,
                                  borrowApy,
                                  decimals,
                                  marketSize,
                                  totalBorrow,
                                  utilization,
                                  price,
                                })
                              }
                              className="deposit-collateral-btn"
                              disabled={
                                loading || !connected || !selectedObligationId
                              }
                            >
                              Deposit Collateral
                            </button>
                            {hasCollateral && (
                              <button
                                onClick={() =>
                                  openCollateralModal(
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
                                    "withdraw-collateral"
                                  )
                                }
                                className="withdraw-collateral-btn"
                                disabled={
                                  loading || !connected || !selectedObligationId
                                }
                              >
                                Withdraw Collateral
                              </button>
                            )}
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
                                loading ||
                                !connected ||
                                !hasObligationAccount ||
                                !selectedObligationId
                              }
                            >
                              Borrow
                            </button>
                            {/* Add Repay button for all assets in borrowing tab */}
                            <button
                              onClick={() =>
                                openRepaymentModal({
                                  symbol,
                                  coinType,
                                  depositApy,
                                  borrowApy,
                                  decimals,
                                  marketSize,
                                  totalBorrow,
                                  utilization,
                                  price,
                                })
                              }
                              className="repay-btn"
                              disabled={
                                loading || !connected || !selectedObligationId
                              }
                            >
                              Repay
                            </button>
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
      )}

      {/* Lending Action Modal */}
      {modalAsset && (
        <LendingActionModal
          onClose={closeModal}
          asset={modalAsset}
          action={modalAction}
          onSuccess={handleSuccess}
          open={modalOpen}
        />
      )}

      {/* Borrowing Action Modal - UPDATED to pass obligationId */}
      {borrowingModalAsset && selectedObligationId && (
        <BorrowingActionModal
          onClose={closeBorrowingModal}
          defaultBorrowAmount=""
          onSuccess={handleSuccess}
          hasObligation={hasObligationAccount}
          mode="borrow"
          obligationId={selectedObligationId} // Pass selected obligation ID
        />
      )}

      {/* Repayment Modal - UPDATED to pass obligationId */}
      {repaymentModalAsset && selectedObligationId && (
        <RepaymentModal
          onClose={closeRepaymentModal}
          onSuccess={handleSuccess}
          defaultRepayAmount=""
          obligationId={selectedObligationId} // Pass selected obligation ID
        />
      )}

      {/* Collateral Management Modal - UPDATED to pass obligationId */}
      {collateralModalAsset && selectedObligationId && (
        <CollateralManagementModal
          open={collateralModalOpen}
          onClose={closeCollateralModal}
          asset={collateralModalAsset}
          action={collateralModalAction}
          onSuccess={handleSuccess}
          hasObligationAccount={hasObligationAccount}
          obligationId={selectedObligationId} // Pass selected obligation ID
        />
      )}

      {/* Claim Rewards Modal */}
      {showClaimModal && (
        <ClaimRewardsModal
          pendingRewards={pendingRewards}
          onClose={() => setShowClaimModal(false)}
          onClaimed={handleClaimSuccess}
        />
      )}

      {/* Last updated timestamp */}
      <div className="last-updated">
        Last updated: 2025-06-19 00:54:45 UTC by jake1318
      </div>
    </div>
  );
};

export default LendingPage;
