// src/scallop/PythPriceFeedService.ts
// Last Updated: 2025-06-02 19:50:15 UTC by jake1318

/**
 * Service to handle Pyth price feeds and VAAs for Scallop transactions
 */

// Pyth price feed IDs for supported assets
const PYTH_PRICE_FEED_IDS = {
  // These are the official Pyth price feed IDs
  SUI: "0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744",
  USDC: "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
  USDT: "0x2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b",
  ETH: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  BTC: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  SOL: "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
};

class PythPriceFeedService {
  // Hermes API base URL for Pyth price feeds
  private readonly HERMES_API_URL =
    "https://hermes.pyth.network/v2/updates/price";

  /**
   * Fetch the latest VAAs for the specified price feed IDs
   * @param priceIds Array of price feed IDs to fetch
   * @returns Array of base64-encoded VAAs
   */
  async fetchLatestVaas(priceIds: string[]): Promise<string[]> {
    try {
      // Build the query string with all the price feed IDs
      const queryParams = priceIds.map((id) => `ids[]=${id}`).join("&");
      const url = `${this.HERMES_API_URL}/latest?${queryParams}&encoding=base64`;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Pyth API error: ${response.status}`);
      }

      const data = await response.json();

      // Extract the VAAs from the response
      // The response should be an array of update data objects, each with a vaa field
      if (!Array.isArray(data) || data.length === 0) {
        throw new Error("Invalid Pyth API response format");
      }

      const vaas = data.map((item) => item.vaa);
      console.log(`Successfully fetched ${vaas.length} Pyth VAAs`);

      return vaas;
    } catch (error) {
      console.error("Failed to fetch Pyth VAAs:", error);
      throw error;
    }
  }

  /**
   * Get VAAs for specific assets, or all supported assets if none specified
   * @param assets Asset symbols to get VAAs for (e.g., "SUI", "USDC")
   * @returns Array of base64-encoded VAAs
   */
  async getVaas(assets: string[] = ["SUI", "USDC"]): Promise<string[]> {
    // Convert asset symbols to price feed IDs
    const priceIds = assets.map((asset) => {
      const upperAsset = asset.toUpperCase();
      const id =
        PYTH_PRICE_FEED_IDS[upperAsset as keyof typeof PYTH_PRICE_FEED_IDS];

      if (!id) {
        throw new Error(
          `Unsupported asset: ${asset}. No Pyth price feed ID found.`
        );
      }

      return id;
    });

    return this.fetchLatestVaas(priceIds);
  }

  /**
   * Convert base64 VAA to a ByteArray/vector<u8> format that can be used in transactions
   * @param base64Vaa Base64-encoded VAA
   * @returns ByteArray/vector<u8> representation of the VAA
   */
  vaaToByteArray(base64Vaa: string): Uint8Array {
    return Buffer.from(base64Vaa, "base64");
  }
}

// Export singleton instance
const pythPriceFeedService = new PythPriceFeedService();
export default pythPriceFeedService;
