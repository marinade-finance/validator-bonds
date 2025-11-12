/* eslint-disable @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-unsafe-argument */

import {
  AnchorProvider,
  Program,
  parseIdlErrors,
  Wallet,
} from '@coral-xyz/anchor'
import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes'
import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import BN from 'bn.js'

import ValidatorBondsIDL from '../idl/json/validator_bonds.json'

import type { ValidatorBonds } from '../idl/types/validator_bonds'
import type { IdlEvents, IdlTypes, IdlAccounts } from '@coral-xyz/anchor'
import type { Wallet as AnchorWalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'
import type { Provider } from '@marinade.finance/marinade-ts-sdk'
import type { ConfirmOptions, EpochInfo } from '@solana/web3.js'

export const MARINADE_CONFIG_ADDRESS = new PublicKey(
  'vbMaRfmTCg92HWGzmd53APkMNpPnGVGZTUHwUJQkXAU',
)
export const MARINADE_INSTITUTIONAL_CONFIG_ADDRESS = new PublicKey(
  'VbinSTyUEC8JXtzFteC4ruKSfs6dkQUUcY6wB1oJyjE',
)

export const VALIDATOR_BONDS_PROGRAM_ID = new PublicKey(
  JSON.parse(
    ValidatorBondsIDL.constants.find(x => x.name === 'PROGRAM_ID')!.value,
  ),
)

export { ValidatorBonds }
export type ValidatorBondsProgram = Program<ValidatorBonds>

// --- ACCOUNTS ---
export type Config = IdlAccounts<ValidatorBonds>['config']
export type Bond = IdlAccounts<ValidatorBonds>['bond']
export type SettlementClaims = IdlAccounts<ValidatorBonds>['settlementClaims']
export type Settlement = IdlAccounts<ValidatorBonds>['settlement']
export type WithdrawRequest = IdlAccounts<ValidatorBonds>['withdrawRequest']

// --- TYPES ---
export type InitConfigArgs = IdlTypes<ValidatorBonds>['initConfigArgs']
export type ConfigureConfigArgs =
  IdlTypes<ValidatorBonds>['configureConfigArgs']
export type InitBondArgs = IdlTypes<ValidatorBonds>['initBondArgs']

// --- DISCRIMINATORS ---
function fromDiscriminators(accountName: string): number[] {
  const accountData = ValidatorBondsIDL.accounts.find(
    x => x.name.toLowerCase() === accountName.toLowerCase(),
  )
  if (accountData === undefined) {
    throw new Error(
      'SDK initialization failure. Validator bonds IDL does not define discriminator for account ' +
        accountName,
    )
  }
  return accountData.discriminator
}
function discriminator(accountName: string): string {
  return bs58.encode(fromDiscriminators(accountName))
}
export const CONFIG_ACCOUNT_DISCRIMINATOR = discriminator('Config')
export const BOND_ACCOUNT_DISCRIMINATOR = discriminator('Bond')
export const SETTLEMENT_CLAIMS_ACCOUNT_DISCRIMINATOR =
  discriminator('SettlementClaims')
export const SETTLEMENT_ACCOUNT_DISCRIMINATOR = discriminator('Settlement')
export const WITHDRAW_REQUEST_ACCOUNT_DISCRIMINATOR =
  discriminator('WithdrawRequest')

// --- CONSTANTS ---
function fromConstants(constantName: string): string {
  const constant = ValidatorBondsIDL.constants.find(
    x => x.name === constantName,
  )
  if (constant === undefined) {
    throw new Error(
      'SDK initialization failure. Validator bonds IDL does not define constant ' +
        constant,
    )
  }
  return constant.value
}
export function seedFromConstants(seedName: string): Uint8Array {
  const constantValue = fromConstants(seedName)
  return new Uint8Array(JSON.parse(constantValue))
}
export const BOND_SEED = seedFromConstants('BOND_SEED')
export const BOND_MINT_SEED = seedFromConstants('BOND_MINT_SEED')
export const SETTLEMENT_SEED = seedFromConstants('SETTLEMENT_SEED')
export const WITHDRAW_REQUEST_SEED = seedFromConstants('WITHDRAW_REQUEST_SEED')
export const SETTLEMENT_CLAIMS_SEED = seedFromConstants(
  'SETTLEMENT_CLAIMS_SEED',
)
export const BONDS_WITHDRAWER_AUTHORITY_SEED = seedFromConstants(
  'BONDS_WITHDRAWER_AUTHORITY_SEED',
)
export const SETTLEMENT_STAKER_AUTHORITY_SEED = seedFromConstants(
  'SETTLEMENT_STAKER_AUTHORITY_SEED',
)
export const SETTLEMENT_CLAIMS_ANCHOR_HEADER_SIZE = Number(
  fromConstants('SETTLEMENT_CLAIMS_ANCHOR_HEADER_SIZE'),
)
export const EVENT_AUTHORITY_SEED_STRING = '__event_authority'

// --- EVENTS ---
export const INIT_CONFIG_EVENT = 'initConfigEvent'
export type InitConfigEvent =
  IdlEvents<ValidatorBonds>[typeof INIT_CONFIG_EVENT]

export const CONFIGURE_CONFIG_EVENT = 'configureConfigEvent'
export type ConfigureConfigEvent =
  IdlEvents<ValidatorBonds>[typeof CONFIGURE_CONFIG_EVENT]

export const INIT_BOND_EVENT = 'initBondEvent'
export type InitBondEvent = IdlEvents<ValidatorBonds>[typeof INIT_BOND_EVENT]

export const CONFIGURE_BOND_EVENT = 'configureBondEvent'
export type ConfigureBondEvent =
  IdlEvents<ValidatorBonds>[typeof CONFIGURE_BOND_EVENT]

export const CONFIGURE_BOND_WITH_MINT_EVENT = 'configureBondWithMintEvent'
export type ConfigureBondWithMintEvent =
  IdlEvents<ValidatorBonds>[typeof CONFIGURE_BOND_WITH_MINT_EVENT]

export const MINT_BOND_EVENT = 'mintBondEvent'
export type MintBondEvent = IdlEvents<ValidatorBonds>[typeof MINT_BOND_EVENT]

export const FUND_BOND_EVENT = 'fundBondEvent'
export type FundBondEvent = IdlEvents<ValidatorBonds>[typeof FUND_BOND_EVENT]

export const FUND_SETTLEMENT_EVENT = 'fundSettlementEvent'
export type FundSettlementEvent =
  IdlEvents<ValidatorBonds>[typeof FUND_SETTLEMENT_EVENT]

export const CLAIM_SETTLEMENT_V2_EVENT = 'claimSettlementV2Event'
export type ClaimSettlementV2Event =
  IdlEvents<ValidatorBonds>[typeof CLAIM_SETTLEMENT_V2_EVENT]

export const INIT_SETTLEMENT_EVENT = 'initSettlementEvent'
export type InitSettlementEvent =
  IdlEvents<ValidatorBonds>[typeof INIT_SETTLEMENT_EVENT]

export const CLOSE_SETTLEMENT_EVENT = 'closeSettlementEvent'
export type CloseSettlementEvent =
  IdlEvents<ValidatorBonds>[typeof CLOSE_SETTLEMENT_EVENT]

export const CANCEL_SETTLEMENT_EVENT = 'cancelSettlementEvent'
export type CancelSettlementEvent =
  IdlEvents<ValidatorBonds>[typeof CANCEL_SETTLEMENT_EVENT]

export const MERGE_STAKE_EVENT = 'mergeStakeEvent'
export type MergeStakeEvent =
  IdlEvents<ValidatorBonds>[typeof MERGE_STAKE_EVENT]

export const RESET_STAKE_EVENT = 'resetStakeEvent'
export type ResetStakeEvent =
  IdlEvents<ValidatorBonds>[typeof RESET_STAKE_EVENT]

export const WITHDRAW_STAKE_EVENT = 'withdrawStakeEvent'
export type WithdrawStakeEvent =
  IdlEvents<ValidatorBonds>[typeof WITHDRAW_STAKE_EVENT]

export const INIT_WITHDRAW_REQUEST_EVENT = 'initWithdrawRequestEvent'
export type InitWithdrawRequestEvent =
  IdlEvents<ValidatorBonds>[typeof INIT_WITHDRAW_REQUEST_EVENT]

export const CANCEL_WITHDRAW_REQUEST_EVENT = 'cancelWithdrawRequestEvent'
export type CancelWithdrawRequestEvent =
  IdlEvents<ValidatorBonds>[typeof CANCEL_WITHDRAW_REQUEST_EVENT]

export const CLAIM_WITHDRAW_REQUEST_EVENT = 'claimWithdrawRequestEvent'
export type ClaimWithdrawRequestEvent =
  IdlEvents<ValidatorBonds>[typeof CLAIM_WITHDRAW_REQUEST_EVENT]

export const EMERGENCY_PAUSE_EVENT = 'emergencyPauseEvent'
export type EmergencyPauseEvent =
  IdlEvents<ValidatorBonds>[typeof EMERGENCY_PAUSE_EVENT]

export const EMERGENCY_RESUME_EVENT = 'emergencyResumeEvent'
export type EmergencyResumeEvent =
  IdlEvents<ValidatorBonds>[typeof EMERGENCY_RESUME_EVENT]

export const Errors = parseIdlErrors(ValidatorBondsIDL as ValidatorBonds)

/**
 * Creating Anchor program instance of the Validator Bonds contract.
 * It takes a Provider instance or a Connection and a Wallet.
 * @type {Object} args - Arguments on instruction creation
 * @param param {Connection|Provider} args.connection - connection to solana blockchain that program can be executed on
 *              This can be either Connection instance or Provider instance (when connection is provided, wallet is required)
 * @param param {Wallet|Keypair} args.wallet - wallet to be used as default feePayer and default signers provider
 *               When provider is provided, wallet is not required and it's not used(!) (provider instance is packed with a wallet)
 * @param param {ConfirmOptions} args.opts - connection options for creating transactions for the program
 *               When provider is provided, opts is not required and it's not used(!) (provider instance is packed with connection and opts)
 * @param param {PublicKey} args.programId - program id of the Validator Bonds program
 * @return {ValidatorBondsProgram} - Validator Bonds Anchor program instance
 */
export function getProgram({
  connection,
  wallet,
  opts,
}: {
  connection: Connection | Provider
  wallet?: AnchorWalletInterface | Keypair
  opts?: ConfirmOptions
}): ValidatorBondsProgram {
  let provider: Provider
  if (connection instanceof Connection) {
    if (wallet === undefined) {
      throw new Error(
        'Wallet is required when connection is provided. ' +
          'Please provide a wallet or a provider object.',
      )
    }
    if (wallet instanceof Keypair) {
      wallet = new Wallet(wallet)
    }
    provider = new AnchorProvider(
      connection,
      wallet,
      opts ?? AnchorProvider.defaultOptions(),
    )
  } else {
    provider = connection
  }
  return new Program<ValidatorBonds>(ValidatorBondsIDL, provider)
}

export function bondAddress(
  config: PublicKey,
  voteAccount: PublicKey,
  validatorBondsProgramId: PublicKey = VALIDATOR_BONDS_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [BOND_SEED, config.toBytes(), voteAccount.toBytes()],
    validatorBondsProgramId,
  )
}

export function bondsWithdrawerAuthority(
  config: PublicKey,
  validatorBondsProgramId: PublicKey = VALIDATOR_BONDS_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [BONDS_WITHDRAWER_AUTHORITY_SEED, config.toBytes()],
    validatorBondsProgramId,
  )
}

export function uintToBuffer(number: EpochInfo | number | BN | bigint): Buffer {
  const uintLittleEndian = Buffer.alloc(8)
  const epochBigint =
    typeof number === 'number' ||
    number instanceof BN ||
    typeof number === 'bigint'
      ? BigInt(number.toString())
      : BigInt(number.epoch)
  uintLittleEndian.writeBigUint64LE(epochBigint)
  return uintLittleEndian
}

export function settlementAddress(
  bond: PublicKey,
  merkleRoot: Uint8Array | Buffer | number[],
  epoch: EpochInfo | number | BN | bigint,
  validatorBondsProgramId: PublicKey = VALIDATOR_BONDS_PROGRAM_ID,
): [PublicKey, number] {
  if (Array.isArray(merkleRoot)) {
    merkleRoot = new Uint8Array(merkleRoot)
  }
  const epochBuffer = uintToBuffer(epoch)
  return PublicKey.findProgramAddressSync(
    [SETTLEMENT_SEED, bond.toBytes(), merkleRoot, epochBuffer],
    validatorBondsProgramId,
  )
}

export function settlementStakerAuthority(
  settlement: PublicKey,
  validatorBondsProgramId: PublicKey = VALIDATOR_BONDS_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SETTLEMENT_STAKER_AUTHORITY_SEED, settlement.toBytes()],
    validatorBondsProgramId,
  )
}

export function settlementClaimsAddress(
  settlement: PublicKey,
  validatorBondsProgramId: PublicKey = VALIDATOR_BONDS_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SETTLEMENT_CLAIMS_SEED, settlement.toBytes()],
    validatorBondsProgramId,
  )
}

export function withdrawRequestAddress(
  bond: PublicKey,
  validatorBondsProgramId: PublicKey = VALIDATOR_BONDS_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [WITHDRAW_REQUEST_SEED, bond.toBytes()],
    validatorBondsProgramId,
  )
}

export function bondMintAddress(
  bond: PublicKey,
  validatorIdentity: PublicKey,
  validatorBondsProgramId: PublicKey = VALIDATOR_BONDS_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [BOND_MINT_SEED, bond.toBytes(), validatorIdentity.toBytes()],
    validatorBondsProgramId,
  )
}

export function eventAuthorityAddress(
  validatorBondsProgramId: PublicKey = VALIDATOR_BONDS_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(EVENT_AUTHORITY_SEED_STRING)],
    validatorBondsProgramId,
  )
}
