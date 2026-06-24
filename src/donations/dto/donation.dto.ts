import {
  IsString,
  IsOptional,
  IsNumberString,
  IsUUID,
  IsIn,
} from 'class-validator';

export class CreateDonationDto {
  @IsString()
  campaignId: string;

  @IsNumberString()
  amount: string;

  @IsOptional()
  @IsString()
  assetCode?: string;

  @IsOptional()
  @IsString()
  txHash?: string;

  @IsOptional()
  @IsNumberString()
  tipAmount?: string;

  @IsOptional()
  @IsString()
  tipAsset?: string;
}

/** Response DTO for donation records returned by the API */
export class DonationResponseDto {
  id: string;
  amount: string;
  assetCode: string;
  txHash: string | null;
  status: string;
  donorId: string;
  campaignId: string;
  tipAmount: string | null;
  tipAsset: string | null;
  tipId: string | null;
  donatedAt: Date;
  confirmedAt: Date | null;
  createdAt: Date;
  /** Flag indicating if the donation status was recovered from PENDING/FAILED on re-verification */
  recovered?: boolean;
}

export class PlatformTipResponseDto {
  id: string;
  amount: string;
  assetCode: string;
  txHash: string;
  status: string;
  donorId: string;
  donationId: string | null;
  confirmedAt: Date | null;
  createdAt: Date;
}
