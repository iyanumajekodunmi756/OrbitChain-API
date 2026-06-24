/**
 * Email template helpers for OrbitChain notifications.
 * Each function returns an object with `subject` and `html` builder.
 */

interface DonationReceivedData {
  donorName: string;
  amount: string;
  assetCode: string;
  campaignTitle: string;
  campaignUrl: string;
}

interface MilestoneUnlockedData {
  campaignTitle: string;
  milestoneTitle: string;
  campaignUrl: string;
}

interface CampaignUpdateData {
  campaignTitle: string;
  updateTitle: string;
  updateContent: string;
  campaignUrl: string;
}

interface CampaignSuspensionData {
  campaignTitle: string;
  reason: string;
  supportEmail: string;
}

export const donationReceivedTemplate = {
  subject: 'New Donation Received! 💰',
  html: (data: DonationReceivedData) => `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333">
  <div style="text-align:center;margin-bottom:24px">
    <h1 style="color:#10b981;font-size:28px;margin:0">🎉 New Donation!</h1>
  </div>
  <p style="font-size:16px;line-height:1.6">
    <strong>${data.donorName}</strong> just donated <strong style="color:#10b981">${data.amount} ${data.assetCode}</strong>
    to your campaign <strong>"${data.campaignTitle}"</strong>!
  </p>
  <div style="text-align:center;margin:32px 0">
    <a href="${data.campaignUrl}" style="display:inline-block;background:#10b981;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-size:16px">
      View Campaign
    </a>
  </div>
  <p style="font-size:14px;color:#888;line-height:1.5">
    Every contribution brings you closer to your goal. Keep up the great work!
  </p>
</body>
</html>`,
};

export const milestoneUnlockedTemplate = {
  subject: 'Milestone Unlocked! 🏆',
  html: (data: MilestoneUnlockedData) => `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333">
  <div style="text-align:center;margin-bottom:24px">
    <h1 style="color:#f59e0b;font-size:28px;margin:0">🏆 Milestone Reached!</h1>
  </div>
  <p style="font-size:16px;line-height:1.6">
    Congratulations! The milestone <strong>"${data.milestoneTitle}"</strong> for your campaign
    <strong>"${data.campaignTitle}"</strong> has been unlocked!
  </p>
  <div style="text-align:center;margin:32px 0">
    <a href="${data.campaignUrl}" style="display:inline-block;background:#f59e0b;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-size:16px">
      View Progress
    </a>
  </div>
  <p style="font-size:14px;color:#888;line-height:1.5">
    Keep pushing forward — your community believes in this mission!
  </p>
</body>
</html>`,
};

export const campaignUpdateTemplate = {
  subject: 'Campaign Update 📢',
  html: (data: CampaignUpdateData) => `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333">
  <div style="text-align:center;margin-bottom:24px">
    <h1 style="color:#3b82f6;font-size:28px;margin:0">📢 New Update</h1>
  </div>
  <p style="font-size:16px;line-height:1.6">
    <strong>"${data.campaignTitle}"</strong> has posted a new update:
  </p>
  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:16px 0">
    <h2 style="margin:0 0 8px;font-size:18px;color:#1e293b">${data.updateTitle}</h2>
    <p style="font-size:14px;line-height:1.6;color:#475569;margin:0">${data.updateContent}</p>
  </div>
  <div style="text-align:center;margin:24px 0">
    <a href="${data.campaignUrl}" style="display:inline-block;background:#3b82f6;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-size:16px">
      View Update
    </a>
  </div>
</body>
</html>`,
};

export const campaignSuspensionTemplate = {
  subject: 'Important: Your Campaign Has Been Suspended',
  html: (data: CampaignSuspensionData) => `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333">
  <div style="text-align:center;margin-bottom:24px">
    <h1 style="color:#dc2626;font-size:28px;margin:0">⚠️ Campaign Suspended</h1>
  </div>
  <p style="font-size:16px;line-height:1.6">
    We're writing to inform you that your campaign <strong>"${data.campaignTitle}"</strong> has been suspended by our moderation team.
  </p>
  <div style="background:#fef2f2;border-left:4px solid #dc2626;padding:16px;margin:24px 0;border-radius:4px">
    <h3 style="margin:0 0 8px;font-size:16px;color:#991b1b">Reason for Suspension:</h3>
    <p style="font-size:14px;line-height:1.6;color:#7f1d1d;margin:0">${data.reason}</p>
  </div>
  <p style="font-size:16px;line-height:1.6">
    <strong>What this means:</strong>
  </p>
  <ul style="font-size:14px;line-height:1.8;color:#475569">
    <li>Your campaign is no longer visible to the public</li>
    <li>No new donations can be received</li>
    <li>Existing funds remain secure in the smart contract</li>
  </ul>
  <p style="font-size:16px;line-height:1.6;margin-top:24px">
    If you believe this suspension was made in error or would like to discuss next steps, please contact our support team.
  </p>
  <div style="text-align:center;margin:32px 0">
    <a href="mailto:${data.supportEmail}" style="display:inline-block;background:#dc2626;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-size:16px">
      Contact Support
    </a>
  </div>
  <p style="font-size:12px;color:#888;line-height:1.5;margin-top:32px;border-top:1px solid #e2e8f0;padding-top:16px">
    This is an automated notification from OrbitChain. Please do not reply to this email.
  </p>
</body>
</html>`,
};
