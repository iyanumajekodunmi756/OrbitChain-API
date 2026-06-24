import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { MilestonesService } from './milestones.service';
import { PrismaService } from '../prisma/prisma.service';

describe('MilestonesService', () => {
  let service: MilestonesService;
  let prisma: {
    campaign: { findUnique: jest.Mock };
    milestone: { findUnique: jest.Mock };
    fundRelease: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      groupBy: jest.Mock;
    };
  };

  const CREATOR_ID = 'creator-1';
  const OTHER_ID = 'someone-else';
  const CAMPAIGN_ID = 'campaign-1';
  const MILESTONE_ID = 'milestone-1';
  const RELEASE_ID = 'release-1';

  const campaign = { id: CAMPAIGN_ID, creatorId: CREATOR_ID };
  const milestone = {
    id: MILESTONE_ID,
    campaignId: CAMPAIGN_ID,
    status: 'UNLOCKED',
    targetAmount: { toString: () => '1000' },
  };

  const baseRelease = {
    id: RELEASE_ID,
    milestoneId: MILESTONE_ID,
    campaignId: CAMPAIGN_ID,
    creatorId: CREATOR_ID,
    amount: { toString: () => '500' },
    status: 'PENDING',
    txHash: null,
    releaseReason: null,
    approvedAt: null,
    releasedAt: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  beforeEach(async () => {
    prisma = {
      campaign: { findUnique: jest.fn().mockResolvedValue(campaign) },
      milestone: { findUnique: jest.fn().mockResolvedValue(milestone) },
      fundRelease: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(baseRelease),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue(baseRelease),
        update: jest
          .fn()
          .mockResolvedValue({ ...baseRelease, status: 'CANCELLED' }),
        groupBy: jest.fn().mockResolvedValue([]),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MilestonesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<MilestonesService>(MilestonesService);
  });

  describe('requestFundRelease', () => {
    const dto = { amount: '500' } as any;

    it('creates a PENDING fund release for the campaign creator', async () => {
      const result = await service.requestFundRelease(
        CAMPAIGN_ID,
        MILESTONE_ID,
        CREATOR_ID,
        dto,
      );

      expect(result.status).toBe('PENDING');
      expect(result.amount).toBe('500');
      expect(prisma.fundRelease.create).toHaveBeenCalledTimes(1);
    });

    it('throws NotFoundException when the campaign is missing', async () => {
      prisma.campaign.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.requestFundRelease(CAMPAIGN_ID, MILESTONE_ID, CREATOR_ID, dto),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ForbiddenException when caller is not the creator', async () => {
      await expect(
        service.requestFundRelease(CAMPAIGN_ID, MILESTONE_ID, OTHER_ID, dto),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws BadRequestException when the milestone is not UNLOCKED', async () => {
      prisma.milestone.findUnique.mockResolvedValueOnce({
        ...milestone,
        status: 'PENDING',
      });
      await expect(
        service.requestFundRelease(CAMPAIGN_ID, MILESTONE_ID, CREATOR_ID, dto),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException when amount exceeds the milestone target', async () => {
      await expect(
        service.requestFundRelease(CAMPAIGN_ID, MILESTONE_ID, CREATOR_ID, {
          amount: '5000',
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when a PENDING release already exists', async () => {
      prisma.fundRelease.findFirst.mockResolvedValueOnce(baseRelease);
      await expect(
        service.requestFundRelease(CAMPAIGN_ID, MILESTONE_ID, CREATOR_ID, dto),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.fundRelease.create).not.toHaveBeenCalled();
    });
  });

  describe('cancelFundRelease', () => {
    it('cancels a PENDING release for its creator', async () => {
      const result = await service.cancelFundRelease(RELEASE_ID, CREATOR_ID);
      expect(result.status).toBe('CANCELLED');
      expect(prisma.fundRelease.update).toHaveBeenCalledWith({
        where: { id: RELEASE_ID },
        data: { status: 'CANCELLED' },
      });
    });

    it('throws NotFoundException when the release is missing', async () => {
      prisma.fundRelease.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.cancelFundRelease(RELEASE_ID, CREATOR_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ForbiddenException for a non-creator', async () => {
      await expect(
        service.cancelFundRelease(RELEASE_ID, OTHER_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws BadRequestException when the release is not PENDING', async () => {
      prisma.fundRelease.findUnique.mockResolvedValueOnce({
        ...baseRelease,
        status: 'RELEASED',
      });
      await expect(
        service.cancelFundRelease(RELEASE_ID, CREATOR_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('getFundReleaseById', () => {
    it('returns the release with campaign title', async () => {
      prisma.fundRelease.findUnique.mockResolvedValueOnce({
        ...baseRelease,
        campaign: { id: CAMPAIGN_ID, title: 'My Campaign' },
      });
      const result = await service.getFundReleaseById(RELEASE_ID, CREATOR_ID);
      expect(result.campaignTitle).toBe('My Campaign');
    });

    it('throws ForbiddenException when a different user requests it', async () => {
      prisma.fundRelease.findUnique.mockResolvedValueOnce({
        ...baseRelease,
        campaign: { id: CAMPAIGN_ID, title: 'My Campaign' },
      });
      await expect(
        service.getFundReleaseById(RELEASE_ID, OTHER_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('getCampaignFundReleaseStats', () => {
    it('aggregates counts and sums grouped by status', async () => {
      prisma.fundRelease.groupBy.mockResolvedValueOnce([
        {
          status: 'PENDING',
          _count: 2,
          _sum: { amount: { toString: () => '300' } },
        },
        {
          status: 'RELEASED',
          _count: 1,
          _sum: { amount: { toString: () => '700' } },
        },
      ]);

      const result = await service.getCampaignFundReleaseStats(CAMPAIGN_ID);

      expect(result.total).toBe(3);
      expect(result.pending).toEqual({ count: 2, amount: '300' });
      expect(result.released).toEqual({ count: 1, amount: '700' });
    });
  });
});
