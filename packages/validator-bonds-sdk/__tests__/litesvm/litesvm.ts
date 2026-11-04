import { createHash } from 'crypto'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

import { Wallet } from '@coral-xyz/anchor'
import { instanceOfWallet } from '@marinade.finance/web3js-1x'
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SendTransactionError,
  StakeProgram,
  Transaction,
} from '@solana/web3.js'
import bs58 from 'bs58'
import {
  EpochSchedule,
  FailedTransactionMetadata,
  FeatureSet,
  LiteSVM,
  StakeHistory,
  StakeHistoryEntry,
} from 'litesvm'

import {
  VALIDATOR_BONDS_PROGRAM_ID,
  checkAndGetBondAddress,
  getProgram,
} from '../../src'
import { delegatedStakeAccount } from '../utils/staking'
import {
  executeFundBondInstruction,
  executeInitBondInstruction,
} from '../utils/testTransactions'

import type { ValidatorBondsProgram } from '../../src'
import type { ExtendedProvider, SignerType } from '@marinade.finance/web3js-1x'
import type {
  AccountInfo,
  Connection,
  EpochInfo,
  TransactionInstruction,
  TransactionInstructionCtorFields,
} from '@solana/web3.js'

type Address = Parameters<LiteSVM['getAccount']>[0]
type Lamports = Parameters<LiteSVM['airdrop']>[1]
type KitTransaction = Parameters<LiteSVM['sendTransaction']>[0]

const REPO_ROOT = join(__dirname, '..', '..', '..', '..')
const MAINNET_FIXTURE_DIR = join(REPO_ROOT, 'fixtures', 'mainnet')
const METAPLEX_PROGRAM_ID = new PublicKey(
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',
)
const SLOTS_PER_EPOCH = 32n
const STAKE_HISTORY_MAX_ENTRIES = 512n
// cluster-wide stake large enough that any test stake warms up or cools down within one epoch
const CLUSTER_EFFECTIVE_STAKE = 400_000_000n * BigInt(LAMPORTS_PER_SOL)
const CLUSTER_CHANGING_STAKE = 1_000_000n * BigInt(LAMPORTS_PER_SOL)

type StakeProgramManifest = {
  cluster: string
  programId: string
  programData: string
  deploySlot: number
  size: number
  sha256: string
}

type JsonAccount = {
  pubkey: string
  account: {
    lamports: number
    data: [string, BufferEncoding]
    owner: string
    executable: boolean
  }
}

function address(pubkey: PublicKey): Address {
  return pubkey.toBase58() as Address
}

function getAccount(
  svm: LiteSVM,
  pubkey: PublicKey,
): AccountInfo<Buffer> | null {
  const account = svm.getAccount(address(pubkey))
  if (!account.exists) {
    return null
  }
  return {
    lamports: Number(account.lamports),
    owner: new PublicKey(account.programAddress),
    executable: account.executable,
    data: Buffer.from(account.data),
  }
}

function setAccount(
  svm: LiteSVM,
  pubkey: PublicKey,
  account: Omit<AccountInfo<Buffer | Uint8Array>, 'rentEpoch'>,
) {
  svm.setAccount({
    address: address(pubkey),
    lamports: BigInt(account.lamports) as Lamports,
    programAddress: address(account.owner),
    executable: account.executable,
    data: new Uint8Array(account.data),
    space: BigInt(account.data.length),
  })
}

class LiteSvmConnection {
  readonly rpcEndpoint = 'litesvm'

  constructor(private readonly svm: LiteSVM) {}

  getAccountInfo(pubkey: PublicKey): Promise<AccountInfo<Buffer> | null> {
    return Promise.resolve(getAccount(this.svm, pubkey))
  }

  async getAccountInfoAndContext(pubkey: PublicKey) {
    return {
      context: { slot: Number(this.svm.getClock().slot) },
      value: await this.getAccountInfo(pubkey),
    }
  }

  getMinimumBalanceForRentExemption(dataLength: number): Promise<number> {
    return Promise.resolve(
      Number(this.svm.minimumBalanceForRentExemption(BigInt(dataLength))),
    )
  }

  getEpochInfo(): Promise<EpochInfo> {
    const { slot, epoch } = this.svm.getClock()
    return Promise.resolve({
      epoch: Number(epoch),
      slotIndex: Number(slot - epoch * SLOTS_PER_EPOCH),
      slotsInEpoch: Number(SLOTS_PER_EPOCH),
      absoluteSlot: Number(slot),
      blockHeight: Number(slot),
    })
  }
}

export class LiteSvmProvider implements ExtendedProvider {
  readonly connection: Connection
  readonly wallet: Wallet

  constructor(readonly svm: LiteSVM) {
    this.wallet = new Wallet(Keypair.generate())
    svm.airdrop(
      address(this.wallet.publicKey),
      BigInt(1_000_000 * LAMPORTS_PER_SOL) as Lamports,
    )
    this.connection = new LiteSvmConnection(svm) as unknown as Connection
  }

  get publicKey(): PublicKey {
    return this.wallet.publicKey
  }

  get walletPubkey(): PublicKey {
    return this.wallet.publicKey
  }

  setAccount(
    pubkey: PublicKey,
    account: Omit<AccountInfo<Buffer | Uint8Array>, 'rentEpoch'>,
  ) {
    setAccount(this.svm, pubkey, account)
  }

  async sendIx(
    signers: SignerType[],
    ...ixes: (
      Transaction | TransactionInstruction | TransactionInstructionCtorFields
    )[]
  ): Promise<void> {
    await executeIx(this, [this.wallet, ...signers], ...ixes)
  }
}

function toKitTransaction(tx: Transaction): KitTransaction {
  const signatures = Object.fromEntries(
    tx.signatures.map(({ publicKey, signature }) => [
      publicKey.toBase58(),
      signature === null ? null : new Uint8Array(signature),
    ]),
  )
  return {
    messageBytes: new Uint8Array(tx.serializeMessage()),
    signatures,
  } as unknown as KitTransaction
}

/**
 * Sends the instructions in one transaction signed by `signers`; the first one pays the fee.
 * @returns logs and return data of the successful transaction
 * @throws SendTransactionError carrying the program logs when the transaction fails
 */
export async function executeIx(
  provider: LiteSvmProvider,
  signers: SignerType[],
  ...ixes: (
    Transaction | TransactionInstruction | TransactionInstructionCtorFields
  )[]
): Promise<{ logMessages: string[]; returnData: Buffer }> {
  const tx = new Transaction({
    feePayer: provider.wallet.publicKey,
    blockhash: provider.svm.latestBlockhash(),
    lastValidBlockHeight: Number.MAX_SAFE_INTEGER,
  }).add(...ixes)
  for (const signer of signers) {
    if (instanceOfWallet(signer)) {
      await signer.signTransaction(tx)
    } else {
      tx.partialSign(signer)
    }
  }
  const result = provider.svm.sendTransaction(toKitTransaction(tx))
  // a fresh blockhash per transaction so a repeated instruction set is not rejected as a duplicate
  provider.svm.expireBlockhash()
  if (result instanceof FailedTransactionMetadata) {
    throw new SendTransactionError({
      action: 'send',
      signature: bs58.encode(tx.signature ?? new Uint8Array(64)),
      transactionMessage: result.err().toString(),
      logs: result.meta().logs(),
    })
  }
  return {
    logMessages: result.logs(),
    returnData: Buffer.from(result.returnData().data()),
  }
}

/**
 * Builds the feature set active on mainnet when the fixture was taken.
 * The fixture is refreshed by `bun scripts/mainnet-fixture.ts`.
 */
export function mainnetFeatureSet(): FeatureSet {
  const { activated } = JSON.parse(
    readFileSync(join(MAINNET_FIXTURE_DIR, 'features.json'), 'utf8'),
  ) as { activated: Record<string, number> }
  const featureSet = new FeatureSet()
  for (const [feature, slot] of Object.entries(activated)) {
    featureSet.activate(new PublicKey(feature).toBytes(), BigInt(slot))
  }
  return featureSet
}

/**
 * Loads the pinned mainnet stake program, refusing a binary that differs from its manifest.
 * The fixture is refreshed by `bun scripts/mainnet-fixture.ts`.
 */
export function addMainnetStakeProgram(svm: LiteSVM): StakeProgramManifest {
  const manifest = JSON.parse(
    readFileSync(join(MAINNET_FIXTURE_DIR, 'stake_program.json'), 'utf8'),
  ) as StakeProgramManifest
  const elf = readFileSync(join(MAINNET_FIXTURE_DIR, 'stake_program.so'))
  const sha256 = createHash('sha256').update(elf).digest('hex')
  if (elf.length !== manifest.size || sha256 !== manifest.sha256) {
    throw new Error(
      `stake_program.so (${elf.length} bytes, ${sha256}) does not match its manifest ` +
        `(${manifest.size} bytes, ${manifest.sha256}); run bun scripts/mainnet-fixture.ts`,
    )
  }
  svm.addProgram(address(StakeProgram.programId), elf)
  return manifest
}

function loadAccountsFromDirectory(svm: LiteSVM, directory: string) {
  const files = readdirSync(directory, { recursive: true, encoding: 'utf8' })
  for (const file of files.filter(f => f.endsWith('.json'))) {
    const json = JSON.parse(
      readFileSync(join(directory, file), 'utf8'),
    ) as JsonAccount
    setAccount(svm, new PublicKey(json.pubkey), {
      lamports: Number(json.account.lamports),
      data: Buffer.from(json.account.data[0], json.account.data[1]),
      owner: new PublicKey(json.account.owner),
      executable: json.account.executable,
    })
  }
}

export function initLiteSvmTest(): {
  program: ValidatorBondsProgram
  provider: LiteSvmProvider
} {
  const svm = LiteSVM.default()
    .withFeatureSet(mainnetFeatureSet())
    .withSysvars()
    .withBuiltins()
    .withPrecompiles()
    .withLamports(BigInt(1e18))
    .withSigverify(true)
    .withBlockhashCheck(true)
  svm.setEpochSchedule(
    new EpochSchedule(SLOTS_PER_EPOCH, SLOTS_PER_EPOCH, false, 0n, 0n),
  )
  addMainnetStakeProgram(svm)
  svm.addProgramFromFile(
    address(VALIDATOR_BONDS_PROGRAM_ID),
    join(REPO_ROOT, 'target', 'deploy', 'validator_bonds.so'),
  )
  svm.addProgramFromFile(
    address(METAPLEX_PROGRAM_ID),
    join(
      REPO_ROOT,
      'fixtures',
      'programs',
      'metaplex_token_metadata_program.so',
    ),
  )
  loadAccountsFromDirectory(svm, join(REPO_ROOT, 'fixtures', 'accounts'))
  const provider = new LiteSvmProvider(svm)
  return { program: getProgram({ connection: provider }), provider }
}

export function currentEpoch(provider: LiteSvmProvider): Promise<bigint> {
  return Promise.resolve(provider.svm.getClock().epoch)
}

/**
 * Moves the clock to the first slot of `epoch` and rewrites the stake history
 * as a gap-free run ending at `epoch - 1`, the layout the stake program reads by offset.
 */
export function warpToEpoch(provider: LiteSvmProvider, epoch: bigint) {
  const { svm } = provider
  svm.warpToSlot(epoch * SLOTS_PER_EPOCH)
  const clock = svm.getClock()
  clock.epoch = epoch
  clock.leaderScheduleEpoch = epoch + 1n
  svm.setClock(clock)
  const history = new StakeHistory()
  const oldest =
    epoch > STAKE_HISTORY_MAX_ENTRIES ? epoch - STAKE_HISTORY_MAX_ENTRIES : 0n
  for (let e = oldest; e < epoch; e++) {
    history.add(
      e,
      new StakeHistoryEntry(
        CLUSTER_EFFECTIVE_STAKE,
        CLUSTER_CHANGING_STAKE,
        CLUSTER_CHANGING_STAKE,
      ),
    )
  }
  svm.setStakeHistory(history)
}

export async function warpOffsetEpoch(
  provider: LiteSvmProvider,
  plusEpochs: number,
) {
  warpToEpoch(provider, (await currentEpoch(provider)) + BigInt(plusEpochs))
}

export async function warpToNextEpoch(provider: LiteSvmProvider) {
  await warpOffsetEpoch(provider, 1)
}

export async function assertNotExist(
  provider: LiteSvmProvider,
  account: PublicKey,
) {
  expect(await provider.connection.getAccountInfo(account)).toBeNull()
}

export async function delegateAndFund({
  program,
  provider,
  lamports,
  voteAccount,
  bondAccount,
  configAccount,
}: {
  program: ValidatorBondsProgram
  provider: LiteSvmProvider
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
    const bondToCheck = checkAndGetBondAddress({
      bond: bondAccount,
      config: configAccount,
      voteAccount: voteAccountDelegated,
      programId: program.programId,
    })
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
