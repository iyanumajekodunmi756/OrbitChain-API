import {
  buildDonationCsv,
  CSV_HEADERS,
  DonationCsvRow,
} from './csv-export.helper';

const makeRow = (overrides: Partial<DonationCsvRow> = {}): DonationCsvRow => ({
  campaignTitle: 'Test Campaign',
  amount: '100.5',
  assetCode: 'XLM',
  donatedAt: new Date('2024-03-15T12:00:00.000Z'),
  txHash: 'abc123txhash',
  ...overrides,
});

describe('buildDonationCsv', () => {
  it('produces a header-only CSV when given no rows', () => {
    const csv = buildDonationCsv([]);
    expect(csv).toBe(CSV_HEADERS.map((h) => `"${h}"`).join(','));
  });

  it('outputs the correct number of lines (header + one per row)', () => {
    const csv = buildDonationCsv([makeRow(), makeRow()]);
    expect(csv.split('\n')).toHaveLength(3);
  });

  it('does NOT include a USD Equivalent column', () => {
    const csv = buildDonationCsv([makeRow()]);
    expect(csv).not.toMatch(/usd equivalent/i);
    expect(csv).not.toMatch(/0\.00/);
    expect(csv).not.toMatch(/N\/A/);
  });

  it('formats the date as YYYY-MM-DD', () => {
    const csv = buildDonationCsv([makeRow()]);
    expect(csv).toContain('2024-03-15');
  });

  it('includes all expected fields in a data row', () => {
    const csv = buildDonationCsv([makeRow()]);
    const lines = csv.split('\n');
    const dataLine = lines[1];
    expect(dataLine).toContain('"Test Campaign"');
    expect(dataLine).toContain('100.5');
    expect(dataLine).toContain('XLM');
    expect(dataLine).toContain('2024-03-15');
    expect(dataLine).toContain('"abc123txhash"');
  });

  it('escapes double-quotes inside campaign titles', () => {
    const csv = buildDonationCsv([makeRow({ campaignTitle: 'Say "Hello"' })]);
    expect(csv).toContain('"Say ""Hello"""');
  });

  it('falls back to "Unknown" when campaignTitle is empty', () => {
    const csv = buildDonationCsv([makeRow({ campaignTitle: '' })]);
    expect(csv).toContain('"Unknown"');
  });

  it('handles a null txHash gracefully', () => {
    const csv = buildDonationCsv([makeRow({ txHash: null })]);
    const dataLine = csv.split('\n')[1];
    expect(dataLine).toContain('""');
  });

  it('produces exactly 5 columns per row (no USD Equivalent)', () => {
    const csv = buildDonationCsv([makeRow()]);
    const headerCols = csv.split('\n')[0].split(',');
    const dataCols = csv.split('\n')[1].split(',');
    expect(headerCols).toHaveLength(CSV_HEADERS.length);
    expect(dataCols).toHaveLength(CSV_HEADERS.length);
    expect(CSV_HEADERS.length).toBe(5);
  });
});
