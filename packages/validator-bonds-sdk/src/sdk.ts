import * as generated from '../generated/validator_bonds'
import {
  Program as AnchorProgram,
  IdlAccounts,
  IdlEvents,
  AnchorProvider,
  Program,
  parseIdlErrors,
  Provider,
  Wallet,
} from '@coral-xyz/anchor'
import { Wallet as AnchorWalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'
import { ConfirmOptions, Connection, Keypair, PublicKey } from '@solana/web3.js'

/**
 * Validator Bonds contract Anchor IDL wrapper.
 *
 * All operations are performed through the program instance.
 *
 * To get PDA and read account data see ./api.ts
 * To execute contract operations see ./with*.ts
 */

// TODO: randomly generated, need to grind a better name
// [31,4,248,145,147,37,94,44,125,60,3,95,42,22,31,88,208,50,111,112,185,74,80,202,199,99,65,61,75,177,127,57,38,144,218,174,173,95,124,225,178,105,31,9,171,187,49,43,254,39,37,196,22,237,49,171,154,108,218,48,77,202,198,127]
export const CONFIG_ADDRESS = new PublicKey(
  '3bYbwEVbfXbmM9evW5bRbFPS9usdp6dtYCYsYtq6NLcE'
)

export const ValidatorBondsIDL = generated.IDL

export const VALIDATOR_BONDS_PROGRAM_ID = new PublicKey(
  JSON.parse(generated.IDL.constants.find(x => x.name === 'PROGRAM_ID')!.value)
)

export type ValidatorBonds = generated.ValidatorBonds
export type ValidatorBondsProgram = AnchorProgram<ValidatorBonds>

// --- ACCOUNTS ---
export type Config = IdlAccounts<ValidatorBonds>['config']

// --- CONSTANTS ---
export const BONDS_AUTHORITY_SEED = new Uint8Array(
  JSON.parse(
    generated.IDL.constants.find(x => x.name === 'BONDS_AUTHORITY_SEED')!.value
  )
)
export const SETTLEMENT_AUTHORITY_SEED = new Uint8Array(
  JSON.parse(
    generated.IDL.constants.find(x => x.name === 'SETTLEMENT_AUTHORITY_SEED')!
      .value
  )
)

// --- EVENTS ---
export const INIT_CONFIG_EVENT = 'InitConfigEvent'
export type InitConfigEvent =
  IdlEvents<ValidatorBonds>[typeof INIT_CONFIG_EVENT]

export const Errors = parseIdlErrors(generated.IDL)

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
  programId = VALIDATOR_BONDS_PROGRAM_ID,
}: {
  connection: Connection | Provider
  wallet?: AnchorWalletInterface | Keypair
  opts?: ConfirmOptions
  programId?: PublicKey
}): ValidatorBondsProgram {
  let provider: Provider
  if (connection instanceof Connection) {
    if (wallet === undefined) {
      throw new Error(
        'Wallet is required when connection is provided. ' +
          'Please provide a wallet or a provider object.'
      )
    }
    if (wallet instanceof Keypair) {
      wallet = new Wallet(wallet)
    }
    provider = new AnchorProvider(
      connection,
      wallet,
      opts || AnchorProvider.defaultOptions()
    )
  } else {
    provider = connection
  }
  return new Program<ValidatorBonds>(generated.IDL, programId, provider)
}

export function findBondsWithdrawerAuthority(
  config: PublicKey,
  validatorBondsProgramId: PublicKey = VALIDATOR_BONDS_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [BONDS_AUTHORITY_SEED, config.toBytes()],
    validatorBondsProgramId
  )
}
