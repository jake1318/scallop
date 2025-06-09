import React from "react";
import "../styles/DepositedAssets.scss";

interface Entry {
  symbol: string;
  amount: number;
  valueUSD: number;
}

interface Props {
  deposits: Entry[];
}

const DepositedAssets: React.FC<Props> = ({ deposits }) => (
  <div className="deposited-assets card">
    <div className="card-header">
      <h2>Deposited Assets {deposits.length}</h2>
    </div>
    <div className="assets-list">
      <div className="list-header">
        <span className="col-asset">Asset name</span>
        <span className="col-deposits">Deposits</span>
      </div>
      {deposits.length === 0 && (
        <p className="no-assets">No assets deposited.</p>
      )}
      {deposits.map((d) => (
        <div key={d.symbol} className="asset-row">
          <div className="asset-info">
            <span
              className={`asset-icon icon-${d.symbol.toLowerCase()}`}
            ></span>
            <span className="asset-name">{d.symbol}</span>
          </div>
          <div className="asset-amount">
            <div className="amount">{d.amount.toFixed(2)}</div>
            <div className="amount-usd">${d.valueUSD.toFixed(2)}</div>
          </div>
        </div>
      ))}
    </div>
  </div>
);

export default DepositedAssets;
