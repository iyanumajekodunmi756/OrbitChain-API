/**
 * Shared helper for building donation CSV exports.
 *
 * The "USD Equivalent" column is intentionally omitted from all CSV exports
 * until a price-oracle integration (Stellar Horizon order-book, CoinGecko,
 * or a self-hosted service) is available. Emitting a hardcoded or placeholder
 * value was flagged as a medium-severity security finding because downstream
 * consumers (tax tools, accounting software, partner integrations) could
 * silently trust an incorrect value.
 *
 * See: https://github.com/OrbitChainLabs/OrbitChain-API/issues/15
 */

export interface DonationCsvRow {
  campaignTitle: string;
  amount: string;
  assetCode: string;
  donatedAt: Date;
  txHash: string | null;
}

/** CSV column headers — "USD Equivalent" is excluded until oracle is ready */
export const CSV_HEADERS = [
  'Campaign',
  'Amount',
  'Asset',
  'Date',
  'Tx Hash',
] as const;

/** Escape a value for safe inclusion inside a double-quoted CSV cell. */
function escapeCsvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Convert an array of donation rows into a CSV string.
 * Returns an empty CSV (headers only) when `rows` is empty.
 */
export function buildDonationCsv(rows: DonationCsvRow[]): string {
  const lines: string[] = [CSV_HEADERS.map((h) => escapeCsvCell(h)).join(',')];

  for (const row of rows) {
    lines.push(
      [
        escapeCsvCell(row.campaignTitle || 'Unknown'),
        row.amount,
        row.assetCode,
        row.donatedAt.toISOString().split('T')[0],
        escapeCsvCell(row.txHash || ''),
      ].join(','),
    );
  }

  return lines.join('\n');
}
