import {
  ValidatorBondsProgram,
  initBondInstruction,
  initConfigInstruction,
} from '../../src'
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from '@solana/web3.js'
import { pubkey, signer } from './helpers'
import { ExtendedProvider } from './provider'
import { createVoteAccount } from './staking'

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
  await provider.sendIx([], instruction)
  return user
}

export async function executeInitConfigInstruction(
  program: ValidatorBondsProgram,
  provider: ExtendedProvider,
  epochsToClaimSettlement: number = Math.floor(Math.random() * 10) + 1,
  withdrawLockupEpochs: number = Math.floor(Math.random() * 10) + 1
): Promise<{
  configAccount: PublicKey
  adminAuthority: Keypair
  operatorAuthority: Keypair
}> {
  const adminAuthority = Keypair.generate()
  const operatorAuthority = Keypair.generate()
  expect(adminAuthority).not.toEqual(operatorAuthority)

  const { configAccount, instruction } = await initConfigInstruction({
    program,
    adminAuthority: adminAuthority.publicKey,
    operatorAuthority: operatorAuthority.publicKey,
    epochsToClaimSettlement,
    withdrawLockupEpochs,
  })
  const signerConfigAccount = signer(configAccount)
  await provider.sendIx([signerConfigAccount], instruction)

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
  authorizedWithdrawer?: Keypair
): Promise<{
  bondAccount: PublicKey
  bondAuthority: Keypair
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
    revenueShareHundredthBps: 30,
    validatorVoteAccount: voteAccount,
    validatorVoteWithdrawer: authorizedWithdrawer.publicKey,
  })
  await provider.sendIx([authorizedWithdrawer], instruction)

  return {
    bondAccount,
    bondAuthority,
  }
}
