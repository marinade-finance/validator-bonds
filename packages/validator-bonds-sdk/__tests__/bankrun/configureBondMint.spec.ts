import {
  Errors,
  ValidatorBondsProgram,
  configureBondWithMintInstruction,
  getBond,
  mintBondInstruction,
  getVoteAccount,
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
import { Keypair, PublicKey, VoteProgram } from '@solana/web3.js'
import { createVoteAccount } from '../utils/staking'
import {
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount as getTokenAccount,
  getMint,
  getAssociatedTokenAddressSync,
} from 'solana-spl-token-modern'
import { signer } from '@marinade.finance/web3js-common'
import { checkErrorMessage, verifyError } from '@marinade.finance/anchor-common'

describe('Validator Bonds mint configure bond account', () => {
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let bondAccount: PublicKey
  let validatorIdentity: Keypair
  let voteAccount: PublicKey
  let bondAuthority: Keypair
  let authorizedWithdrawer: Keypair

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
      validatorIdentityTokenAccount,
      tokenMetadataAccount,
    } = await mintBondInstruction({
      program,
      bondAccount,
      configAccount,
      validatorIdentity: validatorIdentity.publicKey,
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

  it('fail to bond mint with changed validator identity', async () => {
    const {
      instruction: ixMint,
      bondMint,
      validatorIdentityTokenAccount,
    } = await mintBondInstruction({
      program,
      bondAccount,
      configAccount,
      validatorIdentity: validatorIdentity.publicKey,
    })
    await provider.sendIx([], ixMint)
    await warpToNextEpoch(provider)
    await provider.sendIx([], ixMint)

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

    // configuration possible
    const { instruction: ixConfigure } = await configureBondWithMintInstruction(
      {
        newBondAuthority: user.publicKey,
        program,
        bondAccount,
        configAccount,
        tokenAuthority: user,
      }
    )
    let mintData = await getMint(provider.connection, bondMint)
    expect(mintData.supply).toEqual(2)
    await provider.sendIx([user], ixConfigure)
    mintData = await getMint(provider.connection, bondMint)
    expect(mintData.supply).toEqual(1)

    // minting with changed validator identity
    const validatorIdentityNew = Keypair.generate()
    const ixUpdateValidatorIdentity = VoteProgram.updateValidatorIdentity({
      votePubkey: voteAccount,
      nodePubkey: validatorIdentityNew.publicKey,
      authorizedWithdrawerPubkey: authorizedWithdrawer.publicKey,
    })
    await provider.sendIx(
      [authorizedWithdrawer, validatorIdentityNew],
      ixUpdateValidatorIdentity
    )
    expect(
      (await getVoteAccount(provider, voteAccount)).account.data.nodePubkey
    ).toEqual(validatorIdentityNew.publicKey)

    warpToNextEpoch(provider)
    try {
      await provider.sendIx([user], ixConfigure)
      throw new Error('failure expected; wrong validator identity')
    } catch (e) {
      // ConstraintSeeds = 2006,
      checkErrorMessage(e, 'custom program error: 0x7d6')
    }

    // transfer to same user but new token
    const {
      instruction: ixMintNew,
      bondMint: bondMintNew,
      validatorIdentityTokenAccount: newValidatorIdentityTokenAccount,
    } = await mintBondInstruction({
      program,
      bondAccount,
      configAccount,
      validatorIdentity: validatorIdentityNew.publicKey,
    })
    const userTokenAccountNew = getAssociatedTokenAddressSync(
      bondMintNew,
      user.publicKey
    )
    const ixCreateTokenAccountNew = createAssociatedTokenAccountInstruction(
      provider.wallet.publicKey,
      userTokenAccountNew,
      user.publicKey,
      bondMintNew
    )
    const ixTransferNew = createTransferInstruction(
      newValidatorIdentityTokenAccount,
      userTokenAccountNew,
      validatorIdentityNew.publicKey,
      1
    )
    await provider.sendIx(
      [validatorIdentityNew],
      ixMintNew,
      ixCreateTokenAccountNew,
      ixTransferNew
    )

    // the same user can configure now
    const { instruction: ixConfigureNew } =
      await configureBondWithMintInstruction({
        newCpmpe: 1,
        program,
        bondAccount,
        configAccount,
        tokenAuthority: user,
      })
    await provider.sendIx([user], ixConfigureNew)

    expect((await getBond(program, bondAccount)).cpmpe).toEqual(1)
  })

  it('fail minting for a random authority and configure with withdrawer authority', async () => {
    const randomGuy = Keypair.generate()
    const { instruction: ixMint } = await mintBondInstruction({
      program,
      bondAccount,
      configAccount,
      validatorIdentity: randomGuy.publicKey,
    })
    try {
      await provider.sendIx([], ixMint)
      throw new Error('failure expected; wrong validator identity')
    } catch (e) {
      verifyError(e, Errors, 6058, 'Validator identity mismatch for bond mint')
    }
  })

  it('fail minting for a wrong vote account', async () => {
    const randomKeypair = Keypair.generate()
    const { instruction: ixMint } = await mintBondInstruction({
      program,
      bondAccount,
      configAccount,
      validatorIdentity: validatorIdentity.publicKey,
      voteAccount: randomKeypair.publicKey,
    })
    try {
      await provider.sendIx([], ixMint)
      throw new Error('failure expected; wrong vote account seed')
    } catch (e) {
      // ConstraintSeeds = 2006,
      checkErrorMessage(e, 'custom program error: 0x7d6')
    }
  })

  it('no trouble with multiple minting', async () => {
    const { instruction: ixMint, bondMint } = await mintBondInstruction({
      program,
      bondAccount,
      configAccount,
      validatorIdentity: validatorIdentity.publicKey,
    })

    await provider.sendIx([], ixMint)
    let mintData = await getMint(provider.connection, bondMint)
    expect(mintData.supply).toEqual(1)

    await warpToNextEpoch(provider)
    await provider.sendIx([], ixMint)

    mintData = await getMint(provider.connection, bondMint)
    expect(mintData.supply).toEqual(2)
  })
})
