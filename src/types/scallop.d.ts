// src/types/scallop.d.ts
// Last Updated: 2025-06-05 18:34:20 UTC by jake1318

// Type declarations for Scallop SDK
declare module "@scallop-io/sui-scallop-sdk" {
  export interface ScallopConfig {
    addressId?: string;
    networkType?: "mainnet" | "testnet" | "devnet" | "localnet";
    suiProvider?: any;
    faucet?: boolean;
    secretKey?: string;
  }

  export class Scallop {
    constructor(config?: ScallopConfig);
    createScallopBuilder(): ScallopBuilder;
    createScallopQuery(): ScallopQuery;
    createScallopUtils(): ScallopUtils;
  }

  export interface TransactionEffects {
    status?: {
      status?: string;
    };
    // Add other fields as needed
  }

  export interface TransactionResult {
    digest: string;
    effects?: TransactionEffects;
  }

  export interface ScallopBuilder {
    createTxBlock(): ScallopTxBlock;
    getScallopAddress(): ScallopAddress;
    updateAssetPricesWithVaa?(vaas: Uint8Array[]): Promise<any>;
  }

  export interface ScallopTxBlock {
    setSender(sender: string): void;
    depositQuick(amount: number, coinName: string): Promise<string>;
    withdrawQuick(amount: number, coinName: string): Promise<string>;
    addCollateralQuick(
      amount: number,
      coinName: string,
      obligationId?: string
    ): Promise<void>;
    takeCollateralQuick(
      amount: number,
      coinName: string,
      obligationId?: string
    ): Promise<string>;
    borrowQuick(
      amount: number,
      coinName: string,
      obligationId?: string
    ): Promise<string>;
    repayQuick(
      amount: number,
      coinName: string,
      obligationId?: string
    ): Promise<void>;
    updateAssetPricesQuick(assets: string[]): Promise<void>;
    transferObjects(objects: string[], recipient: string): void;
    txBlock: {
      setGasBudget(amount: number): void;
    };
  }

  export interface ScallopQuery {
    init(): Promise<void>;
    getUserPortfolio(params: { walletAddress: string }): Promise<any>;
    queryMarket(): Promise<any>;
    getMarketsData(): Promise<any>;
    getPricesFromPyth(): Promise<any>;
  }

  export interface ScallopUtils {
    getCoinPrices(): Promise<Record<string, number>>;
  }

  export interface ScallopAddress {
    version: string;
    market: Record<string, string>;
    xOracle: string;
    coinType?: Record<string, string>;
    // Add other properties as needed
  }
}
