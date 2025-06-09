// src/components/MarketReserves.tsx

import React from "react";
import { useReservesData } from "../hooks/useReservesData";
import "../styles/MarketReserves.scss";

interface MarketReservesProps {
  refreshInterval?: number;
}

const MarketReserves: React.FC<MarketReservesProps> = ({
  refreshInterval = 0, // Default to 0 to disable auto-refresh
}) => {
  const { reserves, loading, error, lastUpdated, refetch } =
    useReservesData(refreshInterval);

  // Format large numbers for display
  const formatNumber = (num: number) => {
    if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
    if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
    if (num >= 1e3) return `${(num / 1e3).toFixed(2)}K`;
    return num.toFixed(2);
  };

  // Calculate total deposits and borrows
  const totalDeposits = reserves.reduce((sum, r) => sum + r.totalDeposits, 0);
  const totalBorrows = reserves.reduce((sum, r) => sum + r.totalBorrows, 0);

  // Get consistent unique keys for assets to prevent React warnings
  const getAssetKey = (asset: string, index: number): string => {
    // Use the index as part of the key to guarantee uniqueness
    return `asset-${asset.toLowerCase()}-${index}`;
  };

  if (error && reserves.length === 0) {
    return (
      <div className="market-reserves card error-card">
        <div className="card-header">
          <h2>Market Reserves</h2>
          <button onClick={refetch} className="refresh-button">
            Retry
          </button>
        </div>
        <div className="error-message">
          Failed to load market data: {error.message}
          <p className="error-help">
            The RPC endpoint may be experiencing high traffic. Please try again
            later.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="market-reserves card">
      <div className="card-header">
        <h2>Market Reserves</h2>
        <button onClick={refetch} className="refresh-button">
          Refresh
        </button>
      </div>

      <div className="market-summary">
        <div className="summary-item">
          <span className="label">Total Deposits</span>
          <span className="value">{formatNumber(totalDeposits)}</span>
        </div>
        <div className="summary-item">
          <span className="label">Total Borrows</span>
          <span className="value">{formatNumber(totalBorrows)}</span>
        </div>
        <div className="summary-item">
          <span className="label">Last Updated</span>
          <span className="value">
            {lastUpdated ? lastUpdated.toLocaleTimeString() : "--"}
          </span>
        </div>
      </div>

      {loading && reserves.length === 0 ? (
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Loading market data...</p>
        </div>
      ) : (
        <div className="reserves-table-container">
          <table className="reserves-table">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Total Deposits</th>
                <th>Total Borrows</th>
                <th>LTV</th>
                <th>Borrow Weight</th>
                <th>Deposit APR</th>
                <th>Borrow APR</th>
              </tr>
            </thead>
            <tbody>
              {reserves.map((reserve, index) => (
                <tr key={getAssetKey(reserve.asset, index)}>
                  <td className="asset-cell">
                    <div className="asset-name">
                      <span
                        className={`asset-icon icon-${reserve.asset.toLowerCase()}`}
                      />
                      {reserve.asset}
                    </div>
                  </td>
                  <td>
                    {formatNumber(reserve.totalDeposits)} {reserve.asset}
                  </td>
                  <td>
                    {formatNumber(reserve.totalBorrows)} {reserve.asset}
                  </td>
                  <td>{reserve.ltv}</td>
                  <td>{reserve.borrowWeight}×</td>
                  <td>{reserve.depositAPR}</td>
                  <td>{reserve.borrowAPR}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {loading && reserves.length > 0 && (
        <div className="loading-indicator">Refreshing data...</div>
      )}

      {error && reserves.length > 0 && (
        <div className="error-banner">
          Error refreshing data: {error.message}
          <button onClick={refetch} className="retry-button">
            Retry
          </button>
        </div>
      )}

      <div className="last-update-info">
        Last updated: 2025-05-28 01:16:12 UTC
        <span className="user-attribution">by jake1318</span>
      </div>
    </div>
  );
};

export default MarketReserves;
