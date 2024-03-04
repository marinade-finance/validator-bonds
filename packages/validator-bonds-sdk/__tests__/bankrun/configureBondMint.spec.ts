import {
  Errors,
  ValidatorBondsProgram,
  configureBondWithMintInstruction,
  getBond,
  mintBondInstruction,
} from '../../src'
import {
  BankrunExtendedProvider,
  initBankrunTest,
  warpToNextEpoch,
} from './bankrun'
import {
  createUserAndFund,
  executeInitBondInstruction,
  executeInitConfigInstruction,
} from '../utils/testTransactions'
import { Keypair, PublicKey } from '@solana/web3.js'
import { createVoteAccount } from '../utils/staking'
import {
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount as getTokenAccount,
  getMint,
  getAssociatedTokenAddressSync,
} from 'solana-spl-token-modern'
import { signer } from '@marinade.finance/web3js-common'
import { verifyError } from '@marinade.finance/anchor-common'

describe('Validator Bonds mint configure bond account', () => {
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let bondAccount: PublicKey
  let validatorIdentity: Keypair
  let authorizedWithdrawer: Keypair
  let voteAccount: PublicKey
  let bondAuthority: Keypair

  beforeAll(async () => {
    ;({ provider, program } = await initBankrunTest())
  })

  beforeEach(async () => {
    await warpToNextEpoch(provider)
    ;({ configAccount } = await executeInitConfigInstruction({
      program,
      provider,
    }))
    ;({ voteAccount, validatorIdentity, authorizedWithdrawer } =
      await createVoteAccount({
        provider,
      }))
    ;({ bondAccount, bondAuthority } = await executeInitBondInstruction({
      program,
      provider,
      configAccount,
      voteAccount,
      validatorIdentity,
    }))
  })

  it('mint and configure two times with identity bond', async () => {
    const {
      instruction: ixMint,
      bondMint,
      associatedTokenAccount: validatorIdentityTokenAccount,
      tokenMetadataAccount,
    } = await mintBondInstruction({
      program,
      bondAccount,
      configAccount,
      destinationAuthority: validatorIdentity.publicKey,
    })
    await provider.sendIx([], ixMint)

    expect(provider.connection.getAccountInfo(bondMint)).resolves.not.toBeNull()

    let validatorIdentityTokenData = await getTokenAccount(
      provider.connection,
      validatorIdentityTokenAccount
    )
    expect(validatorIdentityTokenData.amount).toEqual(1)
    expect(validatorIdentityTokenData.mint).toEqual(bondMint)
    const mintData = await getMint(provider.connection, bondMint)
    expect(mintData.supply).toEqual(1)

    expect(
      await provider.connection.getAccountInfo(tokenMetadataAccount)
    ).not.toBeNull()

    const user = signer(await createUserAndFund(provider))
    const userTokenAccount = getAssociatedTokenAddressSync(
      bondMint,
      user.publicKey
    )
    const ixCreateTokenAccount = createAssociatedTokenAccountInstruction(
      provider.wallet.publicKey,
      userTokenAccount,
      user.publicKey,
      bondMint
    )
    const ixTransfer = createTransferInstruction(
      validatorIdentityTokenAccount,
      userTokenAccount,
      validatorIdentity.publicKey,
      1
    )
    await provider.sendIx([validatorIdentity], ixCreateTokenAccount, ixTransfer)

    validatorIdentityTokenData = await getTokenAccount(
      provider.connection,
      validatorIdentityTokenAccount
    )
    expect(validatorIdentityTokenData.amount).toEqual(0)
    const userTokenData = await getTokenAccount(
      provider.connection,
      userTokenAccount
    )
    expect(userTokenData.amount).toEqual(1)

    let bondData = await getBond(program, bondAccount)
    expect(bondData.authority).toEqual(bondAuthority.publicKey)

    const { instruction: ixConfigure } = await configureBondWithMintInstruction(
      {
        newBondAuthority: user.publicKey,
        program,
        bondAccount,
        configAccount,
        tokenAuthority: user,
      }
    )
    await provider.sendIx([user], ixConfigure)

    bondData = await getBond(program, bondAccount)
    expect(bondData.authority).toEqual(user.publicKey)

    warpToNextEpoch(provider)
    await provider.sendIx([], ixMint)
    const { instruction: ixConfigure2 } =
      await configureBondWithMintInstruction({
        newBondAuthority: PublicKey.default,
        program,
        bondAccount,
        configAccount,
        tokenAuthority: validatorIdentity,
      })
    await provider.sendIx([validatorIdentity], ixConfigure2)

    bondData = await getBond(program, bondAccount)
    expect(bondData.authority).toEqual(PublicKey.default)
  })

  it('mint with withdrawer authority', async () => {
    const {
      instruction: ixMint,
      bondMint,
      associatedTokenAccount: withdrawerTokenAccount,
    } = await mintBondInstruction({
      program,
      bondAccount,
      configAccount,
      destinationAuthority: authorizedWithdrawer.publicKey,
    })
    await provider.sendIx([], ixMint)

    const withdrawerTokenData = await getTokenAccount(
      provider.connection,
      withdrawerTokenAccount
    )
    expect(withdrawerTokenData.amount).toEqual(1)
    expect(withdrawerTokenData.mint).toEqual(bondMint)

    const user = signer(await createUserAndFund(provider))
    const userTokenAccount = getAssociatedTokenAddressSync(
      bondMint,
      user.publicKey
    )
    const ixCreateTokenAccount = createAssociatedTokenAccountInstruction(
      provider.wallet.publicKey,
      userTokenAccount,
      user.publicKey,
      bondMint
    )
    const ixTransfer = createTransferInstruction(
      withdrawerTokenAccount,
      userTokenAccount,
      authorizedWithdrawer.publicKey,
      1
    )
    await provider.sendIx(
      [authorizedWithdrawer],
      ixCreateTokenAccount,
      ixTransfer
    )
  })

  it('fail minting for a random authority and configure with withdrawer authority', async () => {
    const randomGuy = Keypair.generate()
    const { instruction: ixMint } = await mintBondInstruction({
      program,
      bondAccount,
      configAccount,
      destinationAuthority: randomGuy.publicKey,
    })
    try {
      await provider.sendIx([], ixMint)
    } catch (e) {
      verifyError(e, Errors, 6058, 'Wrong bond mint')
    }
  })

  it('fail multiple minting', async () => {
    const { instruction: ixMint, bondMint } = await mintBondInstruction({
      program,
      bondAccount,
      configAccount,
      destinationAuthority: validatorIdentity.publicKey,
    })

    await provider.sendIx([], ixMint)
    const mintData = await getMint(provider.connection, bondMint)
    expect(mintData.supply).toEqual(1)

    await warpToNextEpoch(provider)
    try {
      await provider.sendIx([], ixMint)
    } catch (e) {
      verifyError(e, Errors, 6059, 'permits only a single token')
    }
  })
})
