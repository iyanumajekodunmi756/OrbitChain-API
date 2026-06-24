import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SuspendCampaignDto } from './dtos/suspend-campaign.dto';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /** Suspend a campaign with an audit log entry and creator notification */
  async suspendCampaign(
    campaignId: string,
    dto: SuspendCampaignDto,
    adminId: string,
    adminEmail: string,
  ): Promise<{ message: string; notificationSent: boolean }> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });
    if (!campaign) {
      throw new NotFoundException(`Campaign ${campaignId} not found`);
    }

    if (campaign.status === 'CANCELLED') {
      throw new BadRequestException('Campaign is already suspended/cancelled');
    }

    const previousStatus = campaign.status;

    // Update campaign
    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'CANCELLED' },
    });

    // Write audit log
    await this.prisma.auditLog.create({
      data: {
        userId: adminId,
        action: 'ADMIN_ACTION',
        resourceType: 'campaign',
        resourceId: campaignId,
        details: JSON.stringify({
          reason: dto.reason,
          previousStatus,
          action: 'CAMPAIGN_SUSPENDED',
        }),
      },
    });

    // Notify creator - handle failures gracefully
    let notificationSent = true;
    try {
      await this.notificationsService.sendCampaignSuspensionEmail({
        creatorId: campaign.creatorId,
        campaignId,
        campaignTitle: campaign.title,
        reason: dto.reason,
      });
    } catch (error) {
      notificationSent = false;
      // Log the error but don't throw - campaign is already suspended
      console.error(
        `Failed to send suspension notification for campaign ${campaignId}:`,
        error,
      );
    }

    return {
      message: `Campaign ${campaignId} has been suspended`,
      notificationSent,
    };
  }

  /**
   * Refund a confirmed donation and atomically recalculate the campaign's
   * raisedAmount within a single Prisma transaction.
   */
  async refundDonation(donationId: string): Promise<{
    id: string;
    amount: string;
    assetCode: string;
    status: string;
    campaignId: string;
    donorId: string;
    txHash: string | null;
    refundedAt: Date;
  }> {
    return this.prisma.$transaction(async (tx) => {
      const donation = await tx.donation.findUnique({
        where: { id: donationId },
      });

      if (!donation) {
        throw new NotFoundException('Donation not found');
      }

      if (donation.status !== 'CONFIRMED') {
        throw new BadRequestException(
          `Only confirmed donations can be refunded. Current status: ${donation.status}`,
        );
      }

      const updated = await tx.donation.update({
        where: { id: donationId },
        data: { status: 'REFUNDED' },
      });

      // Recalculate campaign raisedAmount atomically within the same transaction
      const agg = await tx.donation.aggregate({
        where: {
          campaignId: donation.campaignId,
          status: 'CONFIRMED',
        },
        _sum: { amount: true },
      });

      const raisedAmount = agg._sum.amount ?? new Prisma.Decimal(0);

      await tx.campaign.update({
        where: { id: donation.campaignId },
        data: { raisedAmount },
      });

      return {
        id: updated.id,
        amount: updated.amount.toString(),
        assetCode: updated.assetCode,
        status: updated.status,
        campaignId: updated.campaignId,
        donorId: updated.donorId,
        txHash: updated.txHash,
        refundedAt: updated.updatedAt,
      };
    });
  }
}
