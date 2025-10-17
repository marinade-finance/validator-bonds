/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any */

import {
  CliCommandError,
  IsBigInt,
  parseAndValidate,
} from '@marinade.finance/cli-common'
import { getContext } from '@marinade.finance/ts-common'
import { IsPublicKey } from '@marinade.finance/web3js-1x'
import { PublicKey } from '@solana/web3.js'
import { Expose, Transform, Type } from 'class-transformer'
import {
  ValidateNested,
  IsPositive,
  IsNumber,
  IsDefined,
  IsString,
  IsObject,
  IsOptional,
  IsEnum,
} from 'class-validator'

enum FunderType {
  ValidatorBond = 'ValidatorBond',
  Marinade = 'Marinade',
}

export class SettlementMeta {
  @Expose()
  @IsEnum(FunderType)
  readonly funder!: FunderType
}

// Protected Event Details
export class DowntimeRevenueImpact {
  @Expose()
  @IsPublicKey({ message: 'Invalid vote account public key' })
  @Transform(({ value }) => (value ? new PublicKey(value) : value))
  readonly vote_account!: PublicKey

  @Expose()
  @IsBigInt()
  @Transform(({ value }) => (value ? BigInt(value) : 0n))
  readonly actual_credits!: bigint

  @Expose()
  @IsBigInt()
  @Transform(({ value }) => (value ? BigInt(value) : 0n))
  readonly expected_credits!: bigint

  @Expose()
  @IsNumber()
  readonly expected_epr!: number

  @Expose()
  @IsNumber()
  readonly actual_epr!: number

  @Expose()
  @IsNumber()
  readonly epr_loss_bps!: number

  @Expose()
  @IsBigInt()
  @Transform(({ value }) => (value ? BigInt(value) : 0n))
  readonly stake!: bigint
}

export class ProtectedEventWrapper {
  @Expose()
  @IsObject()
  @ValidateNested()
  @Type(() => DowntimeRevenueImpact)
  @IsOptional()
  readonly DowntimeRevenueImpact?: DowntimeRevenueImpact

  // Add other protected event types here as needed
  // readonly SomeOtherEventType?: SomeOtherEventType
}

// Settlement Reason - can be a string or an object with ProtectedEvent
export class SettlementReason {
  @Expose()
  @IsObject()
  @ValidateNested()
  @Type(() => ProtectedEventWrapper)
  @IsOptional()
  readonly ProtectedEvent?: ProtectedEventWrapper

  @Expose()
  @IsString()
  @IsOptional()
  @Transform(({ obj }) => {
    // If it's a simple string reason
    if (typeof obj.reason === 'string') {
      return obj.reason
    }
    return undefined
  })
  readonly simpleReason?: string

  // Helper method to get the reason type
  getReasonType(): string {
    if (this.ProtectedEvent) {
      return 'ProtectedEvent'
    }
    return this.simpleReason || 'Unknown'
  }
}

export class StakeAccountClaim {
  @Expose()
  @IsPublicKey({ message: 'Invalid withdraw authority public key' })
  @Transform(({ value }) => (value ? new PublicKey(value) : value))
  readonly withdraw_authority!: PublicKey

  @Expose()
  @IsPublicKey({ message: 'Invalid stake authority public key' })
  @Transform(({ value }) => (value ? new PublicKey(value) : value))
  readonly stake_authority!: PublicKey

  @Expose()
  @IsDefined()
  readonly stake_accounts!: Record<string, number>

  @Expose()
  @IsBigInt()
  @Transform(({ value }) => (value ? BigInt(value) : 0n))
  readonly active_stake!: bigint

  @Expose()
  @IsBigInt()
  @Transform(({ value }) => (value ? BigInt(value) : 0n))
  readonly claim_amount!: bigint
}

export class Settlement {
  @Expose()
  @Transform(({ value }) => {
    // Handle both string and object reasons
    if (typeof value === 'string') {
      const reason = new SettlementReason()
      ;(reason as any).simpleReason = value
      return reason
    } else if (typeof value === 'object') {
      return value
    }
    return value
  })
  @ValidateNested()
  @Type(() => SettlementReason)
  readonly reason!: SettlementReason

  @Expose()
  @IsObject()
  @ValidateNested()
  @Type(() => SettlementMeta)
  readonly meta!: SettlementMeta

  @Expose()
  @IsPublicKey({ message: 'Invalid vote account public key' })
  @Transform(({ value }) => (value ? new PublicKey(value) : value))
  readonly vote_account!: PublicKey

  @Expose()
  @IsNumber()
  readonly claims_count!: number

  @Expose()
  @IsBigInt()
  @Transform(({ value }) => (value ? BigInt(value) : 0n))
  readonly claims_amount!: bigint

  @Expose()
  @ValidateNested({ each: true })
  @Type(() => StakeAccountClaim)
  readonly claims!: StakeAccountClaim[]
}

export class SettlementsDto {
  @Expose()
  @IsBigInt()
  @Transform(({ value }) => (value ? BigInt(value) : 0n))
  readonly slot!: bigint

  @Expose()
  @IsPositive()
  readonly epoch!: number

  @Expose()
  @ValidateNested({ each: true })
  @Type(() => Settlement)
  readonly settlements!: Settlement[]
}

export async function parseSettlements(
  inputJson: string,
  path?: string,
): Promise<SettlementsDto> {
  const { logger } = getContext()
  try {
    const { data: settlements } = await parseAndValidate<SettlementsDto>(
      inputJson,
      SettlementsDto,
    )
    logger.debug(
      'Settlements loaded successfully [epoch: %s, settlements: %s]',
      settlements.epoch,
      settlements.settlements.length,
    )
    return settlements
  } catch (error) {
    throw CliCommandError.instance(
      `Failed to load and validate 'settlements' data from path: '${path}'`,
      error,
    )
  }
}
