import {
  ValidatorBondsProgram,
  initBondInstruction,
  initConfigInstruction,
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
}: {
  program: ValidatorBondsProgram
  provider: ExtendedProvider
  epochsToClaimSettlement?: number
  withdrawLockupEpochs?: number
  adminAuthority?: Keypair
  operatorAuthority?: Keypair
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
  authorizedWithdrawer?: Keypair,
  revenueShareHundredthBps: BN | number = Math.floor(Math.random() * 100) + 1
): Promise<{
  bondAccount: PublicKey
  bondAuthority: Keypair
  voteAccount: PublicKey
  authorizedWithdrawer: Keypair
}> {
  bondAuthority = bondAuthority || Keypair.generate()
  if (!voteAccount) {
    ;({ voteAccount, authorizedWithdrawer } = await createVoteAccount(provider))
  }
  if (authorizedWithdrawer === undefined) {
    throw new Error('authorizedWithdrawer is undefined')
  }
  const { instruction, bondAccount } = await initBondInstruction({
    program,
    configAccount: config,
    bondAuthority: bondAuthority.publicKey,
    revenueShareHundredthBps,
    validatorVoteAccount: voteAccount,
    validatorVoteWithdrawer: authorizedWithdrawer.publicKey,
  })
  try {
    await provider.sendIx([authorizedWithdrawer], instruction)
  } catch (e) {
    console.error(
      `executeInitBondInstruction: bond account ${pubkey(
        bondAccount
      ).toBase58()}, ` +
        `config: ${pubkey(config).toBase58()}, ` +
        `bondAuthority: ${pubkey(bondAuthority.publicKey).toBase58()}, ` +
        `voteAccount: ${pubkey(voteAccount).toBase58()}, ` +
        `authorizedWithdrawer: ${pubkey(
          authorizedWithdrawer.publicKey
        ).toBase58()}`,
      e
    )
    throw e
  }

  return {
    bondAccount,
    bondAuthority,
    voteAccount,
    authorizedWithdrawer,
  }
}
