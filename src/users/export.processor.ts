import { Processor, Process } from '@nestjs/bull';
import type { Job } from 'bull';
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_EXPORT } from '../queue/queue.constants';
import { buildDonationCsv } from '../common/csv-export.helper';

export interface ExportDonationJobData {
  userId: string;
  campaignId?: string;
  startDate?: string;
  endDate?: string;
}

export interface ExportDonationJobResult {
  csv: string;
  rowCount: number;
}

/** Bull queue processor that handles async CSV export of large donation histories */
@Processor(QUEUE_EXPORT)
export class ExportProcessor {
  private readonly logger = new Logger(ExportProcessor.name);

  constructor(private readonly prisma: PrismaService) {}

  @Process('donation-export')
  async handleDonationExport(
    job: Job<ExportDonationJobData>,
  ): Promise<ExportDonationJobResult> {
    const { userId, campaignId, startDate, endDate } = job.data;

    this.logger.log(`Processing donation export for user ${userId}`);

    // Build where clause
    const where: Prisma.DonationWhereInput = {
      donorId: userId,
      status: 'CONFIRMED' as const,
    };

    if (campaignId) {
      where.campaignId = campaignId;
    }

    if (startDate || endDate) {
      where.donatedAt = {};
      if (startDate) {
        where.donatedAt.gte = new Date(startDate);
      }
      if (endDate) {
        where.donatedAt.lte = new Date(endDate);
      }
    }

    // Fetch all donations for this user
    const donations = await this.prisma.donation.findMany({
      where,
      include: {
        campaign: {
          select: { title: true },
        },
      },
      orderBy: { donatedAt: 'desc' },
    });

    const csv = buildDonationCsv(
      donations.map((d) => ({
        campaignTitle: d.campaignId || 'Unknown',
        amount: d.amount.toString(),
        assetCode: d.assetCode,
        donatedAt: d.donatedAt,
        txHash: d.txHash,
      })),
    );

    this.logger.log(
      `Donation export complete for user ${userId}: ${donations.length} rows`,
    );

    return { csv, rowCount: donations.length };
  }
}
