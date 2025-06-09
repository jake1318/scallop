// src/constants/suilendConstants.ts

export const SUILEND_PACKAGE_ID =
  "0x834a86970ae93a73faf4fff16ae40bdb72b91c47be585fff19a2af60a19ddca3";
export const MAIN_POOL_PACKAGE_ID =
  "0xf95b06141ed4a174f239417323bde3f209b972f5930d8521ea38a52aff3a6ddf";
export const LENDING_MARKET_ID =
  "0x84030d26d85eaa7035084a057f2f11f701b7e2e4eda87551becbc7c97505ece1";
export const LENDING_MARKET_TYPE =
  "0x834a86970ae93a73faf4fff16ae40bdb72b91c47be585fff19a2af60a19ddca3::lending_market::LendingMarket<0xf95b06141ed4a174f239417323bde3f209b972f5930d8521ea38a52aff3a6ddf::suilend::MAIN_POOL>";
export const PYTH_PACKAGE_ID =
  "0x04e20ddf36af412a4096f9014f4a565af9e812db9a05cc40254846cf6ed0ad91";
export const PYTH_STATE_ID =
  "0xaeab97f96cf9877fee2883315d459552b2b921edc16d7ceac6eab944dd88919c";

export const RESERVES = {
  SUI: "0x2f50",
  USDC: "0xa57e",
  wUSDC: "0x8f6b",
  USDT: "0x9d08",
  wUSDT: "0x6c1f",
  sSUI: "0x3e0e",
  AUSD: "0x731e",
  SOL: "0x4e1a",
  ETH: "0x7c03",
  LBTC: "0xd26c",
  wBTC: "0x579f",
  DEEP: "0xfef9",
};

export const PRICE_FEEDS = {
  SUI: "0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744",
  USDC: "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
  USDT: "0x2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b",
  BTC: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  ETH: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  SOL: "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
  sSUI: "0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744", // SUI feed
};

export const COIN_TYPES = {
  SUI: "0x2::sui::SUI",
  sSUI: "0xf95b06141ed4a174f239417323bde3f209b972f5930d8521ea38a52aff3a6ddf::springsui::SPRING_SUI",
  USDC: "0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN",
  wUSDC:
    "0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN",
  USDT: "0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN",
  wUSDT:
    "0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN",
  SOL: "0xb7844e289a8410e50fb3ca48d69eb9cf29e27d223ef90353fe1bd8e27ff8f3f8::coin::COIN",
  ETH: "0xaf8cd5edc19c4512f4259f0bee101a40d41ebed738ade5874359610ef8eeced5::coin::COIN",
  wBTC: "0x027792d9fed7f9844eb4839566001bb6f6cb4804f66aa2da6fe1ee242d896881::coin::COIN",
};

export const DEFAULT_LTV = {
  SUI: 75,
  sSUI: 75,
  USDC: 80,
  USDT: 80,
  ETH: 75,
  BTC: 75,
  DEEP: 0,
};
export const DEFAULT_BORROW_WEIGHTS = {
  SUI: 1,
  sSUI: 1,
  USDC: 1,
  USDT: 1,
  ETH: 1.2,
  BTC: 1.2,
};
