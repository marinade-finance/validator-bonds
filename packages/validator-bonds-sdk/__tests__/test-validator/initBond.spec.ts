import { Keypair, PublicKey, Signer } from '@solana/web3.js'
import {
  INIT_BOND_EVENT,
  InitBondEvent,
  ValidatorBondsProgram,
  bondAddress,
  findBonds,
  findConfigs,
  getBond,
  initBondInstruction,
} from '../../src'
import { initTest } from './testValidator'
import { transaction } from '@marinade.finance/anchor-common'
import { Wallet, splitAndExecuteTx } from '@marinade.finance/web3js-common'
import { signer } from '../utils/helpers'
import { executeInitConfigInstruction } from '../utils/testTransactions'
import { ExtendedProvider } from '../utils/provider'
import { createVoteAccount } from '../utils/staking'

describe('Validator Bonds init bond', () => {
  let provider: ExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey

  beforeAll(async () => {
    ;({ provider, program } = await initTest())
  })

  afterAll(async () => {
    // Not clear behavior of the removeEventListener causes that jest fails time to time
    // with "Jest has detected the following 1 open handle potentially keeping Jest from exiting"
    // Solution 1: hard call to close the WS connection
    //   await (provider.connection as unknown as any)._rpcWebSocket.close()
    // Solution 2: wait for timeout 500 ms defined in @solana/web3.js to close the WS connection
    //  when the WS connection is only closed then
    //  see https://github.com/solana-labs/solana-web3.js/blob/v1.87.3/packages/library-legacy/src/connection.ts#L6043-L6046
    await new Promise(resolve => setTimeout(resolve, 500))
  })

  beforeEach(async () => {
    ;({ configAccount } = await executeInitConfigInstruction(program, provider))
  })

  it('init bond', async () => {
    const event = new Promise<InitBondEvent>(resolve => {
      const listener = program.addEventListener(
        INIT_BOND_EVENT,
        async event => {
          await program.removeEventListener(listener)
          resolve(event)
        }
      )
    })

    const { voteAccount: validatorVoteAccount, authorizedWithdrawer } =
      await createVoteAccount(provider)
    const bondAuthority = PublicKey.unique()
    const { instruction, bondAccount } = await initBondInstruction({
      program,
      configAccount,
      bondAuthority,
      revenueShareHundredthBps: 22,
      validatorVoteAccount,
      validatorVoteWithdrawer: authorizedWithdrawer.publicKey,
    })
    await provider.sendIx([authorizedWithdrawer], instruction)

    const bondsDataFromList = await findBonds({
      program,
      config: configAccount,
      validatorVoteAccount,
      bondAuthority,
    })
    expect(bondsDataFromList.length).toEqual(1)

    const bondData = await getBond(program, bondAccount)

    const [bondCalculatedAddress, bondBump] = bondAddress(
      configAccount,
      validatorVoteAccount,
      program.programId
    )
    expect(bondCalculatedAddress).toEqual(bondAccount)
    expect(bondData.authority).toEqual(bondAuthority)
    expect(bondData.bump).toEqual(bondBump)
    expect(bondData.config).toEqual(configAccount)
    expect(bondData.revenueShare).toEqual(22)
    expect(bondData.validatorVoteAccount).toEqual(validatorVoteAccount)

    // Ensure the event listener was called
    await event.then(e => {
      expect(e.authority).toEqual(bondAuthority)
      expect(e.bondBump).toEqual(bondBump)
      expect(e.configAddress).toEqual(configAccount)
      expect(e.revenueShare).toEqual(22)
      expect(e.validatorVoteAccount).toEqual(validatorVoteAccount)
      expect(e.validatorVoteWithdrawer).toEqual(authorizedWithdrawer.publicKey)
    })
  })

  it('find bonds', async () => {
    const adminAuthority = Keypair.generate().publicKey
    const operatorAuthority = Keypair.generate().publicKey

    const tx = await transaction(provider)
    const signers: (Signer | Wallet)[] = [provider.wallet]

    const numberOfConfigs = 17
    for (let i = 1; i <= numberOfConfigs; i++) {
      const { configAccount, instruction } = await initBondInstruction({
        program,
        adminAuthority,
        operatorAuthority,
        epochsToClaimSettlement: i,
        withdrawLockupEpochs: i + 1,
      })
      tx.add(instruction)
      signers.push(signer(configAccount))
    }
    await splitAndExecuteTx({
      connection: provider.connection,
      transaction: tx,
      signers,
      errMessage: 'Failed to init configs',
    })

    let configDataFromList = await findConfigs({ program, adminAuthority })
    expect(configDataFromList.length).toEqual(numberOfConfigs)

    configDataFromList = await findConfigs({ program, operatorAuthority })
    expect(configDataFromList.length).toEqual(numberOfConfigs)

    configDataFromList = await findConfigs({
      program,
      adminAuthority,
      operatorAuthority,
    })
    expect(configDataFromList.length).toEqual(numberOfConfigs)
  })
})
