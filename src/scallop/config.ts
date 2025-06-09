// src/scallop/config.ts
// Last updated: 2025-06-07 03:33:00 UTC by jake1318

// Determine network type from environment variable or default to mainnet
const networkType = process.env.REACT_APP_NETWORK_TYPE || "mainnet";

export const SUI_NETWORK_CONFIG = {
  networkType,
  rpcUrl:
    networkType === "mainnet"
      ? "https://fullnode.mainnet.sui.io:443"
      : "https://fullnode.testnet.sui.io:443",
  explorerUrl:
    networkType === "mainnet"
      ? "https://suivision.xyz/"
      : "https://testnet.suivision.xyz/",
};

// Scallop package IDs
export const SCALLOP_PACKAGE_IDS = {
  BORROW: "0x83bbe0b3985c5e3857803e2678899b03f3c4a31be75006ab03faf268c014ce41",
  ORACLE: "0x897ebc619bdb4c3d9e8d86fb85b86cfd5d861b1696d26175c55ed14903a372f6",
  RULE: "0x1cf913c825c202cbbb71c378edccb9c04723fa07a73b88677b2ef89c6e203a85",
  USER: "0x35241d7ff3bf163c2fbd3c2b11fb5710d3946c56ccc9c80813a1f8c6f6acdd67",
};

// Coin types
export const COIN_TYPES = {
  SUI: "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI",
  USDC: "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
};

// Configuration for coins
export const COIN_CONFIG = {
  SUI: {
    symbol: "SUI",
    decimals: 9,
    name: "sui",
    type: COIN_TYPES.SUI,
  },
  USDC: {
    symbol: "USDC",
    decimals: 6,
    name: "usdc",
    type: COIN_TYPES.USDC,
  },
};

// Common objects used in transactions - these might need to be fetched dynamically
export const COMMON_OBJECTS = {
  SYSTEM_CLOCK:
    "0x0000000000000000000000000000000000000000000000000000000000000006",
  ORACLE: "0x93d5bf0936b71eb27255941e532fac33b5a5c7759e377b4923af0a1359ad494f",
};
