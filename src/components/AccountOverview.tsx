// src/components/AccountOverview.tsx

import React, { useState } from "react";
import "../styles/AccountOverview.scss";

interface AccountOverviewProps {
  equityUSD: number;
  totalDepositsUSD: number;
  totalBorrowsUSD: number;
  netAPR: number;
  weightedBorrowUSD: number;
  borrowLimitUSD: number;
  liqThresholdUSD: number;
}

const AccountOverview: React.FC<AccountOverviewProps> = ({
  equityUSD,
  totalDepositsUSD,
  totalBorrowsUSD,
  netAPR,
  weightedBorrowUSD,
  borrowLimitUSD,
  liqThresholdUSD,
}) => {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const toggleBreakdown = () => setShowBreakdown((prev) => !prev);

  // default to 0 if somehow undefined
  const e = equityUSD ?? 0;
  const td = totalDepositsUSD ?? 0;
  const tb = totalBorrowsUSD ?? 0;
  const n = netAPR ?? 0;
  const wb = weightedBorrowUSD ?? 0;
  const bl = borrowLimitUSD ?? 0;
  const lt = liqThresholdUSD ?? 0;

  // avoid division by zero
  const healthPct = lt > 0 ? (wb / lt) * 100 : 0;
  const borrowMarkerPct = lt > 0 ? (bl / lt) * 100 : 0;

  return (
    <div className="account-overview card">
      <div className="card-header">
        <h2>Account</h2>
      </div>

      <div className="summary-line">
        <div>
          Equity <span className="value">${e.toFixed(2)}</span>
        </div>
        <div className="separator">=</div>
        <div>
          Deposits <span className="value">${td.toFixed(2)}</span>
        </div>
        <div className="separator">-</div>
        <div>
          Borrows <span className="value">${tb.toFixed(2)}</span>
        </div>
        <div className="net-apr">
          Net APR <span className="value">{n.toFixed(2)}%</span>
        </div>
      </div>

      <div className="limits-line">
        <div>
          <span className="label">Weighted borrows</span>{" "}
          <span className="value">${wb.toFixed(2)}</span>
        </div>
        <div>
          <span className="label">Borrow limit</span>{" "}
          <span className="value">${bl.toFixed(2)}</span>
        </div>
        <div>
          <span className="label">Liq. threshold</span>{" "}
          <span className="value">${lt.toFixed(2)}</span>
        </div>
      </div>

      <div className="health-bar">
        <div className="bar-bg">
          <div className="bar-fill" style={{ width: `${healthPct}%` }}></div>
          <div
            className="bar-marker borrow-limit-marker"
            style={{ left: `${borrowMarkerPct}%` }}
            title="Borrow Limit"
          ></div>
          <div
            className="bar-marker liq-threshold-marker"
            style={{ left: "100%" }}
            title="Liquidation Threshold"
          ></div>
        </div>
      </div>

      <div className="breakdown-toggle" onClick={toggleBreakdown}>
        {showBreakdown ? "Hide Breakdown ▲" : "Show Breakdown ▼"}
      </div>

      {showBreakdown && (
        <div className="breakdown-details">
          <p>Here would be the detailed breakdown of your positions.</p>
        </div>
      )}
    </div>
  );
};

export default AccountOverview;
