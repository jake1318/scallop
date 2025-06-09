// src/pages/LendingPage.tsx

import React, { useState, useEffect, useCallback, useRef } from "react";
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import { useWallet } from "@suiet/wallet-kit";
import {
  fetchLendingData,
  deposit,
  withdraw,
  borrow,
  repay,
} from "../services/suilendService";
import AccountOverview from "../components/AccountOverview";
import DepositedAssets from "../components/DepositedAssets";
import MarketTable from "../components/MarketTable";
import MarketReserves from "../components/MarketReserves";
import "../styles/theme.scss";

const RPC_URL = getFullnodeUrl("mainnet");
const walletClient = new SuiClient({ url: RPC_URL });
// Remove POLL_INTERVAL constant

interface ReserveRow {
  coinType: string;
  symbol: string;
  decimals: number;
  priceUsd: number;
  depositAmount: number;
  depositValue: number;
  borrowAmount: number;
  borrowValue: number;
  ltv: number;
  borrowWeight: string | number;
  depositApr: number;
  borrowApr: number;
}

interface UserAsset {
  coinType: string;
  symbol: string;
  amount: number;
  valueUSD: number;
}

const LendingPage: React.FC = () => {
  const { address, signAndExecuteTransactionBlock } = useWallet();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchingRef = useRef(false); // Prevent concurrent fetches

  const [coinMetadataMap, setCoinMetadataMap] = useState<Record<string, any>>(
    {}
  );
  const [marketRaw, setMarketRaw] = useState<any>(null);
  const [ownerCaps, setOwnerCaps] = useState<any[]>([]);
  const [obligations, setObligations] = useState<any[]>([]);

  // UI State
  const [reserves, setReserves] = useState<ReserveRow[]>([]);
  const [userDeposits, setUserDeposits] = useState<UserAsset[]>([]);
  const [userBorrows, setUserBorrows] = useState<UserAsset[]>([]);
  const [accountSummary, setAccountSummary] = useState({
    equityUSD: 0,
    totalDepositsUSD: 0,
    totalBorrowsUSD: 0,
    netAPR: 0,
    borrowLimitUSD: 0,
    liqThresholdUSD: 0,
    weightedBorrowUSD: 0,
  });

  // Modal state
  const [modal, setModal] = useState<{
    type: "deposit" | "withdraw" | "borrow" | "repay";
    asset: ReserveRow;
    walletBalance: number;
  } | null>(null);
  const [modalAmount, setModalAmount] = useState("");
  const [modalErr, setModalErr] = useState<string | null>(null);
  const [modalLoading, setModalLoading] = useState(false);

  // Define fetchData as a callback to prevent unnecessary re-renders
  const fetchData = useCallback(async () => {
    if (!address || fetchingRef.current) return;

    fetchingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      console.log("Fetching lending data...");
      const data = await fetchLendingData(address);
      setCoinMetadataMap(data.coinMetadataMap);
      setMarketRaw(data.lendingMarket);
      setOwnerCaps(data.obligationOwnerCaps ?? []);
      setObligations(data.obligations ?? []);
    } catch (e: any) {
      console.error(e);
      setError("Failed to fetch lending data");
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, [address]);

  // Fetch on mount/address change, but don't poll
  useEffect(() => {
    if (!address) return;

    // Initial fetch when component mounts or address changes
    fetchData();

    // No interval setup - we've removed the polling
  }, [address, fetchData]);

  // Re-compute UI data whenever raw changes
  useEffect(() => {
    if (!marketRaw) return;
    const cm = coinMetadataMap;

    // 1) Build reserves
    const newReserves: ReserveRow[] = marketRaw.reserves.map((r: any) => {
      const ct = r.token.coinType;
      const meta = cm[ct] || {};
      const symbol = meta.symbol || ct.split("::").pop()!;
      const decimals = meta.decimals ?? 0;
      const priceUsd = meta.priceUsd ?? meta.priceUSD ?? 0;

      const stats = r.stats ?? {};
      const depAmt =
        Number(stats.totalSupply ?? stats.total_supply ?? 0) / 10 ** decimals;
      const borAmt =
        Number(stats.totalBorrowed ?? stats.total_borrowed ?? 0) /
        10 ** decimals;
      const depVal = depAmt * priceUsd;
      const borVal = borAmt * priceUsd;

      const cfg = r.config ?? {};
      const ltv = (cfg.loanToValue ?? cfg.loan_to_value ?? 0) * 100;
      const bw = cfg.borrowWeight ?? cfg.borrow_weight ?? 1;
      const borrowWeight = bw === Infinity || bw === 0 ? "∞" : +bw.toFixed(1);

      const depApr =
        (stats.depositInterestAPR ?? stats.deposit_interest_apr ?? 0) * 100;
      const borApr =
        (stats.borrowInterestAPR ?? stats.borrow_interest_apr ?? 0) * 100;

      return {
        coinType: ct,
        symbol,
        decimals,
        priceUsd,
        depositAmount: depAmt,
        depositValue: depVal,
        borrowAmount: borAmt,
        borrowValue: borVal,
        ltv,
        borrowWeight,
        depositApr: depApr,
        borrowApr: borApr,
      };
    });
    setReserves(newReserves);

    // 2) User deposits / borrows
    const obl = obligations[0] ?? { deposits: [], borrows: [] };
    const uDeps: UserAsset[] = obl.deposits.map((d: any) => {
      const ct = d.reserve;
      const meta = cm[ct] || {};
      const symbol = meta.symbol || ct.split("::").pop()!;
      const decimals = meta.decimals ?? 0;
      const priceUsd = meta.priceUsd ?? meta.priceUSD ?? 0;
      const amt =
        Number(d.liquidityTokenBalance ?? d.amount ?? 0) / 10 ** decimals;
      return { coinType: ct, symbol, amount: amt, valueUSD: amt * priceUsd };
    });
    const uBors: UserAsset[] = obl.borrows.map((b: any) => {
      const ct = b.reserve;
      const meta = cm[ct] || {};
      const symbol = meta.symbol || ct.split("::").pop()!;
      const decimals = meta.decimals ?? 0;
      const priceUsd = meta.priceUsd ?? meta.priceUSD ?? 0;
      const amt = Number(b.borrowedBalance ?? b.amount ?? 0) / 10 ** decimals;
      return { coinType: ct, symbol, amount: amt, valueUSD: amt * priceUsd };
    });
    setUserDeposits(uDeps);
    setUserBorrows(uBors);

    // 3) Account summary
    const totDep = uDeps.reduce((sum, x) => sum + x.valueUSD, 0);
    const totBor = uBors.reduce((sum, x) => sum + x.valueUSD, 0);
    let borrowLimit = 0,
      liqTh = 0,
      wBorrow = 0;
    uDeps.forEach((d) => {
      const row = newReserves.find((r) => r.symbol === d.symbol);
      if (row) {
        borrowLimit += d.valueUSD * (row.ltv / 100);
        liqTh += d.valueUSD * ((row.ltv + 5) / 100);
      }
    });
    uBors.forEach((b) => {
      const row = newReserves.find((r) => r.symbol === b.symbol)!;
      wBorrow +=
        b.valueUSD *
        (typeof row.borrowWeight === "number" ? row.borrowWeight : 1);
    });
    const equity = totDep - totBor;
    setAccountSummary({
      equityUSD: equity,
      totalDepositsUSD: totDep,
      totalBorrowsUSD: totBor,
      netAPR: 0,
      borrowLimitUSD: borrowLimit,
      liqThresholdUSD: liqTh,
      weightedBorrowUSD: wBorrow,
    });
  }, [marketRaw, coinMetadataMap, obligations]);

  // Open modal & fetch wallet balance
  const openModal = async (
    type: "deposit" | "withdraw" | "borrow" | "repay",
    asset: ReserveRow
  ) => {
    setModal(null);
    let bal = 0;
    try {
      const balRes = await walletClient.getBalance({
        owner: address!,
        coinType: asset.coinType,
      });
      bal = Number(balRes.totalBalance) / 10 ** asset.decimals;
    } catch {
      bal = 0;
    }
    setModal({ type, asset, walletBalance: bal });
    setModalAmount("");
    setModalErr(null);
  };

  // Confirm action
  const confirm = async () => {
    if (!modal || !address) return;
    const { type, asset } = modal;
    const num = parseFloat(modalAmount);
    if (isNaN(num) || num <= 0) {
      setModalErr("Invalid amount");
      return;
    }
    setModalLoading(true);
    try {
      const baseAmt = BigInt(Math.floor(num * 10 ** asset.decimals));
      const tx = new Transaction();
      if (type === "deposit") {
        await deposit(address, asset.coinType, baseAmt, tx);
      } else if (type === "withdraw") {
        await withdraw(address, asset.coinType, baseAmt, tx);
      } else if (type === "borrow") {
        await borrow(address, asset.coinType, baseAmt, tx);
      } else {
        await repay(address, asset.coinType, baseAmt, tx);
      }
      await signAndExecuteTransactionBlock({ transactionBlock: tx });

      // Refresh data after transaction
      const data = await fetchLendingData(address);
      setCoinMetadataMap(data.coinMetadataMap);
      setMarketRaw(data.lendingMarket);
      setObligations(data.obligations ?? []);
      setOwnerCaps(data.obligationOwnerCaps ?? []);

      setModal(null);
    } catch (e: any) {
      console.error(e);
      setModalErr(e.message || "Tx failed");
    } finally {
      setModalLoading(false);
    }
  };

  if (!address) return <p>Please connect wallet</p>;
  if (loading) return <p>Loading…</p>;
  if (error) return <p className="error">{error}</p>;

  return (
    <div className="page lending-page">
      <AccountOverview
        equityUSD={accountSummary.equityUSD}
        totalDepositsUSD={accountSummary.totalDepositsUSD}
        totalBorrowsUSD={accountSummary.totalBorrowsUSD}
        netAPR={accountSummary.netAPR}
        weightedBorrowUSD={accountSummary.weightedBorrowUSD}
        borrowLimitUSD={accountSummary.borrowLimitUSD}
        liqThresholdUSD={accountSummary.liqThresholdUSD}
      />

      <DepositedAssets deposits={userDeposits} />

      {/* Disable auto-refresh by setting refreshInterval to 0 */}
      <MarketReserves refreshInterval={0} />

      <MarketTable
        reserves={reserves}
        totalDepositsUSD={accountSummary.totalDepositsUSD}
        totalBorrowsUSD={accountSummary.totalBorrowsUSD}
        totalValueLockedUSD={
          accountSummary.totalDepositsUSD - accountSummary.totalBorrowsUSD
        }
        onAction={openModal}
      />

      {/* Add manual refresh button */}
      <div className="manual-refresh-container">
        <button
          onClick={fetchData}
          disabled={loading || fetchingRef.current}
          className="manual-refresh-button"
        >
          {loading ? "Refreshing..." : "Refresh Data"}
        </button>
      </div>

      {modal && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>
              {modal.type.charAt(0).toUpperCase() + modal.type.slice(1)}{" "}
              {modal.asset.symbol}
            </h3>
            <p>
              Wallet balance: {modal.walletBalance.toFixed(6)}{" "}
              {modal.asset.symbol}
            </p>
            <input
              type="number"
              step="any"
              value={modalAmount}
              onChange={(e) => setModalAmount(e.target.value)}
              placeholder="Amount"
            />
            {modalErr && <p className="error">{modalErr}</p>}
            <button onClick={confirm} disabled={modalLoading}>
              {modalLoading ? "Processing…" : "Confirm"}
            </button>
            <button onClick={() => setModal(null)} disabled={modalLoading}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default LendingPage;
