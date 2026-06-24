import { Test, TestingModule } from '@nestjs/testing';
import { ExportProcessor, ExportDonationJobData } from './export.processor';
import { PrismaService } from '../prisma/prisma.service';
import { CSV_HEADERS } from '../common/csv-export.helper';
import { Decimal } from '@prisma/client/runtime/library';
import type { Job } from 'bull';

const makeDonation = (overrides: Record<string, any> = {}) => ({
  id: 'don-2',
  amount: new Decimal('75.00'),
  assetCode: 'USDC',
  txHash: 'txhash-xyz',
  donatedAt: new Date('2024-05-20T00:00:00.000Z'),
  status: 'CONFIRMED',
  donorId: 'user-2',
  campaignId: 'campaign-2',
  isAnonymous: false,
  assetIssuer: null,
  tipAmount: null,
  tipAsset: null,
  tipId: null,
  confirmedAt: null,
  createdAt: new Date('2024-05-20T00:00:00.000Z'),
  campaign: { title: 'Build A School' },
  ...overrides,
});

const makeJob = (data: ExportDonationJobData): Job<ExportDonationJobData> =>
  ({ data, progress: jest.fn() }) as unknown as Job<ExportDonationJobData>;

describe('ExportProcessor – handleDonationExport', () => {
  let processor: ExportProcessor;
  let prismaMock: { donation: { findMany: jest.Mock } };

  beforeEach(async () => {
    prismaMock = { donation: { findMany: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExportProcessor,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    processor = module.get<ExportProcessor>(ExportProcessor);
  });

  it('returns correct rowCount', async () => {
    prismaMock.donation.findMany.mockResolvedValue([
      makeDonation(),
      makeDonation({ id: 'don-3' }),
    ]);

    const result = await processor.handleDonationExport(
      makeJob({ userId: 'user-2' }),
    );

    expect(result.rowCount).toBe(2);
  });

  it('csv header line matches CSV_HEADERS and has no USD Equivalent', async () => {
    prismaMock.donation.findMany.mockResolvedValue([makeDonation()]);

    const { csv } = await processor.handleDonationExport(
      makeJob({ userId: 'user-2' }),
    );
    const headerLine = csv.split('\n')[0];

    expect(headerLine).toBe(CSV_HEADERS.map((h) => `"${h}"`).join(','));
    expect(headerLine).not.toMatch(/usd equivalent/i);
  });

  it('does not emit 0.00 or N/A placeholders', async () => {
    prismaMock.donation.findMany.mockResolvedValue([makeDonation()]);

    const { csv } = await processor.handleDonationExport(
      makeJob({ userId: 'user-2' }),
    );

    expect(csv).not.toMatch(/\b0\.00\b/);
    expect(csv).not.toMatch(/\bN\/A\b/);
  });

  it('includes all expected fields in the data row', async () => {
    prismaMock.donation.findMany.mockResolvedValue([makeDonation()]);

    const { csv } = await processor.handleDonationExport(
      makeJob({ userId: 'user-2' }),
    );
    const dataLine = csv.split('\n')[1];

    expect(dataLine).toContain('75');
    expect(dataLine).toContain('USDC');
    expect(dataLine).toContain('2024-05-20');
    expect(dataLine).toContain('"txhash-xyz"');
  });

  it('returns an empty csv (headers only) when no donations are found', async () => {
    prismaMock.donation.findMany.mockResolvedValue([]);

    const { csv, rowCount } = await processor.handleDonationExport(
      makeJob({ userId: 'user-2' }),
    );

    expect(rowCount).toBe(0);
    expect(csv.split('\n')).toHaveLength(1);
  });
});
