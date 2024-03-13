import { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'
import {
  ValidatorBondsProgram,
  checkAndGetBondAddress,
  getProgram,
} from '../../src'
import {
  BanksTransactionMeta,
  startAnchor,
  AddedAccount,
  AccountInfoBytes,
} from 'solana-bankrun'
import { BankrunProvider } from 'anchor-bankrun'
import {
  Keypair,
  PublicKey,
  Signer,
  Transaction,
  TransactionInstruction,
  TransactionInstructionCtorFields,
} from '@solana/web3.js'
import { instanceOfWallet } from '@marinade.finance/web3js-common'
import { ExtendedProvider } from '../utils/provider'
import { delegatedStakeAccount } from '../utils/staking'
import {
  executeFundBondInstruction,
  executeInitBondInstruction,
} from '../utils/testTransactions'
import 'reflect-metadata'
import {
  Expose, // eslint-disable-line @typescript-eslint/no-unused-vars
  Transform, // eslint-disable-line @typescript-eslint/no-unused-vars
  Type, // eslint-disable-line @typescript-eslint/no-unused-vars
  plainToInstance,
} from 'class-transformer'
import { readdirSync, readFileSync } from 'fs'
import path from 'path'

export class BankrunExtendedProvider
  extends BankrunProvider
  implements ExtendedProvider
{
  async sendIx(
    signers: (WalletInterface | Signer | Keypair)[],
    ...ixes: (
      | Transaction
      | TransactionInstruction
      | TransactionInstructionCtorFields
    )[]
  ): Promise<void> {
    const tx = await bankrunTransaction(this)
    tx.add(...ixes)
    await bankrunExecute(this, [this.wallet, ...signers], tx)
  }

  get walletPubkey(): PublicKey {
    return this.wallet.publicKey
  }
}

// note: VsCode error:
//       https://github.com/microsoft/TypeScript/issues/52396#issuecomment-1409152884
//       https://bobbyhadz.com/blog/typescript-experimental-support-for-decorators-warning#solve-the-error-in-visual-studio-code
export class JsonAccountData {
  @Expose()
  @Transform(({ value }) => Number(value))
  lamports!: number

  @Expose()
  data!: string[]

  @Expose()
  @Transform(({ value }) => new PublicKey(value))
  owner!: PublicKey

  @Expose()
  @Transform(({ value }) => Boolean(value))
  executable!: boolean

  @Expose()
  @Transform(({ value }) => Number(value))
  rentEpoch!: number
}
export class JsonAccount {
  @Expose()
  @Transform(({ value }) => new PublicKey(value))
  pubkey!: PublicKey

  @Expose()
  @Type(() => JsonAccountData)
  account!: JsonAccountData
}

function toAccountInfoBytes(jsonAccount: JsonAccount): AccountInfoBytes {
  const dataField = jsonAccount.account.data
  return {
    executable: jsonAccount.account.executable,
    owner: jsonAccount.account.owner,
    lamports: jsonAccount.account.lamports,
    data: Buffer.from(dataField[0], dataField[1] as BufferEncoding),
    rentEpoch: jsonAccount.account.rentEpoch,
  }
}

function loadAccountsFromJson(directory: string): AddedAccount[] {
  const accounts: JsonAccount[] = []
  for (const jsonFile of readdirSync(directory).filter(f =>
    f.endsWith('.json')
  )) {
    const jsonPath = path.join(directory, jsonFile)
    const fileBuffer = readFileSync(jsonPath)
    const parsedData = JSON.parse(fileBuffer.toString())
    const jsonAccount: JsonAccount = plainToInstance(JsonAccount, parsedData)
    accounts.push(jsonAccount)
  }
  return accounts.map(jsonAccount => {
    return {
      address: jsonAccount.pubkey,
      info: toAccountInfoBytes(jsonAccount),
    }
  })
}

export async function initBankrunTest(programId?: PublicKey): Promise<{
  program: ValidatorBondsProgram
  provider: BankrunExtendedProvider
}> {
  const additionalAccounts = loadAccountsFromJson('./fixtures/accounts/')
  const context = await startAnchor('./', [], additionalAccounts)
  const provider = new BankrunExtendedProvider(context)
  return {
    program: getProgram({ connection: provider, programId }),
    provider,
  }
}

export async function bankrunTransaction(
  provider: BankrunProvider
): Promise<Transaction> {
  const bh = await provider.context.banksClient.getLatestBlockhash()
  const lastValidBlockHeight = (
    bh === null ? Number.MAX_VALUE : bh[1]
  ) as number
  return new Transaction({
    feePayer: provider.wallet.publicKey,
    blockhash: provider.context.lastBlockhash,
    lastValidBlockHeight,
  })
}

export async function bankrunExecuteIx(
  provider: BankrunProvider,
  signers: (WalletInterface | Signer | Keypair)[],
  ...ixes: (
    | Transaction
    | TransactionInstruction
    | TransactionInstructionCtorFields
  )[]
): Promise<BanksTransactionMeta> {
  const tx = await bankrunTransaction(provider)
  tx.add(...ixes)
  return await bankrunExecute(provider, signers, tx)
}

export async function bankrunExecute(
  provider: BankrunProvider,
  signers: (WalletInterface | Signer | Keypair)[],
  tx: Transaction
): Promise<BanksTransactionMeta> {
  for (const signer of signers) {
    if (instanceOfWallet(signer)) {
      await signer.signTransaction(tx)
    } else if (signer instanceof Keypair || 'secretKey' in signer) {
      tx.partialSign(signer)
    } else {
      throw new Error(
        'bankrunExecute: provided signer parameter is not a signer: ' + signer
      )
    }
  }
  return await provider.context.banksClient.processTransaction(tx)
}

export async function assertNotExist(
  provider: BankrunProvider,
  account: PublicKey
) {
  const accountInfo = await provider.context.banksClient.getAccount(account)
  expect(accountInfo).toBeNull()
}

// https://github.com/solana-labs/solana/blob/v1.17.7/sdk/program/src/epoch_schedule.rs#L29C1-L29C45
export const MINIMUM_SLOTS_PER_EPOCH = 32
// https://github.com/solana-labs/solana/blob/v1.17.7/sdk/program/src/epoch_schedule.rs#L167
export function warpToEpoch(provider: BankrunProvider, epoch: number) {
  const epochBigInt = BigInt(epoch)
  const { slotsPerEpoch, firstNormalEpoch, firstNormalSlot } =
    provider.context.genesisConfig.epochSchedule
  let warpToSlot: bigint
  if (epochBigInt <= firstNormalEpoch) {
    warpToSlot = BigInt((2 ** epoch - 1) * MINIMUM_SLOTS_PER_EPOCH)
  } else {
    warpToSlot =
      (epochBigInt - firstNormalEpoch) * slotsPerEpoch + firstNormalSlot
  }
  provider.context.warpToSlot(warpToSlot)
}

export async function warpToNextEpoch(provider: BankrunProvider) {
  await warpOffsetEpoch(provider, 1)
}

export async function warpOffsetEpoch(
  provider: BankrunProvider,
  plusEpochs: number
) {
  const nextEpoch = (await currentEpoch(provider)) + plusEpochs
  warpToEpoch(provider, nextEpoch)
}

export async function currentEpoch(provider: BankrunProvider): Promise<number> {
  return Number((await provider.context.banksClient.getClock()).epoch)
}

export async function warpToNextSlot(provider: BankrunProvider) {
  const currentSlot = (await provider.context.banksClient.getClock()).slot
  provider.context.warpToSlot(currentSlot + BigInt(1))
}

// this cannot be in generic testTransactions.ts because of warping requires BankrunProvider
export async function delegateAndFund({
  program,
  provider,
  lamports,
  voteAccount,
  bondAccount,
  configAccount,
}: {
  program: ValidatorBondsProgram
  provider: BankrunExtendedProvider
  lamports: number
  voteAccount?: PublicKey
  bondAccount?: PublicKey
  configAccount?: PublicKey
}): Promise<{
  stakeAccount: PublicKey
  bondAccount: PublicKey
  voteAccount: PublicKey
  validatorIdentity: Keypair | undefined
}> {
  const {
    stakeAccount,
    withdrawer,
    voteAccount: voteAccountDelegated,
    validatorIdentity,
  } = await delegatedStakeAccount({
    provider,
    lamports,
    voteAccountToDelegate: voteAccount,
  })
  if (bondAccount && configAccount) {
    const bondToCheck = checkAndGetBondAddress(
      undefined,
      configAccount,
      voteAccountDelegated,
      program.programId
    )
    expect(bondAccount).toEqual(bondToCheck)
  }
  if (
    bondAccount === undefined ||
    (await provider.connection.getAccountInfo(bondAccount)) === null
  ) {
    if (configAccount === undefined) {
      throw new Error('delegateAndFund: configAccount is required')
    }
    ;({ bondAccount } = await executeInitBondInstruction({
      program,
      provider,
      voteAccount: voteAccountDelegated,
      validatorIdentity,
      configAccount,
    }))
  }

  await warpToNextEpoch(provider) // activating stake account
  await executeFundBondInstruction({
    program,
    provider,
    bondAccount: bondAccount,
    stakeAccount,
    stakeAccountAuthority: withdrawer,
  })
  return {
    stakeAccount,
    bondAccount,
    voteAccount: voteAccountDelegated,
    validatorIdentity,
  }
}
