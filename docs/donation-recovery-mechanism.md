# Donation Recovery Mechanism

## Overview

This document describes the donation recovery mechanism implemented to handle cases where donation transactions are initially marked as `PENDING` or `FAILED` due to temporary RPC outages or network issues, but actually succeeded on-chain.

## Problem Statement

Previously, `DonationsService.createDonation` would return cached donation records immediately when a duplicate `txHash` was detected, without re-verifying the on-chain status. This caused issues when:

1. A transaction was stored as `FAILED` during a Stellar RPC outage, but actually succeeded on-chain
2. Users retrying the same transaction would continue to see the stale `FAILED` status
3. The only remediation was manual database intervention

## Solution

### 1. Idempotent Re-Verification

When a donation with an existing `txHash` is submitted:

- If the status is `PENDING` or `FAILED`
- And the donation was created within the last **30 seconds** (idempotency window)
- The system re-verifies the transaction on-chain using `stellarTxs.verifyDonationTransaction`

### 2. Status Recovery

If re-verification succeeds:

- The donation status is updated to `CONFIRMED`
- The `confirmedAt` timestamp is set
- Campaign statistics are recalculated
- A `recovered: true` flag is included in the response

### 3. Idempotency Window

The 30-second window prevents:

- Excessive Horizon/RPC calls during retry storms
- Resource exhaustion from repeated verification attempts
- Unnecessary re-verification of legitimately failed transactions

After the window expires, the cached status is returned as-is.

### 4. Response Flag

The `DonationResponseDto` now includes an optional `recovered` boolean:

- `recovered: true` - Status was successfully recovered from PENDING/FAILED
- `recovered: false` - Cached donation returned without re-verification
- `recovered: undefined` - Response from other endpoints that don't use this flag

## Implementation Details

### Code Changes

1. **`dto/donation.dto.ts`**: Added `recovered?: boolean` to `DonationResponseDto`
2. **`donations.service.ts`**:
   - Enhanced `createDonation` to check status and timing before returning cached records
   - Added `retryVerifyDonation` private method to handle re-verification logic
   - Set `recovered` flag appropriately in all response paths

### Idempotency Window Configuration

```typescript
const idempotencyWindowMs = 30_000; // 30 seconds
```

This can be adjusted based on:

- Average wallet client retry behavior
- Network conditions
- RPC rate limits

## Usage Example

### Client Behavior

```typescript
// User submits donation
const response = await createDonation({ txHash: "abc123", ... });

if (response.donation.status === 'FAILED' && !response.donation.recovered) {
  // Legitimately failed - show error
  showError("Transaction failed");
} else if (response.donation.status === 'CONFIRMED' && response.donation.recovered) {
  // Recovered from PENDING/FAILED - show success with recovery notice
  showSuccess("Transaction confirmed (recovered)");
} else if (response.donation.status === 'CONFIRMED') {
  // Normal confirmation
  showSuccess("Transaction confirmed");
}
```

## Benefits

1. **Automatic Recovery**: Users see correct status without manual intervention
2. **Client Transparency**: The `recovered` flag lets clients distinguish replays from recoveries
3. **Rate Limiting**: Idempotency window prevents excessive on-chain calls
4. **Audit Trail**: Recovery events can be logged/monitored via the flag

## Future Enhancements

- Make idempotency window configurable via environment variable
- Add metrics/logging for recovery events
- Consider extending recovery to other status transitions (e.g., REFUNDED)
- Implement exponential backoff for verification retries
