import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_EXPORT } from '../queue/queue.constants';
import { CSV_HEADERS } from '../common/csv-export.helper';
import { Decimal } from '@prisma/client/runtime/library';

/** Minimal donation fixture that satisfies the Prisma shape used by the service */
const makeDonation = (overrides: Record<string, any> = {}) => ({
  id: 'don-1',
  amount: new Decimal('50.00'),
  assetCode: 'XLM',
  txHash: 'txhash-abc',
  donatedAt: new Date('2024-01-10T00:00:00.000Z'),
  status: 'CONFIRMED',
  donorId: 'user-1',
  campaignId: 'campaign-1',
  isAnonymous: false,
  tipAmount: null,
  tipAsset: null,
  tipId: null,
  confirmedAt: null,
  createdAt: new Date('2024-01-10T00:00:00.000Z'),
  assetIssuer: null,
  campaign: { title: 'My Campaign' },
  ...overrides,
});

describe('UsersService – exportUserDonationsAsCSV (sync path)', () => {
  let service: UsersService;
  let prismaMock: { donation: { count: jest.Mock; findMany: jest.Mock } };
  let queueMock: { add: jest.Mock; getJob: jest.Mock };

  beforeEach(async () => {
    prismaMock = {
      donation: {
        count: jest.fn(),
        findMany: jest.fn(),
      },
    };

    queueMock = { add: jest.fn(), getJob: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: getQueueToken(QUEUE_EXPORT), useValue: queueMock },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('returns queued=false and a csv string for small exports', async () => {
    prismaMock.donation.count.mockResolvedValue(1);
    prismaMock.donation.findMany.mockResolvedValue([makeDonation()]);

    const result = await service.exportUserDonationsAsCSV('user-1');

    expect(result.queued).toBe(false);
    expect(result.jobId).toBeUndefined();
    expect(typeof result.csv).toBe('string');
  });

  it('csv has exactly the expected headers without USD Equivalent', async () => {
    prismaMock.donation.count.mockResolvedValue(1);
    prismaMock.donation.findMany.mockResolvedValue([makeDonation()]);

    const { csv } = await service.exportUserDonationsAsCSV('user-1');
    const headerLine = csv!.split('\n')[0];

    expect(headerLine).toBe(CSV_HEADERS.map((h) => `"${h}"`).join(','));
    expect(headerLine).not.toMatch(/usd equivalent/i);
    expect(headerLine).not.toMatch(/pending/i);
  });

  it('csv data row contains campaign title, amount, asset, date, txhash', async () => {
    prismaMock.donation.count.mockResolvedValue(1);
    prismaMock.donation.findMany.mockResolvedValue([makeDonation()]);

    const { csv } = await service.exportUserDonationsAsCSV('user-1');
    const dataLine = csv!.split('\n')[1];

    expect(dataLine).toContain('"My Campaign"');
    expect(dataLine).toContain('50');
    expect(dataLine).toContain('XLM');
    expect(dataLine).toContain('2024-01-10');
    expect(dataLine).toContain('"txhash-abc"');
  });

  it('csv does not contain hardcoded 0.00 or N/A values', async () => {
    prismaMock.donation.count.mockResolvedValue(1);
    prismaMock.donation.findMany.mockResolvedValue([makeDonation()]);

    const { csv } = await service.exportUserDonationsAsCSV('user-1');

    expect(csv).not.toMatch(/\b0\.00\b/);
    expect(csv).not.toMatch(/\bN\/A\b/);
  });

  it('enqueues job and returns queued=true for large exports', async () => {
    prismaMock.donation.count.mockResolvedValue(501);
    queueMock.add.mockResolvedValue({ id: 'job-99' });

    const result = await service.exportUserDonationsAsCSV('user-1');

    expect(result.queued).toBe(true);
    expect(result.jobId).toBe('job-99');
    expect(result.csv).toBeUndefined();
  });

  it('returns headers-only csv when user has no donations', async () => {
    prismaMock.donation.count.mockResolvedValue(0);
    prismaMock.donation.findMany.mockResolvedValue([]);

    const { csv } = await service.exportUserDonationsAsCSV('user-1');
    const lines = csv!.split('\n');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(CSV_HEADERS.map((h) => `"${h}"`).join(','));
  });
});
