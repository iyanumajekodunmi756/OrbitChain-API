import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_EMAIL } from '../queue/queue.constants';
import type { EmailJobData } from './email.processor';
import {
  donationReceivedTemplate,
  milestoneUnlockedTemplate,
  campaignUpdateTemplate,
  campaignSuspensionTemplate,
} from './email-templates';

export interface SuspensionEmailPayload {
  creatorId: string;
  campaignId: string;
  campaignTitle: string;
  reason: string;
  supportEmail?: string;
}

export interface DonationReceivedPayload {
  toEmail: string;
  userId: string;
  donorName: string;
  amount: string;
  assetCode: string;
  campaignTitle: string;
  campaignUrl: string;
}

export interface MilestoneUnlockedPayload {
  toEmail: string;
  userId: string;
  campaignTitle: string;
  milestoneTitle: string;
  campaignUrl: string;
}

export interface CampaignUpdatePayload {
  toEmail: string;
  userId: string;
  campaignTitle: string;
  updateTitle: string;
  updateContent: string;
  campaignUrl: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_EMAIL) private readonly emailQueue: Queue,
  ) {}

  /**
   * Check whether a user has enabled email notifications for a given notification type.
   * Falls back to true if no preferences are set (opt-in by default).
   * preferenceKey corresponds to keys: donationReceived, milestoneUnlocked, campaignUpdate, etc.
   */
  async shouldSendEmail(
    userId: string,
    preferenceKey: string,
  ): Promise<boolean> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { notificationPreference: true },
      });

      if (!user) return false;

      // If user has no email, we can't send email
      if (!user.email) return false;

      const prefs = user.notificationPreference?.preferences as Record<
        string,
        { email?: boolean; inApp?: boolean }
      > | null;

      // If no preferences set, default to true (opt-in by default)
      if (!prefs || !prefs[preferenceKey]) return true;

      return prefs[preferenceKey]?.email !== false;
    } catch (error) {
      this.logger.error(
        `Error checking notification preference ${preferenceKey} for user ${userId}: ${(error as Error).message}`,
      );
      return true; // Fail open — send the notification on error
    }
  }

  /** Queue a donation received email via Bull for async processing */
  async sendDonationReceivedEmail(
    payload: DonationReceivedPayload,
  ): Promise<void> {
    const template = donationReceivedTemplate;
    const html = template.html({
      donorName: payload.donorName,
      amount: payload.amount,
      assetCode: payload.assetCode,
      campaignTitle: payload.campaignTitle,
      campaignUrl: payload.campaignUrl,
    });

    const jobData: EmailJobData = {
      to: payload.toEmail,
      subject: template.subject,
      html,
      preferenceKey: 'donationReceived',
      userId: payload.userId,
    };

    await this.emailQueue.add('send-email', jobData);
    this.logger.log(`Queued donation received email to ${payload.toEmail}`);
  }

  /** Queue a milestone unlocked email via Bull for async processing */
  async sendMilestoneUnlockedEmail(
    payload: MilestoneUnlockedPayload,
  ): Promise<void> {
    const template = milestoneUnlockedTemplate;
    const html = template.html({
      campaignTitle: payload.campaignTitle,
      milestoneTitle: payload.milestoneTitle,
      campaignUrl: payload.campaignUrl,
    });

    const jobData: EmailJobData = {
      to: payload.toEmail,
      subject: template.subject,
      html,
      preferenceKey: 'milestoneUnlocked',
      userId: payload.userId,
    };

    await this.emailQueue.add('send-email', jobData);
    this.logger.log(`Queued milestone unlocked email to ${payload.toEmail}`);
  }

  /** Queue a campaign update email via Bull for async processing */
  async sendCampaignUpdateEmail(payload: CampaignUpdatePayload): Promise<void> {
    const template = campaignUpdateTemplate;
    const html = template.html({
      campaignTitle: payload.campaignTitle,
      updateTitle: payload.updateTitle,
      updateContent: payload.updateContent,
      campaignUrl: payload.campaignUrl,
    });

    const jobData: EmailJobData = {
      to: payload.toEmail,
      subject: template.subject,
      html,
      preferenceKey: 'campaignUpdate',
      userId: payload.userId,
    };

    await this.emailQueue.add('send-email', jobData);
    this.logger.log(`Queued campaign update email to ${payload.toEmail}`);
  }

  /**
   * Sends a campaign suspension email to the creator and creates an in-app notification.
   * Queues the email via Bull for async processing.
   * @throws Error if user not found or email queueing fails
   */
  async sendCampaignSuspensionEmail(
    payload: SuspensionEmailPayload,
  ): Promise<void> {
    // Fetch the real user email from the database
    const creator = await this.prisma.user.findUnique({
      where: { id: payload.creatorId },
      select: { id: true, email: true, displayName: true },
    });

    if (!creator) {
      throw new Error(`Creator with ID ${payload.creatorId} not found`);
    }

    if (!creator.email) {
      throw new Error(
        `Creator ${payload.creatorId} has no email address configured`,
      );
    }

    const supportEmail = payload.supportEmail || 'support@orbitchain.io';
    const template = campaignSuspensionTemplate;
    const html = template.html({
      campaignTitle: payload.campaignTitle,
      reason: payload.reason,
      supportEmail,
    });

    // Queue the email via Bull
    const jobData: EmailJobData = {
      to: creator.email,
      subject: template.subject,
      html,
      // No preferenceKey - suspension emails are critical and bypass preferences
    };

    await this.emailQueue.add('send-email', jobData);
    this.logger.log(
      `Queued campaign suspension email to ${creator.email} for campaign ${payload.campaignId}`,
    );

    // Create in-app notification
    await this.prisma.notification.create({
      data: {
        userId: payload.creatorId,
        type: 'CAMPAIGN_UPDATED', // Using existing enum value; consider adding CAMPAIGN_SUSPENDED
        title: 'Campaign Suspended',
        message: `Your campaign "${payload.campaignTitle}" has been suspended. Reason: ${payload.reason}`,
        relatedId: payload.campaignId,
        isRead: false,
      },
    });

    this.logger.log(
      `Created in-app notification for creator ${payload.creatorId} about campaign ${payload.campaignId} suspension`,
    );
  }

  /**
   * Get up to 50 notifications for a user, optionally filtered by read status.
   */
  async getNotifications(
    userId: string,
    isRead?: boolean,
  ): Promise<{ data: unknown[]; total: number }> {
    const where: { userId: string; isRead?: boolean } = { userId };
    if (isRead !== undefined) {
      where.isRead = isRead;
    }

    const [data, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return { data, total };
  }

  /** Mark all notifications as read for a user */
  async markAllRead(
    userId: string,
  ): Promise<{ message: string; updated: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });

    return {
      message: 'All notifications marked as read',
      updated: result.count,
    };
  }

  /** Mark a single notification as read */
  async markOneRead(
    userId: string,
    notificationId: string,
  ): Promise<{ message: string }> {
    await this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { isRead: true },
    });

    return { message: 'Notification marked as read' };
  }
}
