// src/utils/scallopWalletAdapter.ts
// Adapter for Suiet Wallet to Scallop SDK

export interface ScallopWalletAdapter {
  signAndExecuteTransactionBlock: (...args: any[]) => Promise<any>;
  getAddress: () => string;
}

/**
 * Wraps the Suiet Wallet sign function and address so the Scallop SDK sees what it expects.
 * @param signFn The signAndExecuteTransactionBlock from useWallet()
 * @param address The connected wallet address (0x...)
 * @returns An object with .signAndExecuteTransactionBlock and .getAddress()
 */
export function makeSuietScallopAdapter(
  signFn: (args: any) => Promise<any>,
  address: string
): ScallopWalletAdapter {
  return {
    signAndExecuteTransactionBlock: (...args: any[]) => signFn(...args),
    getAddress: () => address,
  };
}
