# Campaign Suspension Notifications

## Overview

This document describes the campaign suspension notification system that ensures campaign creators are properly notified when their campaigns are suspended by administrators.

## Problem Statement

Previously, `AdminService.suspendCampaign` had a critical flaw:

1. **No Real Email Delivery**: The suspension email was only logged, never actually sent
2. **Invalid Email Address**: Used a synthetic email `creator-${creatorId}@platform.internal` that couldn't receive mail
3. **No In-App Notification**: Creators had no in-app visibility of the suspension
4. **Silent Failures**: API returned 200 even when notifications failed, hiding problems from admins
5. **User Impact**: Campaigns could be frozen without creators knowing, blocking support requests and refunds

## Solution Implemented

### 1. Real Email Template

Added `campaignSuspensionTemplate` to `email-templates.ts`:

- Professional, branded HTML email
- Clear suspension reason display
- Action items for the creator (what this means, next steps)
- Support contact button
- Uses actual creator email address from database

### 2. Queue-Based Email Delivery

Updated `sendCampaignSuspensionEmail` in `notifications.service.ts`:

- Fetches real user email from database via `prisma.user.findUnique`
- Validates creator exists and has email configured
- Renders HTML template with suspension details
- Queues email via Bull (`QUEUE_EMAIL`) for async processing
- No `preferenceKey` - suspension emails bypass user preferences (critical notification)

### 3. In-App Notification

Creates a persistent in-app notification:

- Type: `CAMPAIGN_UPDATED` (using existing enum)
- Title: "Campaign Suspended"
- Message: Includes campaign title and suspension reason
- Links to campaign via `relatedId`
- Marked as unread by default

### 4. Graceful Error Handling

Updated `AdminService.suspendCampaign`:

- Campaign suspension and audit log happen first (transactional)
- Notification sending wrapped in try-catch
- Returns `notificationSent: boolean` flag
- Logs errors but doesn't throw (campaign already suspended)
- Admins can see if notification failed and take manual action

### 5. API Transparency

Updated `AdminController.suspendCampaign`:

- Returns `{ message: string, notificationSent: boolean }`
- Frontend can check `notificationSent` flag
- If false, frontend should alert admin to manually notify creator
- Maintains 200 status (campaign successfully suspended) with transparency flag

## Implementation Details

### Email Template Structure

```typescript
{
  subject: 'Important: Your Campaign Has Been Suspended',
  html: (data: CampaignSuspensionData) => `
    - Suspension banner with warning icon
    - Campaign title in context
    - Highlighted reason box
    - "What this means" section with bullet points
    - Support contact button
    - Professional footer
  `
}
```

### Notification Flow

```
Admin suspends campaign
    ↓
Update campaign.status = CANCELLED
    ↓
Write audit log
    ↓
[TRY]
  Fetch creator from database
    ↓
  Validate email exists
    ↓
  Render HTML template
    ↓
  Queue email job (Bull)
    ↓
  Create in-app notification
    ↓
  Log success
    ↓
  Return { message: "...", notificationSent: true }
[CATCH]
  Log error
    ↓
  Return { message: "...", notificationSent: false }
```

### Error Scenarios Handled

**1. Creator Not Found**

- Throws error with clear message
- Campaign suspension rolled back (transaction)
- Admin sees 404 error

**2. Creator Has No Email**

- Throws error with clear message
- Campaign suspension rolled back
- Admin sees 400 error with instructions

**3. Email Queue Failure**

- Logs error
- Returns `notificationSent: false`
- Campaign remains suspended
- Admin can manually notify creator

**4. Bull Queue Down**

- Caught by error handler
- Returns `notificationSent: false`
- Admin alerted to check queue health

## Code Changes

### Files Modified

**1. `src/notifications/email-templates.ts`**

- Added `CampaignSuspensionData` interface
- Added `campaignSuspensionTemplate` with professional HTML

**2. `src/notifications/notifications.service.ts`**

- Updated `SuspensionEmailPayload` interface to use `creatorId` instead of `toEmail`
- Added `supportEmail` optional parameter
- Replaced TODO stub with real implementation:
  - Database user lookup
  - Email validation
  - Template rendering
  - Bull queue integration
  - In-app notification creation
  - Comprehensive logging

**3. `src/admin/admin.service.ts`**

- Updated return type to include `notificationSent: boolean`
- Wrapped notification sending in try-catch
- Returns notification status to controller
- Logs errors without throwing

**4. `src/admin/admin.controller.ts`**

- Updated response type to include `notificationSent`
- Added comment explaining partial success handling
- Frontend can now detect and handle notification failures

## API Response Examples

### Success - Notification Sent

```json
{
  "message": "Campaign abc-123 has been suspended",
  "notificationSent": true
}
```

### Partial Success - Notification Failed

```json
{
  "message": "Campaign abc-123 has been suspended",
  "notificationSent": false
}
```

**Note**: Campaign is suspended, but admin should manually notify creator

## Testing Recommendations

### Unit Tests

```typescript
describe('AdminService.suspendCampaign', () => {
  it('should send notification when creator has email', async () => {
    // Mock creator with valid email
    // Assert notificationsService.sendCampaignSuspensionEmail called
    // Assert result.notificationSent === true
  });

  it('should return notificationSent: false on email failure', async () => {
    // Mock email queue failure
    // Assert campaign still suspended
    // Assert result.notificationSent === false
  });
});

describe('NotificationsService.sendCampaignSuspensionEmail', () => {
  it('should throw when creator not found', async () => {
    // Mock user not found
    // Assert error thrown
  });

  it('should throw when creator has no email', async () => {
    // Mock user without email
    // Assert error thrown
  });

  it('should queue email and create notification', async () => {
    // Mock valid creator
    // Assert emailQueue.add called with correct params
    // Assert notification created in database
  });
});
```

### Integration Tests

1. Suspend campaign with valid creator → verify email queued and notification created
2. Suspend campaign with invalid creator → verify proper error
3. Suspend campaign when queue is down → verify graceful degradation
4. Check email content renders correctly with all variables

### Manual Tests

1. Suspend a campaign → check creator's email inbox
2. Suspend a campaign → check creator's in-app notifications
3. Suspend campaign when Redis/Bull is down → verify `notificationSent: false`
4. Suspend campaign for creator without email → verify error message

## Security Considerations

**Email Bypass Prevention**

- Suspension emails bypass user notification preferences
- This is intentional - suspensions are critical admin actions
- Users cannot opt-out of suspension notifications

**Data Exposure**

- Email only sent to campaign creator (validated by database)
- Suspension reason visible to creator (they need to know why)
- Audit log tracks admin who performed action

**Authorization**

- Only admins can suspend campaigns (enforced by `@Roles('admin')` guard)
- Audit log tracks who suspended and why

## Future Enhancements

1. **Add CAMPAIGN_SUSPENDED enum value** to `NotificationType` in Prisma schema
2. **Configurable support email** via environment variable
3. **Webhook notifications** for third-party integrations
4. **Suspension appeal flow** for creators to contest decisions
5. **Email delivery tracking** via webhook from email provider
6. **Retry mechanism** for failed notifications
7. **Admin dashboard** showing notification delivery status

## Support Email Configuration

Default support email: `support@orbitchain.io`

To customize, pass `supportEmail` in the payload:

```typescript
await notificationsService.sendCampaignSuspensionEmail({
  creatorId: '...',
  campaignId: '...',
  campaignTitle: '...',
  reason: '...',
  supportEmail: 'custom@support.com', // Optional
});
```

## Monitoring

Key metrics to track:

- Suspension email delivery rate
- Notification send failures
- Time from suspension to notification delivery
- Creator support ticket volume post-suspension

## Deployment Notes

- **No database migrations required**
- **No environment variables needed** (support email hardcoded, can be made configurable)
- **Backward compatible** - existing suspension logic preserved
- **Bull queue required** - ensure Redis and Bull are running
- **Email service required** - ensure email configuration is valid
