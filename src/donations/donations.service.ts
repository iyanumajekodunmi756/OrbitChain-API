import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { CampaignsService } from '../campaigns/campaigns.service';
import {
  StellarAcceptedAsset,
  StellarTransactionsService,
} from '../stellar/stellar-transactions.service';
import { CreateDonationDto } from './dto/create-donation.dto';
import {
  DonationResponseDto,
  PlatformTipResponseDto,
} from './dto/donation.dto';
import { buildDonationCsv } from '../common/csv-export.helper';

@Injectable()
export class DonationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly campaigns: CampaignsService,
    private readonly stellarTxs: StellarTransactionsService,
  ) {}

  /** Creates a donation after verifying the transaction on Stellar */
  async createDonation(
    walletAddress: string,
    dto: CreateDonationDto,
  ): Promise<{
    donation: DonationResponseDto;
    tip: PlatformTipResponseDto | null;
  }> {
    if (!walletAddress) {
      throw new BadRequestException('Missing walletAddress in token');
    }

    if (!dto.txHash) {
      throw new BadRequestException('txHash is required');
    }

    const existing = await this.prisma.donation.findUnique({
      where: { txHash: dto.txHash },
    });
    if (existing) {
      // Re-verify PENDING or FAILED donations if within idempotency window
      if (existing.status === 'PENDING' || existing.status === 'FAILED') {
        const idempotencyWindowMs = 30_000; // 30 seconds
        const timeSinceCreation = Date.now() - existing.createdAt.getTime();

        if (timeSinceCreation <= idempotencyWindowMs) {
          const recovered = await this.retryVerifyDonation(existing, dto);
          if (recovered) {
            // Fetch the updated donation
            const updated = await this.prisma.donation.findUnique({
              where: { txHash: dto.txHash },
            });
            if (updated) {
              return {
                donation: {
                  id: updated.id,
                  amount: updated.amount.toString(),
                  assetCode: updated.assetCode,
                  txHash: updated.txHash,
                  status: updated.status,
                  donorId: updated.donorId,
                  campaignId: updated.campaignId,
                  tipAmount: updated.tipAmount?.toString() || null,
                  tipAsset: updated.tipAsset || null,
                  tipId: updated.tipId,
                  donatedAt: updated.donatedAt,
                  confirmedAt: updated.confirmedAt,
                  createdAt: updated.createdAt,
                  recovered: true,
                },
                tip: null,
              };
            }
          }
        }
      }

      // Return cached donation (not recovered or outside window)
      return {
        donation: {
          id: existing.id,
          amount: existing.amount.toString(),
          assetCode: existing.assetCode,
          txHash: existing.txHash,
          status: existing.status,
          donorId: existing.donorId,
          campaignId: existing.campaignId,
          tipAmount: existing.tipAmount?.toString() || null,
          tipAsset: existing.tipAsset || null,
          tipId: existing.tipId,
          donatedAt: existing.donatedAt,
          confirmedAt: existing.confirmedAt,
          createdAt: existing.createdAt,
          recovered: false,
        },
        tip: null,
      };
    }

    const campaign = await this.prisma.campaign.findUnique({
      where: { id: dto.campaignId },
    });

    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    if (!campaign.contractId) {
      throw new BadRequestException('Campaign contractId is not set');
    }

    const requestedAsset = parseAsset(dto.assetCode || 'XLM', dto.assetIssuer);
    const acceptedAssets = coerceAcceptedAssets(campaign.acceptedAssets);

    await this.stellarTxs.verifyDonationTransaction({
      txHash: dto.txHash,
      destination: campaign.contractId,
      amount: dto.amount,
      asset: requestedAsset,
      acceptedAssets,
    });

    const donor = await this.getOrCreateUserByWallet(walletAddress);

    const created = await this.prisma.donation.create({
      data: {
        donorId: donor.id,
        campaignId: campaign.id,
        amount: dto.amount,
        assetCode: (dto.assetCode || 'XLM').toUpperCase(),
        assetIssuer:
          requestedAsset.assetType === 'credit' ? requestedAsset.issuer : null,
        txHash: dto.txHash,
        isAnonymous: dto.isAnonymous ?? false,
        status: 'CONFIRMED',
        confirmedAt: new Date(),
        donatedAt: new Date(),
      },
    });

    await this.campaigns.recalculateCampaignStats(campaign.id);

    return {
      donation: {
        id: created.id,
        amount: created.amount.toString(),
        assetCode: created.assetCode,
        txHash: created.txHash,
        status: created.status,
        donorId: created.donorId,
        campaignId: created.campaignId,
        tipAmount: null,
        tipAsset: null,
        tipId: null,
        donatedAt: created.donatedAt,
        confirmedAt: created.confirmedAt,
        createdAt: created.createdAt,
        recovered: false,
      },
      tip: null,
    };
  }

  /**
   * Retry verification for PENDING or FAILED donations
   * Re-checks the transaction on-chain and updates the status if successful
   * @returns true if the donation was recovered (status changed to CONFIRMED)
   */
  private async retryVerifyDonation(
    existing: any,
    dto: CreateDonationDto,
  ): Promise<boolean> {
    try {
      const campaign = await this.prisma.campaign.findUnique({
        where: { id: dto.campaignId },
      });

      if (!campaign || !campaign.contractId) {
        return false;
      }

      const requestedAsset = parseAsset(
        dto.assetCode || 'XLM',
        dto.assetIssuer,
      );
      const acceptedAssets = coerceAcceptedAssets(campaign.acceptedAssets);

      // Re-verify the transaction on-chain
      await this.stellarTxs.verifyDonationTransaction({
        txHash: dto.txHash!,
        destination: campaign.contractId,
        amount: dto.amount,
        asset: requestedAsset,
        acceptedAssets,
      });

      // If verification succeeds, update the donation status
      await this.prisma.donation.update({
        where: { txHash: dto.txHash },
        data: {
          status: 'CONFIRMED',
          confirmedAt: new Date(),
        },
      });

      // Recalculate campaign stats since we confirmed a previously failed/pending donation
      await this.campaigns.recalculateCampaignStats(campaign.id);

      return true;
    } catch (error) {
      // Verification failed, keep existing status
      return false;
    }
  }

  /** Get all donations for a user ordered by most recent first */
  async findAll(userId: string) {
    return this.prisma.donation.findMany({
      where: { donorId: userId },
      include: { tip: true },
      orderBy: { donatedAt: 'desc' },
    });
  }

  /** Get a single donation by ID, scoped to the requesting user */
  async findById(id: string, userId: string) {
    const donation = await this.prisma.donation.findFirst({
      where: { id, donorId: userId },
      include: { tip: true },
    });

    if (!donation) {
      throw new NotFoundException('Donation not found');
    }

    return donation;
  }

  /** Verify a donation transaction on the Stellar network and update its status */
  async verifyDonationOnChain(txHash: string): Promise<boolean> {
    try {
      const donation = await this.prisma.donation.findUnique({
        where: { txHash },
      });

      if (!donation) return false;

      const previousStatus = donation.status;

      const { rpc: sorobanRpc } = await import('@stellar/stellar-sdk');
      const server = new sorobanRpc.Server('https://soroban-rpc.stellar.org');
      const response = await server.getTransaction(txHash);

      if (response.status === 'SUCCESS') {
        await this.prisma.donation.update({
          where: { txHash },
          data: { status: 'CONFIRMED', confirmedAt: new Date() },
        });

        // If the donation was not already CONFIRMED, recalculate campaign stats
        if (previousStatus !== 'CONFIRMED') {
          await this.campaigns.recalculateCampaignStats(donation.campaignId);
        }

        const updated = await this.prisma.donation.findUnique({
          where: { txHash },
          include: { tip: true },
        });

        if (updated?.tip && updated.tip.status === 'PENDING') {
          await this.prisma.platformTip.update({
            where: { id: updated.tip.id },
            data: { status: 'CONFIRMED', confirmedAt: new Date() },
          });
        }

        return true;
      }

      // Only flip to FAILED if it's not already CONFIRMED
      if (previousStatus === 'CONFIRMED') {
        return false;
      }

      await this.prisma.donation.update({
        where: { txHash },
        data: { status: 'FAILED' },
      });
      return false;
    } catch {
      return false;
    }
  }

  /** Verify a platform tip transaction on-chain */
  async verifyTipOnChain(txHash: string): Promise<boolean> {
    try {
      const tip = await this.prisma.platformTip.findUnique({
        where: { txHash },
      });

      if (!tip) return false;

      const { rpc: sorobanRpc } = await import('@stellar/stellar-sdk');
      const server = new sorobanRpc.Server('https://soroban-rpc.stellar.org');
      const response = await server.getTransaction(txHash);

      if (response.status === 'SUCCESS') {
        await this.prisma.platformTip.update({
          where: { txHash },
          data: { status: 'CONFIRMED', confirmedAt: new Date() },
        });

        if (tip.donationId) {
          await this.prisma.donation.update({
            where: { id: tip.donationId },
            data: { status: 'CONFIRMED', confirmedAt: new Date() },
          });
        }

        return true;
      }

      await this.prisma.platformTip.update({
        where: { txHash },
        data: { status: 'FAILED' },
      });
      return false;
    } catch {
      return false;
    }
  }

  /** Get platform tip revenue aggregated from confirmed tips */
  async getTipRevenue() {
    const result = await this.prisma.platformTip.aggregate({
      where: { status: 'CONFIRMED' },
      _sum: { amount: true },
      _count: true,
    });

    return {
      totalTips: result._count,
      totalRevenue: result._sum.amount?.toString() || '0',
      currency: 'XLM',
    };
  }

  /** List all platform tips with donor info, ordered by most recent first */
  async getAllTips() {
    return this.prisma.platformTip.findMany({
      include: {
        donor: {
          select: { id: true, walletAddress: true, displayName: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Get a single tip by ID with donor and donation info */
  async getTipById(id: string) {
    const tip = await this.prisma.platformTip.findUnique({
      where: { id },
      include: {
        donor: { select: { id: true, walletAddress: true, displayName: true } },
        donation: { select: { id: true, amount: true, campaignId: true } },
      },
    });

    if (!tip) throw new NotFoundException('Tip not found');
    return tip;
  }

  /** Get a paginated leaderboard of confirmed donations for a campaign */
  async getCampaignDonations(
    campaignId: string,
    page = 1,
    limit = 20,
    sortBy: 'amount' | 'createdAt' = 'amount',
    order: 'asc' | 'desc' = 'desc',
  ) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');

    const skip = (page - 1) * limit;
    const total = await this.prisma.donation.count({
      where: { campaignId, status: 'CONFIRMED' },
    });

    const donations = await this.prisma.donation.findMany({
      where: { campaignId, status: 'CONFIRMED' },
      include: { donor: { select: { walletAddress: true } } },
      orderBy: { [sortBy]: order },
      skip,
      take: limit,
    });

    const donationsWithRank = donations.map((donation, index) => ({
      rank: skip + index + 1,
      walletAddress: donation.isAnonymous
        ? 'Anonymous'
        : (donation.donor?.walletAddress ?? 'Anonymous'),
      amount: donation.amount.toString(),
      assetCode: donation.assetCode,
      createdAt: donation.createdAt,
      txHash: donation.txHash,
    }));

    return {
      donations: donationsWithRank,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  /** Get filtered/sorted donation history for a specific user */
  async getUserDonationHistory(
    userId: string,
    page = 1,
    limit = 20,
    sortBy: 'amount' | 'createdAt' = 'createdAt',
    order: 'asc' | 'desc' = 'desc',
    campaignId?: string,
    startDate?: string,
    endDate?: string,
  ) {
    const skip = (page - 1) * limit;

    const where: Prisma.DonationWhereInput = {
      donorId: userId,
      status: 'CONFIRMED',
    };
    if (campaignId) where.campaignId = campaignId;
    if (startDate || endDate) {
      where.donatedAt = {};
      if (startDate) where.donatedAt.gte = new Date(startDate);
      if (endDate) where.donatedAt.lte = new Date(endDate);
    }

    const orderByClause: Record<string, string> = {};
    orderByClause[sortBy] = order;

    const total = await this.prisma.donation.count({ where });

    const donations = await this.prisma.donation.findMany({
      where,
      include: {
        campaign: { select: { id: true, title: true, status: true } },
      },
      orderBy: orderByClause,
      skip,
      take: limit,
    });

    const donationHistory = donations.map((donation) => ({
      id: donation.id,
      amount: donation.amount.toString(),
      assetCode: donation.assetCode,
      status: donation.status,
      campaignId: donation.campaignId,
      campaignTitle: donation.campaign?.title || 'Unknown Campaign',
      campaignStatus: donation.campaign?.status || 'UNKNOWN',
      txHash: donation.txHash,
      donatedAt: donation.donatedAt,
      createdAt: donation.createdAt,
    }));

    const totalDonatedResult = await this.prisma.donation.aggregate({
      where,
      _sum: { amount: true },
      _count: true,
    });

    const totalDonated = totalDonatedResult._sum.amount?.toString() || '0';
    const totalDonations = totalDonatedResult._count;
    const averageDonation =
      totalDonations > 0
        ? (parseFloat(totalDonated) / totalDonations).toString()
        : '0';

    return {
      donations: donationHistory,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
      summary: { totalDonated, totalDonations, averageDonation },
    };
  }

  /** Export user donations as CSV string */
  async exportUserDonationsAsCSV(
    userId: string,
    campaignId?: string,
    startDate?: string,
    endDate?: string,
  ): Promise<string> {
    const where: Prisma.DonationWhereInput = {
      donorId: userId,
      status: 'CONFIRMED',
    };
    if (campaignId) where.campaignId = campaignId;
    if (startDate || endDate) {
      where.donatedAt = {};
      if (startDate) where.donatedAt.gte = new Date(startDate);
      if (endDate) where.donatedAt.lte = new Date(endDate);
    }

    const donations = await this.prisma.donation.findMany({
      where,
      include: { campaign: { select: { title: true } } },
      orderBy: { donatedAt: 'desc' },
    });

    return buildDonationCsv(
      donations.map((d) => ({
        campaignTitle: d.campaign?.title || 'Unknown',
        amount: d.amount.toString(),
        assetCode: d.assetCode,
        donatedAt: d.donatedAt,
        txHash: d.txHash,
      })),
    );
  }

  /** Get or create a user record by Stellar wallet address */
  private async getOrCreateUserByWallet(walletAddress: string) {
    const existing = await this.prisma.user.findUnique({
      where: { walletAddress },
    });
    if (existing) return existing;

    return this.prisma.user.create({
      data: {
        walletAddress,
        email: `${walletAddress}@orbitchain.local`,
        role: 'DONOR',
      },
    });
  }
}

/** Parse and validate the donation asset from request */
function parseAsset(
  assetCode: string,
  assetIssuer?: string,
): StellarAcceptedAsset {
  const code = String(assetCode ?? '').trim();
  if (!code) {
    throw new BadRequestException('assetCode is required');
  }

  if (code.toUpperCase() === 'XLM') {
    return { assetType: 'native' };
  }

  const issuer = String(assetIssuer ?? '').trim();
  if (!issuer) {
    throw new BadRequestException(
      'assetIssuer is required for non-native assets',
    );
  }

  return { assetType: 'credit', code, issuer };
}

/** Normalize the campaign's acceptedAssets field into a typed array */
function coerceAcceptedAssets(value: unknown): StellarAcceptedAsset[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [{ assetType: 'native' }];
  }

  const parsed: StellarAcceptedAsset[] = [];
  for (const item of value) {
    if (item && typeof item === 'object') {
      const assetType = item.assetType;
      if (assetType === 'native') {
        parsed.push({ assetType: 'native' });
        continue;
      }
      if (assetType === 'credit') {
        const code = String(item.code ?? '');
        const issuer = String(item.issuer ?? '');
        if (code && issuer) {
          parsed.push({ assetType: 'credit', code, issuer });
        }
      }
    }
  }

  return parsed.length > 0 ? parsed : [{ assetType: 'native' }];
}
