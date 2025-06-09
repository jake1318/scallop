const BLOCKVISION_API_KEY = "2ugIlviim3ywrgFI0BMniB9wdzU";

export async function getAccountCoins(address: string) {
  const res = await fetch(
    `https://api.blockvision.org/v2/sui/account/coins?account=${address}`,
    {
      method: "GET",
      headers: {
        accept: "application/json",
        "x-api-key": BLOCKVISION_API_KEY,
      },
    }
  );
  if (!res.ok) throw new Error("Blockvision failed: " + res.statusText);
  const data = await res.json();
  return data.result?.coins || [];
}

export function getCoinBalance(
  coins: any[],
  coinType: string,
  decimals: number
): number {
  const found = coins.find((c) => c.coinType === coinType);
  if (!found) return 0;
  return Number(found.balance) / 10 ** (decimals || 9);
}
