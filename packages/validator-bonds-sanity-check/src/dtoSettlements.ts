/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any */

import {
  CliCommandError,
  IsBigInt,
  validateAndReturn,
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

import { parseLosslessJson } from './losslessJson'

enum FunderType {
  ValidatorBond = 'ValidatorBond',
  Marinade = 'Marinade',
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

export enum ClaimKind {
  StakerPayout = 'StakerPayout',
  FeeDeposit = 'FeeDeposit',
  Marker = 'Marker',
}

export abstract class SettlementClaim {
  @Expose()
  @IsPublicKey({ message: 'Invalid withdraw authority public key' })
  @Transform(({ value }) => (value ? new PublicKey(value) : value))
  readonly withdraw_authority!: PublicKey

  @Expose()
  @IsPublicKey({ message: 'Invalid stake authority public key' })
  @Transform(({ value }) => (value ? new PublicKey(value) : value))
  readonly stake_authority!: PublicKey

  @Expose()
  @IsBigInt()
  @Transform(({ value }) => (value ? BigInt(value) : 0n))
  readonly claim_amount!: bigint

  @Expose()
  @IsEnum(ClaimKind)
  readonly kind!: ClaimKind
}

export class StakerPayoutClaim extends SettlementClaim {
  @Expose()
  @IsDefined()
  @Transform(({ value }) =>
    value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value as Record<string, number | bigint>).map(
            ([stakeAccount, lamports]) => [stakeAccount, BigInt(lamports)],
          ),
        )
      : value,
  )
  readonly stake_accounts!: Record<string, bigint>

  @Expose()
  @IsBigInt()
  @Transform(({ value }) => (value ? BigInt(value) : 0n))
  readonly active_stake!: bigint

  @Expose()
  @IsBigInt()
  @Transform(({ value }) => (value ? BigInt(value) : 0n))
  readonly activating_stake!: bigint
}

export class FeeDepositClaim extends SettlementClaim {}

export class MarkerClaim extends SettlementClaim {}

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
  @IsEnum(FunderType)
  readonly funder!: FunderType

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
  @Type(() => SettlementClaim, {
    keepDiscriminatorProperty: true,
    discriminator: {
      property: 'kind',
      subTypes: [
        { value: StakerPayoutClaim, name: ClaimKind.StakerPayout },
        { value: FeeDepositClaim, name: ClaimKind.FeeDeposit },
        { value: MarkerClaim, name: ClaimKind.Marker },
      ],
    },
  })
  readonly claims!: SettlementClaim[]
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

// Detects pre-refactor settlement JSON (top-level `meta` instead of `funder`,
// or claims without a `kind` discriminator) and fails with an actionable message
// instead of class-validator's cryptic `isEnum` error. Legacy files are not
// supported: regenerate them with the current pipeline to get the new format.
function assertNotLegacyFormat(inputJson: string, path?: string): void {
  const asRecord = (value: unknown): Record<string, unknown> | undefined =>
    typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : undefined

  let parsed: unknown
  try {
    parsed = JSON.parse(inputJson)
  } catch {
    return // leave malformed JSON to parseAndValidate's own error
  }
  const settlements = asRecord(parsed)?.settlements
  if (!Array.isArray(settlements) || settlements.length === 0) {
    return
  }
  const isLegacy = (settlement: unknown): boolean => {
    const record = asRecord(settlement)
    if (record === undefined) {
      return false
    }
    const legacyFunder =
      record.funder === undefined && asRecord(record.meta)?.funder !== undefined
    const claims = record.claims
    const legacyClaim =
      Array.isArray(claims) &&
      claims.length > 0 &&
      claims.some(claim => asRecord(claim)?.kind === undefined)
    return legacyFunder || legacyClaim
  }
  if (settlements.some(isLegacy)) {
    const at = path !== undefined ? ` at path '${path}'` : ''
    throw CliCommandError.instance(
      `'settlements' data${at} is in the legacy pre-refactor format (missing top-level 'funder' and/or per-claim 'kind'). Legacy files are not supported — regenerate this epoch with the current pipeline to produce the new format.`,
    )
  }
}

export async function parseSettlements(
  inputJson: string,
  path?: string,
): Promise<SettlementsDto> {
  const { logger } = getContext()
  assertNotLegacyFormat(inputJson, path)
  try {
    // Lossless parse (u64 above 2^53-1 arrives as bigint) + cli-common's
    // validation machinery — parseAndValidate would round through JSON.parse.
    const parsed = await parseLosslessJson(inputJson)
    const settlements = await validateAndReturn<SettlementsDto>(
      parsed,
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
