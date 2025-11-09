import assert from 'assert'

import { pubkey, signer } from '@marinade.finance/web3js-1x'
import {
  ComputeBudgetProgram,
  Keypair,
  LAMPORTS_PER_SOL,
  StakeProgram,
} from '@solana/web3.js'
import BN from 'bn.js'

import { getRandomByte, getSecureRandomInt } from './helpers'
import {
  createVoteAccount,
  createVoteAccountWithIdentity,
  retryOnEpochRewardsPeriod,
} from './staking'
import {
  cancelWithdrawRequestInstruction,
  fundBondInstruction,
  getBond,
  initBondInstruction,
  initConfigInstruction,
  initSettlementInstruction,
  initWithdrawRequestInstruction,
  bondsWithdrawerAuthority,
  configureConfigInstruction,
  initCommissionProductInstruction,
  initCustomProductInstruction,
  configureCommissionProductInstruction,
  configureCustomProductInstruction,
} from '../../src'

import type {
  ProductType,
  ProductTypeConfig,
  ValidatorBondsProgram,
} from '../../src'
import type { ExtendedProvider } from '@marinade.finance/web3js-1x'
import type { PublicKey } from '@solana/web3.js'

export async function executeWithdraw(
  provider: ExtendedProvider,
  stakeAccount: PublicKey,
  withdrawAuthority: Keypair,
  toPubkey?: PublicKey,
  lamports?: number,
) {
  if (lamports === undefined) {
    const accountInfo = await provider.connection.getAccountInfo(stakeAccount)
    if (accountInfo === null) {
      throw new Error(
        `executeWithdraw: cannot find the stake account ${stakeAccount.toBase58()}`,
      )
    }
    lamports = accountInfo.lamports
  }
  const withdrawIx = StakeProgram.withdraw({
    authorizedPubkey: withdrawAuthority.publicKey,
    stakePubkey: stakeAccount,
    lamports,
    toPubkey: toPubkey ?? provider.walletPubkey,
  })
  try {
    await provider.sendIx([withdrawAuthority], withdrawIx)
  } catch (e) {
    console.error(
      `[executeWithdraw] stake account: ${stakeAccount.toBase58()}, ` +
        `withdrawer: ${withdrawAuthority.publicKey.toBase58()}`,
      e,
    )
    throw e
  }
}

export async function executeInitConfigInstruction({
  program,
  provider,
  epochsToClaimSettlement = getSecureRandomInt(1, 10),
  slotsToStartSettlementClaiming = 0,
  withdrawLockupEpochs = getSecureRandomInt(1, 10),
  adminAuthority,
  operatorAuthority,
  configAccountKeypair,
}: {
  program: ValidatorBondsProgram
  provider: ExtendedProvider
  epochsToClaimSettlement?: number | BN | bigint
  slotsToStartSettlementClaiming?: number | BN | bigint
  withdrawLockupEpochs?: number | BN | bigint
  adminAuthority?: Keypair
  operatorAuthority?: Keypair
  configAccountKeypair?: Keypair
}): Promise<{
  configAccount: PublicKey
  adminAuthority: Keypair
  operatorAuthority: Keypair
}> {
  adminAuthority = adminAuthority ?? Keypair.generate()
  operatorAuthority = operatorAuthority ?? Keypair.generate()
  expect(adminAuthority).not.toEqual(operatorAuthority)

  const { configAccount, instruction } = await initConfigInstruction({
    program,
    configAccount: configAccountKeypair,
    admin: adminAuthority.publicKey,
    operator: operatorAuthority.publicKey,
    epochsToClaimSettlement,
    slotsToStartSettlementClaiming,
    withdrawLockupEpochs,
  })
  const signerConfigAccount = signer(configAccount)
  try {
    await provider.sendIx([signerConfigAccount], instruction)
  } catch (e) {
    console.error(
      `executeInitConfigInstruction: config account ${pubkey(
        configAccount,
      ).toBase58()}, ` +
        `admin: ${adminAuthority.publicKey.toBase58()}, ` +
        `operator: ${operatorAuthority.publicKey.toBase58()}`,
      e,
    )
    throw e
  }

  return {
    configAccount: pubkey(configAccount),
    adminAuthority,
    operatorAuthority,
  }
}

export async function executeConfigureConfigInstruction({
  program,
  provider,
  configAccount,
  adminAuthority,
  newAdmin,
  newOperator,
  newPauseAuthority,
  newEpochsToClaimSettlement,
  newSlotsToStartSettlementClaiming,
  newWithdrawLockupEpochs,
  newMinimumStakeLamports,
  newMinBondMaxStakeWanted,
}: {
  program: ValidatorBondsProgram
  provider: ExtendedProvider
  configAccount: PublicKey
  adminAuthority: Keypair
  newAdmin?: PublicKey
  newOperator?: PublicKey
  newPauseAuthority?: PublicKey
  newEpochsToClaimSettlement?: BN | number
  newSlotsToStartSettlementClaiming?: BN | number
  newWithdrawLockupEpochs?: BN | number
  newMinimumStakeLamports?: BN | number
  newMinBondMaxStakeWanted?: BN | number
}): Promise<{
  configAccount: PublicKey
}> {
  const { instruction } = await configureConfigInstruction({
    program,
    configAccount: configAccount,
    adminAuthority: adminAuthority.publicKey,
    newAdmin,
    newOperator,
    newPauseAuthority,
    newEpochsToClaimSettlement,
    newSlotsToStartSettlementClaiming,
    newWithdrawLockupEpochs,
    newMinimumStakeLamports,
    newMinBondMaxStakeWanted,
  })
  try {
    await provider.sendIx([adminAuthority], instruction)
  } catch (e) {
    console.error(
      `executeConfigureConfigInstruction: config account ${configAccount.toBase58()}, ` +
        `admin: ${adminAuthority.publicKey.toBase58()}`,
      e,
    )
    throw e
  }

  return {
    configAccount,
  }
}

export async function executeInitBondInstruction({
  program,
  provider,
  configAccount,
  bondAuthority,
  voteAccount,
  validatorIdentity,
  cpmpe = getSecureRandomInt(1, 100),
  maxStakeWanted = 0,
}: {
  program: ValidatorBondsProgram
  provider: ExtendedProvider
  configAccount: PublicKey
  bondAuthority?: Keypair
  voteAccount?: PublicKey
  validatorIdentity?: Keypair
  cpmpe?: BN | number
  maxStakeWanted?: BN | number
}): Promise<{
  bondAccount: PublicKey
  bondAuthority: Keypair
  voteAccount: PublicKey
  validatorIdentity: Keypair | undefined
}> {
  bondAuthority = bondAuthority ?? Keypair.generate()
  if (!voteAccount) {
    if (validatorIdentity !== undefined) {
      ;({ voteAccount } = await createVoteAccountWithIdentity(
        provider,
        validatorIdentity,
      ))
    } else {
      ;({ validatorIdentity, voteAccount } = await createVoteAccount({
        provider,
      }))
    }
  }
  const { instruction, bondAccount } = await initBondInstruction({
    program,
    configAccount: configAccount,
    bondAuthority: bondAuthority.publicKey,
    cpmpe,
    voteAccount,
    validatorIdentity: validatorIdentity?.publicKey,
    maxStakeWanted,
  })
  try {
    await provider.sendIx(
      validatorIdentity ? [validatorIdentity] : [],
      instruction,
    )
    expect(await provider.connection.getAccountInfo(bondAccount)).not.toBeNull()
  } catch (e) {
    console.error(
      `executeInitBondInstruction: bond account ${pubkey(
        bondAccount,
      ).toBase58()}, ` +
        `config: ${pubkey(configAccount).toBase58()}, ` +
        `bondAuthority: ${pubkey(bondAuthority).toBase58()}, ` +
        `voteAccount: ${pubkey(voteAccount).toBase58()}, ` +
        `validatorIdentity: ${pubkey(validatorIdentity).toBase58()}`,
      e,
    )
    throw e
  }

  return {
    bondAccount,
    bondAuthority,
    voteAccount,
    validatorIdentity,
  }
}

export async function executeFundBondInstruction({
  program,
  provider,
  bondAccount,
  config,
  stakeAccount,
  stakeAccountAuthority,
}: {
  program: ValidatorBondsProgram
  provider: ExtendedProvider
  bondAccount?: PublicKey
  config?: PublicKey
  stakeAccount: PublicKey
  stakeAccountAuthority: Keypair
}): Promise<{
  bondAccount: PublicKey
  bondAuthority: Keypair | PublicKey
  voteAccount: PublicKey
  bondWithdrawerAuth: PublicKey
}> {
  let bondAuthority: Keypair | PublicKey
  let voteAccount: PublicKey
  if (!bondAccount) {
    if (!config) {
      ;({ configAccount: config } = await executeInitConfigInstruction({
        program,
        provider,
      }))
    }
    ;({ bondAccount, bondAuthority, voteAccount } =
      await executeInitBondInstruction({
        program,
        provider,
        configAccount: config,
      }))
  } else {
    const bondData = await getBond(program, bondAccount)
    bondAuthority = bondData.authority
    voteAccount = bondData.voteAccount
    config = bondData.config
  }

  const [bondWithdrawerAuth] = bondsWithdrawerAuthority(
    config,
    program.programId,
  )

  const { instruction } = await fundBondInstruction({
    program,
    configAccount: config,
    bondAccount,
    voteAccount: voteAccount,
    stakeAccount,
    stakeAccountAuthority,
  })
  try {
    await retryOnEpochRewardsPeriod(() =>
      provider.sendIx([stakeAccountAuthority], instruction),
    )
  } catch (e) {
    console.error(
      `executeFundBondInstruction: bond account ${pubkey(
        bondAccount,
      ).toBase58()}, ` +
        `config: ${config.toBase58()}, ` +
        `voteAccount: ${pubkey(voteAccount).toBase58()}, ` +
        `stakeAccount: ${stakeAccount.toBase58()}, ` +
        `stakeAccountAuthority: ${pubkey(
          stakeAccountAuthority.publicKey,
        ).toBase58()}`,
      e,
    )
    throw e
  }

  return {
    bondAccount,
    bondAuthority,
    voteAccount,
    bondWithdrawerAuth,
  }
}

export async function executeInitWithdrawRequestInstruction({
  program,
  provider,
  bondAccount,
  configAccount,
  validatorIdentity,
  amount = LAMPORTS_PER_SOL,
}: {
  program: ValidatorBondsProgram
  provider: ExtendedProvider
  bondAccount?: PublicKey
  configAccount?: PublicKey
  validatorIdentity?: Keypair
  amount?: number | BN
}): Promise<{
  withdrawRequestAccount: PublicKey
  validatorIdentity?: Keypair
  configAccount: PublicKey
  bondAccount: PublicKey
  bondAuthority: PublicKey | Keypair
  voteAccount: PublicKey
}> {
  let bondAuthority: Keypair | PublicKey
  let voteAccount: PublicKey
  if (bondAccount === undefined) {
    if (configAccount === undefined) {
      ;({ configAccount } = await executeInitConfigInstruction({
        program,
        provider,
      }))
    }
    ;({ bondAccount, validatorIdentity, bondAuthority, voteAccount } =
      await executeInitBondInstruction({
        program,
        provider,
        configAccount: configAccount,
      }))
  } else {
    const bondData = await getBond(program, bondAccount)
    bondAuthority = bondData.authority
    configAccount = configAccount ?? bondData.config
    voteAccount = bondData.voteAccount
  }
  assert(bondAccount)
  let authority = validatorIdentity
  if (!authority && bondAuthority && bondAuthority instanceof Keypair) {
    authority = bondAuthority
  }
  if (authority === undefined) {
    throw new Error(
      'executeInitWithdrawRequestInstruction: bond not to be created in method, requiring validatorIdentity',
    )
  }
  const { instruction, withdrawRequestAccount } =
    await initWithdrawRequestInstruction({
      program,
      bondAccount,
      configAccount,
      authority: authority.publicKey,
      amount,
    })
  try {
    await provider.sendIx([authority], instruction)
  } catch (e) {
    console.error(
      `executeInitWithdrawRequestInstruction: bond account ${pubkey(
        bondAccount,
      ).toBase58()}, ` +
        `validatorIdentity: ${pubkey(validatorIdentity).toBase58()}`,
      e,
    )
    throw e
  }
  expect(
    await provider.connection.getAccountInfo(withdrawRequestAccount),
  ).not.toBeNull()
  return {
    withdrawRequestAccount,
    bondAccount,
    validatorIdentity,
    bondAuthority,
    configAccount,
    voteAccount,
  }
}

export async function executeNewWithdrawRequest({
  program,
  provider,
  configAccount,
  amount,
}: {
  program: ValidatorBondsProgram
  provider: ExtendedProvider
  configAccount: PublicKey
  amount?: number
}): Promise<{
  withdrawRequestAccount: PublicKey
  bondAuthority: Keypair
  validatorIdentity: Keypair
  bondAccount: PublicKey
  voteAccount: PublicKey
}> {
  const {
    withdrawRequestAccount,
    bondAuthority,
    validatorIdentity,
    bondAccount,
    voteAccount,
  } = await executeInitWithdrawRequestInstruction({
    program,
    provider,
    configAccount,
    amount,
  })
  if (!(bondAuthority instanceof Keypair)) {
    throw new Error('Expected bond authority to be a keypair')
  }
  if (!(validatorIdentity instanceof Keypair)) {
    throw new Error('Expected validator identity to be a keypair')
  }
  return {
    withdrawRequestAccount,
    bondAuthority,
    validatorIdentity,
    bondAccount,
    voteAccount,
  }
}

export async function executeCancelWithdrawRequestInstruction(
  program: ValidatorBondsProgram,
  provider: ExtendedProvider,
  withdrawRequest: PublicKey,
  authority: Keypair,
) {
  const { instruction } = await cancelWithdrawRequestInstruction({
    program,
    withdrawRequestAccount: withdrawRequest,
    authority: authority.publicKey,
  })
  try {
    await provider.sendIx([authority], instruction)
  } catch (e) {
    console.error(
      `executeCancelWithdrawRequest: withdraw request account ${withdrawRequest.toBase58()}, ` +
        `authority: ${pubkey(authority).toBase58()}`,
      e,
    )
    throw e
  }
}

export async function executeInitSettlement({
  program,
  provider,
  configAccount,
  bondAccount,
  voteAccount,
  operatorAuthority,
  currentEpoch,
  merkleRoot = Buffer.from(Array.from({ length: 32 }, () => getRandomByte())),
  rentCollector = Keypair.generate().publicKey,
  maxMerkleNodes = getSecureRandomInt(1, 100),
  maxTotalClaim = getSecureRandomInt(1, 100),
}: {
  program: ValidatorBondsProgram
  provider: ExtendedProvider
  configAccount: PublicKey
  voteAccount?: PublicKey
  bondAccount?: PublicKey
  operatorAuthority: Keypair
  currentEpoch?: number | BN | bigint
  rentCollector?: PublicKey
  merkleRoot?: number[] | Uint8Array | Buffer
  maxMerkleNodes?: number | BN
  maxTotalClaim?: number | BN
}): Promise<{
  settlementAccount: PublicKey
  settlementClaimsAccount: PublicKey
  epoch: BN
  rentCollector: PublicKey
  merkleRoot: number[] | Uint8Array | Buffer
  maxMerkleNodes: BN
  maxTotalClaim: BN
}> {
  const {
    instruction,
    settlementAccount,
    settlementClaimsAccount,
    epoch: settlementEpoch,
  } = await initSettlementInstruction({
    program,
    configAccount: configAccount,
    operatorAuthority,
    merkleRoot,
    maxMerkleNodes,
    maxTotalClaim,
    voteAccount,
    bondAccount,
    epoch: currentEpoch,
    rentCollector,
  })
  await provider.sendIx([operatorAuthority], instruction)
  expect(
    await provider.connection.getAccountInfo(settlementAccount),
  ).not.toBeNull()
  return {
    settlementAccount,
    settlementClaimsAccount,
    epoch: settlementEpoch,
    rentCollector,
    merkleRoot,
    maxMerkleNodes: new BN(maxMerkleNodes),
    maxTotalClaim: new BN(maxTotalClaim),
  }
}

export async function executeInitCommissionProductInstruction({
  program,
  provider,
  bondAccount,
  configAccount,
  voteAccount,
  authority,
  rentPayer,
  inflationBps,
  mevBps,
  blockBps,
  uniformBps,
}: {
  program: ValidatorBondsProgram
  provider: ExtendedProvider
  bondAccount?: PublicKey
  configAccount?: PublicKey
  voteAccount?: PublicKey
  authority?: Keypair
  rentPayer?: Keypair
  inflationBps?: BN | number | null
  mevBps?: BN | number | null
  blockBps?: BN | number | null
  uniformBps?: BN | number | null
}): Promise<{
  bondProduct: PublicKey
  bondAccount: PublicKey
  productType: ProductType
  configData: ProductTypeConfig
}> {
  let bondAccountResolved = bondAccount
  if (!bondAccountResolved) {
    const result = await executeInitBondInstruction({
      program,
      provider,
      configAccount: configAccount!,
    })
    bondAccountResolved = result.bondAccount
  }

  const { instruction, bondProduct, configData, productType } =
    await initCommissionProductInstruction({
      program,
      bondAccount: bondAccountResolved,
      configAccount,
      voteAccount,
      authority: authority?.publicKey,
      rentPayer: rentPayer?.publicKey,
      inflationBps,
      mevBps,
      blockBps,
      uniformBps,
    })

  try {
    const signers = []
    if (authority) signers.push(authority)
    if (rentPayer) signers.push(rentPayer)
    await provider.sendIx(signers, instruction)
    expect(await provider.connection.getAccountInfo(bondProduct)).not.toBeNull()
  } catch (e) {
    console.error(
      `executeInitCommissionProductInstruction: bond product ${bondProduct.toBase58()}, ` +
        `bond: ${bondAccountResolved.toBase58()}`,
      e,
    )
    throw e
  }

  return {
    bondProduct,
    bondAccount: bondAccountResolved,
    productType,
    configData,
  }
}

export async function executeInitCustomProductInstruction({
  program,
  provider,
  bondAccount,
  configAccount,
  voteAccount,
  authority,
  rentPayer,
  customName,
  customProductData,
}: {
  program: ValidatorBondsProgram
  provider: ExtendedProvider
  bondAccount?: PublicKey
  configAccount?: PublicKey
  voteAccount?: PublicKey
  authority?: Keypair
  rentPayer?: Keypair
  customName: string
  customProductData: Buffer | Uint8Array | number[]
}): Promise<{
  bondProduct: PublicKey
  bondAccount: PublicKey
  productType: ProductType
  configData: ProductTypeConfig
}> {
  let bondAccountResolved = bondAccount
  if (!bondAccountResolved) {
    const result = await executeInitBondInstruction({
      program,
      provider,
      configAccount: configAccount!,
    })
    bondAccountResolved = result.bondAccount
  }

  const { instruction, bondProduct, configData, productType } =
    await initCustomProductInstruction({
      program,
      bondAccount: bondAccountResolved,
      configAccount,
      voteAccount,
      authority: authority?.publicKey,
      rentPayer: rentPayer?.publicKey,
      customName,
      customProductData,
    })

  try {
    const signers = []
    if (authority) signers.push(authority)
    if (rentPayer) signers.push(rentPayer)
    await provider.sendIx(signers, instruction)
    expect(await provider.connection.getAccountInfo(bondProduct)).not.toBeNull()
  } catch (e) {
    console.error(
      `executeInitCustomProductInstruction: bond product ${bondProduct.toBase58()}, ` +
        `bond: ${bondAccountResolved.toBase58()}`,
      e,
    )
    throw e
  }

  return {
    bondProduct,
    bondAccount: bondAccountResolved,
    productType,
    configData,
  }
}

export async function executeConfigureCommissionProductInstruction({
  program,
  provider,
  bondProductAccount,
  bondAccount,
  configAccount,
  voteAccount,
  authority,
  inflationBps,
  mevBps,
  blockBps,
  uniformBps, // when setting 'null' it removes uniformBps
}: {
  program: ValidatorBondsProgram
  provider: ExtendedProvider
  bondProductAccount?: PublicKey
  bondAccount?: PublicKey
  configAccount?: PublicKey
  voteAccount?: PublicKey
  authority?: Keypair
  inflationBps?: BN | number | null
  mevBps?: BN | number | null
  blockBps?: BN | number | null
  uniformBps?: BN | number | null
}): Promise<{
  bondProduct: PublicKey
  productType: ProductType
  configData: ProductTypeConfig
}> {
  const { instruction, bondProduct, configData, productType } =
    await configureCommissionProductInstruction({
      program,
      bondProductAccount,
      bondAccount,
      configAccount,
      voteAccount,
      authority: authority?.publicKey,
      inflationBps,
      mevBps,
      blockBps,
      uniformBps,
    })

  try {
    const signers = authority ? [authority] : []
    await provider.sendIx(signers, instruction)
  } catch (e) {
    console.error(
      `executeConfigureCommissionProductInstruction: bond product ${bondProduct.toBase58()}`,
      e,
    )
    throw e
  }

  return {
    bondProduct,
    productType,
    configData,
  }
}

export async function executeConfigureCustomProductInstruction({
  program,
  provider,
  bondProductAccount,
  bondAccount,
  configAccount,
  voteAccount,
  authority,
  customProductData,
}: {
  program: ValidatorBondsProgram
  provider: ExtendedProvider
  bondProductAccount?: PublicKey
  bondAccount?: PublicKey
  configAccount?: PublicKey
  voteAccount?: PublicKey
  authority?: Keypair
  customProductData: Buffer | Uint8Array | number[]
}): Promise<{
  bondProduct: PublicKey
  productType: ProductType
  configData: ProductTypeConfig
}> {
  const { instruction, bondProduct, configData, productType } =
    await configureCustomProductInstruction({
      program,
      bondProductAccount,
      bondAccount,
      configAccount,
      voteAccount,
      authority: authority?.publicKey,
      customProductData,
    })

  try {
    const signers = authority ? [authority] : []
    await provider.sendIx(signers, instruction)
  } catch (e) {
    console.error(
      `executeConfigureCustomProductInstruction: bond product ${bondProduct.toBase58()}`,
      e,
    )
    throw e
  }

  return {
    bondProduct,
    productType,
    configData,
  }
}

export const computeUnitIx = ComputeBudgetProgram.setComputeUnitLimit({
  units: 1_500_000,
})
