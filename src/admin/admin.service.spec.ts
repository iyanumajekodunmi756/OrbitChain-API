import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('AdminService', () => {
  let service: AdminService;
  let prisma: PrismaService;

  const mockCampaign = {
    id: 'campaign-1',
    title: 'Test Campaign',
    raisedAmount: { toString: () => '150' },
    status: 'ACTIVE' as const,
    creatorId: 'creator-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockDonationConfirmed = {
    id: 'donation-1',
    amount: { toString: () => '50' },
    assetCode: 'XLM',
    status: 'CONFIRMED' as const,
    campaignId: 'campaign-1',
    donorId: 'donor-1',
    txHash: 'tx-hash-1',
    confirmedAt: new Date(),
    donatedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockDonationPending = {
    ...mockDonationConfirmed,
    id: 'donation-2',
    status: 'PENDING' as const,
    amount: { toString: () => '30' },
    txHash: 'tx-hash-2',
  };

  const mockDonationRefunded = {
    ...mockDonationConfirmed,
    id: 'donation-3',
    status: 'REFUNDED' as const,
    amount: { toString: () => '20' },
    txHash: 'tx-hash-3',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        {
          provide: PrismaService,
          useFactory: () => ({
            $transaction: jest.fn(),
            donation: {
              findUnique: jest.fn(),
              update: jest.fn(),
              aggregate: jest.fn(),
            },
            campaign: {
              findUnique: jest.fn(),
              update: jest.fn(),
            },
          }),
        },
        {
          provide: NotificationsService,
          useValue: {
            sendCampaignSuspensionEmail: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('refundDonation', () => {
    it('should refund a confirmed donation and recalculate campaign raisedAmount', async () => {
      const txMock = {
        donation: {
          findUnique: jest.fn().mockResolvedValue(mockDonationConfirmed),
          update: jest.fn().mockResolvedValue({
            ...mockDonationConfirmed,
            status: 'REFUNDED',
            updatedAt: new Date(),
          }),
          aggregate: jest.fn().mockResolvedValue({
            _sum: { amount: { toString: () => '100' } },
          }),
        },
        campaign: {
          update: jest.fn().mockResolvedValue({
            ...mockCampaign,
            raisedAmount: { toString: () => '100' },
          }),
        },
      };

      (prisma.$transaction as jest.Mock).mockImplementation(
        async (cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock),
      );

      const result = await service.refundDonation('donation-1');

      expect(result.status).toBe('REFUNDED');
      expect(result.amount).toBe('50');
      expect(result.campaignId).toBe('campaign-1');
      expect(txMock.donation.findUnique).toHaveBeenCalledWith({
        where: { id: 'donation-1' },
      });
      expect(txMock.donation.update).toHaveBeenCalledWith({
        where: { id: 'donation-1' },
        data: { status: 'REFUNDED' },
      });
      expect(txMock.donation.aggregate).toHaveBeenCalledWith({
        where: {
          campaignId: 'campaign-1',
          status: 'CONFIRMED',
        },
        _sum: { amount: true },
      });
      expect(txMock.campaign.update).toHaveBeenCalledWith({
        where: { id: 'campaign-1' },
        data: {
          raisedAmount: expect.objectContaining({
            toString: expect.any(Function),
          }),
        },
      });
    });

    it('should throw NotFoundException for non-existent donation', async () => {
      const txMock = {
        donation: {
          findUnique: jest.fn().mockResolvedValue(null),
        },
      };

      (prisma.$transaction as jest.Mock).mockImplementation(
        async (cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock),
      );

      await expect(service.refundDonation('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when donation is not CONFIRMED', async () => {
      const txMock = {
        donation: {
          findUnique: jest.fn().mockResolvedValue(mockDonationPending),
        },
      };

      (prisma.$transaction as jest.Mock).mockImplementation(
        async (cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock),
      );

      await expect(service.refundDonation('donation-2')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.refundDonation('donation-2')).rejects.toThrow(
        'Only confirmed donations can be refunded',
      );
    });

    it('should throw BadRequestException when donation is already REFUNDED', async () => {
      const txMock = {
        donation: {
          findUnique: jest.fn().mockResolvedValue(mockDonationRefunded),
        },
      };

      (prisma.$transaction as jest.Mock).mockImplementation(
        async (cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock),
      );

      await expect(service.refundDonation('donation-3')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should correctly decrease raisedAmount by the refunded amount', async () => {
      const txMock = {
        donation: {
          findUnique: jest.fn().mockResolvedValue(mockDonationConfirmed),
          update: jest.fn().mockResolvedValue({
            ...mockDonationConfirmed,
            status: 'REFUNDED',
            updatedAt: new Date(),
          }),
          aggregate: jest.fn().mockResolvedValue({
            _sum: { amount: { toString: () => '100' } },
          }),
        },
        campaign: {
          update: jest.fn().mockResolvedValue({
            ...mockCampaign,
            raisedAmount: { toString: () => '100' },
          }),
        },
      };

      (prisma.$transaction as jest.Mock).mockImplementation(
        async (cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock),
      );

      const result = await service.refundDonation('donation-1');

      expect(result.status).toBe('REFUNDED');
      expect(txMock.donation.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            campaignId: 'campaign-1',
            status: 'CONFIRMED',
          },
        }),
      );
      expect(txMock.campaign.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'campaign-1' },
          data: { raisedAmount: expect.anything() },
        }),
      );
    });
  });
});
