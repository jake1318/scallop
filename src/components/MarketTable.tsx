// src/components/MarketTable.tsx

import React from "react";
import "../styles/MarketTable.scss";

interface Reserve {
  symbol: string;
  priceUSD: number;
  depositAmount: number;
  depositValue: number;
  borrowAmount: number;
  borrowValue: number;
  ltv: number;
  borrowWeight: number | string;
  depositApr: number;
  borrowApr: number;
}

interface Props {
  reserves: Reserve[];
  totalDepositsUSD: number;
  totalBorrowsUSD: number;
  totalValueLockedUSD: number;
  onAction: (
    type: "deposit" | "withdraw" | "borrow" | "repay",
    asset: Reserve
  ) => void;
}

const MarketTable: React.FC<Props> = ({
  reserves,
  totalDepositsUSD,
  totalBorrowsUSD,
  totalValueLockedUSD,
  onAction,
}) => {
  const fmtNum = (v: number = 0) =>
    v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : v.toFixed(2);

  return (
    <div className="market-table card">
      <div className="card-header">
        <h2>Main Market</h2>
      </div>
      <div className="market-summary">
        <div>
          Deposits <span>${(totalDepositsUSD / 1e6).toFixed(1)}M</span>
        </div>
        <div>
          Borrows <span>${(totalBorrowsUSD / 1e6).toFixed(1)}M</span>
        </div>
        <div>
          TVL <span>${(totalValueLockedUSD / 1e6).toFixed(1)}M</span>
        </div>
      </div>
      <table className="reserves-table">
        <thead>
          <tr>
            <th>Asset name</th>
            <th>Deposits</th>
            <th>Borrows</th>
            <th>LTV / BW</th>
            <th>Deposit APR</th>
            <th>Borrow APR</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {reserves.map((r) => {
            const safeDepositValue = r.depositValue ?? 0;
            const safeBorrowValue = r.borrowValue ?? 0;
            const ltvPct = (r.ltv ?? 0).toFixed(0);
            const bwStr =
              typeof r.borrowWeight === "number"
                ? (r.borrowWeight ?? 0).toFixed(1)
                : r.borrowWeight;
            const depAprStr = (r.depositApr ?? 0).toFixed(2);
            const borAprStr = (r.borrowApr ?? 0).toFixed(2);

            return (
              <tr key={r.symbol}>
                <td>
                  <div className="asset-name">
                    <span
                      className={`asset-icon icon-${r.symbol.toLowerCase()}`}
                    />
                    {r.symbol}
                  </div>
                  <div className="asset-price">
                    ${(r.priceUSD ?? 0).toFixed(2)}
                  </div>
                </td>
                <td>
                  <div>
                    {fmtNum(r.depositAmount)} {r.symbol}
                  </div>
                  <div className="subtext">${fmtNum(safeDepositValue)}</div>
                </td>
                <td>
                  {r.borrowAmount > 0 ? (
                    <>
                      <div>
                        {fmtNum(r.borrowAmount)} {r.symbol}
                      </div>
                      <div className="subtext">${fmtNum(safeBorrowValue)}</div>
                    </>
                  ) : (
                    <span className="subtext">--</span>
                  )}
                </td>
                <td>
                  {ltvPct}% / {bwStr}
                </td>
                <td>{depAprStr}%</td>
                <td>{borAprStr}%</td>
                <td>
                  <button onClick={() => onAction("deposit", r)}>
                    Deposit
                  </button>
                  <button onClick={() => onAction("withdraw", r)}>
                    Withdraw
                  </button>
                  <button onClick={() => onAction("borrow", r)}>Borrow</button>
                  <button onClick={() => onAction("repay", r)}>Repay</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default MarketTable;
