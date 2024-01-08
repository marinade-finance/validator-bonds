import {
  ValidatorBondsProgram,
  cancelWithdrawRequestInstruction,
  fundBondInstruction,
  getBond,
  initBondInstruction,
  initConfigInstruction,
  initWithdrawRequestInstruction,
  withdrawerAuthority,
} from '../../src'
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  StakeProgram,
  SystemProgram,
} from '@solana/web3.js'
import { pubkey, signer } from './helpers'
import { ExtendedProvider } from './provider'
import { createVoteAccount } from './staking'
import BN from 'bn.js'
import assert from 'assert'
// import { BankrunExtendedProvider, warpToNextEpoch } from '../bankrun/bankrun'
// import { waitForStakeAccountActivation } from '../test-validator/testValidator'

export async function createUserAndFund(
  provider: ExtendedProvider,
  user: Keypair = Keypair.generate(),
  lamports = LAMPORTS_PER_SOL
): Promise<Keypair> {
  const instruction = SystemProgram.transfer({
    fromPubkey: provider.walletPubkey,
    toPubkey: user.publicKey,
    lamports,
  })
  try {
    await provider.sendIx([], instruction)
  } catch (e) {
    console.error(
      `createUserAndFund: to fund ${user.publicKey.toBase58()} with ${lamports} lamports`,
      e
    )
    throw e
  }
  return user
}

export async function executeWithdraw(
  provider: ExtendedProvider,
  stakeAccount: PublicKey,
  withdrawAuthority: Keypair,
  toPubkey?: PublicKey,
  lamports?: number
) {
  if (lamports === undefined) {
    const accountInfo = await provider.connection.getAccountInfo(stakeAccount)
    if (accountInfo === null) {
      throw new Error(
        `executeWithdraw: cannot find the stake account ${stakeAccount.toBase58()}`
      )
    }
    lamports = accountInfo.lamports
  }
  const withdrawIx = StakeProgram.withdraw({
    authorizedPubkey: withdrawAuthority.publicKey,
    stakePubkey: stakeAccount,
    lamports,
    toPubkey: toPubkey || provider.walletPubkey,
  })
  try {
    await provider.sendIx([withdrawAuthority], withdrawIx)
  } catch (e) {
    console.error(
      `executeWithdraw: withdraw ${stakeAccount.toBase58()}, ` +
        `withdrawer: ${withdrawAuthority.publicKey.toBase58()}`,
      e
    )
    throw e
  }
}

export async function executeInitConfigInstruction({
  program,
  provider,
  epochsToClaimSettlement = Math.floor(Math.random() * 10) + 1,
  withdrawLockupEpochs = Math.floor(Math.random() * 10) + 1,
  adminAuthority,
  operatorAuthority,
  configAccountKeypair,
}: {
  program: ValidatorBondsProgram
  provider: ExtendedProvider
  epochsToClaimSettlement?: number
  withdrawLockupEpochs?: number
  adminAuthority?: Keypair
  operatorAuthority?: Keypair
  configAccountKeypair?: Keypair
}): Promise<{
  configAccount: PublicKey
  adminAuthority: Keypair
  operatorAuthority: Keypair
}> {
  adminAuthority = adminAuthority || Keypair.generate()
  operatorAuthority = operatorAuthority || Keypair.generate()
  expect(adminAuthority).not.toEqual(operatorAuthority)

  const { configAccount, instruction } = await initConfigInstruction({
    program,
    configAccount: configAccountKeypair,
    admin: adminAuthority.publicKey,
    operator: operatorAuthority.publicKey,
    epochsToClaimSettlement,
    withdrawLockupEpochs,
  })
  const signerConfigAccount = signer(configAccount)
  try {
    await provider.sendIx([signerConfigAccount], instruction)
  } catch (e) {
    console.error(
      `executeInitConfigInstruction: config account ${pubkey(
        configAccount
      ).toBase58()}, ` +
        `admin: ${adminAuthority.publicKey.toBase58()}, ` +
        `operator: ${operatorAuthority.publicKey.toBase58()}`,
      e
    )
    throw e
  }

  return {
    configAccount: pubkey(configAccount),
    adminAuthority,
    operatorAuthority,
  }
}

export async function executeInitBondInstruction(
  program: ValidatorBondsProgram,
  provider: ExtendedProvider,
  config: PublicKey,
  bondAuthority?: Keypair,
  voteAccount?: PublicKey,
  validatorIdentity?: Keypair,
  revenueShareHundredthBps: BN | number = Math.floor(Math.random() * 100) + 1
): Promise<{
  bondAccount: PublicKey
  bondAuthority: Keypair
  voteAccount: PublicKey
  validatorIdentity: Keypair
}> {
  bondAuthority = bondAuthority || Keypair.generate()
  if (!voteAccount) {
    ;({ voteAccount, validatorIdentity } = await createVoteAccount(provider))
  }
  if (validatorIdentity === undefined) {
    throw new Error(
      'executeInitBondInstruction: vote account not to be created in method, requiring validatorIdentity'
    )
  }
  const { instruction, bondAccount } = await initBondInstruction({
    program,
    configAccount: config,
    bondAuthority: bondAuthority.publicKey,
    revenueShareHundredthBps,
    validatorVoteAccount: voteAccount,
    validatorIdentity: validatorIdentity.publicKey,
  })
  try {
    await provider.sendIx([validatorIdentity], instruction)
  } catch (e) {
    console.error(
      `executeInitBondInstruction: bond account ${pubkey(
        bondAccount
      ).toBase58()}, ` +
        `config: ${pubkey(config).toBase58()}, ` +
        `bondAuthority: ${pubkey(bondAuthority).toBase58()}, ` +
        `voteAccount: ${pubkey(voteAccount).toBase58()}, ` +
        `validatorIdentity: ${pubkey(validatorIdentity).toBase58()}`,
      e
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
  bondWithdrawerAuthority: PublicKey
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
      await executeInitBondInstruction(program, provider, config))
  } else {
    const bondData = await getBond(program, bondAccount)
    bondAuthority = bondData.authority
    voteAccount = bondData.validatorVoteAccount
    config = bondData.config
  }

  const [bondWithdrawerAuthority] = withdrawerAuthority(
    config,
    program.programId
  )

  const { instruction } = await fundBondInstruction({
    program,
    configAccount: config,
    bondAccount,
    validatorVoteAccount: voteAccount,
    stakeAccount,
    stakeAccountAuthority,
  })
  try {
    await provider.sendIx([stakeAccountAuthority], instruction)
  } catch (e) {
    console.error(
      `executeFundBondInstruction: bond account ${pubkey(
        bondAccount
      ).toBase58()}, ` +
        `config: ${config.toBase58()}, ` +
        `voteAccount: ${pubkey(voteAccount).toBase58()}, ` +
        `stakeAccount: ${stakeAccount.toBase58()}, ` +
        `stakeAccountAuthority: ${pubkey(
          stakeAccountAuthority.publicKey
        ).toBase58()}`,
      e
    )
    throw e
  }

  return {
    bondAccount,
    bondAuthority,
    voteAccount,
    bondWithdrawerAuthority,
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
  amount?: number
}): Promise<{
  withdrawRequest: PublicKey
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
      await executeInitBondInstruction(program, provider, configAccount))
  } else {
    const bondData = await getBond(program, bondAccount)
    bondAuthority = bondData.authority
    configAccount = configAccount || bondData.config
    voteAccount = bondData.validatorVoteAccount
  }
  assert(bondAccount)
  let authority = validatorIdentity
  if (!authority && bondAuthority && bondAuthority instanceof Keypair) {
    authority = bondAuthority as Keypair
  }
  if (authority === undefined) {
    throw new Error(
      'executeInitWithdrawRequestInstruction: bond not to be created in method, requiring validatorIdentity'
    )
  }
  const { instruction, withdrawRequest } = await initWithdrawRequestInstruction(
    {
      program,
      bondAccount,
      configAccount,
      authority: authority.publicKey,
      amount,
    }
  )
  try {
    await provider.sendIx([authority], instruction)
  } catch (e) {
    console.error(
      `executeInitWithdrawRequestInstruction: bond account ${pubkey(
        bondAccount
      ).toBase58()}, ` +
        `validatorIdentity: ${pubkey(validatorIdentity).toBase58()}`,
      e
    )
    throw e
  }
  expect(
    provider.connection.getAccountInfo(withdrawRequest)
  ).resolves.not.toBeNull()
  return {
    withdrawRequest,
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
  withdrawRequest: PublicKey
  bondAuthority: Keypair
  validatorIdentity: Keypair
  bondAccount: PublicKey
  voteAccount: PublicKey
}> {
  const {
    withdrawRequest,
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
    withdrawRequest,
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
  authority: Keypair
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
      e
    )
    throw e
  }
}
