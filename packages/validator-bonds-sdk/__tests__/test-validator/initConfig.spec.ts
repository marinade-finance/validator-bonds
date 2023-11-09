import { Keypair, Signer } from '@solana/web3.js'
import {
  INIT_CONFIG_EVENT,
  InitConfigEvent,
  ValidatorBondsProgram,
  findConfigs,
  getConfig,
  initConfigInstruction,
} from '../../src'
import { AnchorProvider } from '@coral-xyz/anchor'
import { initTest } from './utils'
import { transaction } from '@marinade.finance/anchor-common'
import {
  Wallet,
  executeTxSimple,
  splitAndExecuteTx,
} from '@marinade.finance/web3js-common'

describe('Validator Bonds config account tests', () => {
  let provider: AnchorProvider
  let program: ValidatorBondsProgram

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-extra-semi
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

  it('init config', async () => {
    const adminAuthority = Keypair.generate().publicKey
    const operatorAuthority = Keypair.generate().publicKey
    expect(adminAuthority).not.toEqual(operatorAuthority)

    const event = new Promise<InitConfigEvent>(resolve => {
      const listener = program.addEventListener(
        INIT_CONFIG_EVENT,
        async event => {
          await program.removeEventListener(listener)
          resolve(event)
        }
      )
    })

    const tx = await transaction(provider)

    const { keypair, instruction } = await initConfigInstruction({
      program,
      adminAuthority,
      operatorAuthority,
      epochsToClaimSettlement: 1,
      withdrawLockupEpochs: 2,
    })
    tx.add(instruction)
    await executeTxSimple(provider.connection, tx, [provider.wallet, keypair!])

    // Ensure the account was created
    const configAccountAddress = keypair!.publicKey
    const configData = await getConfig(program, configAccountAddress)

    const configDataFromList = await findConfigs({ program, adminAuthority })
    expect(configDataFromList.length).toEqual(1)

    expect(configData.adminAuthority).toEqual(adminAuthority)
    expect(configData.operatorAuthority).toEqual(operatorAuthority)
    expect(configData.epochsToClaimSettlement).toEqual(1)
    expect(configData.withdrawLockupEpochs).toEqual(2)

    // Ensure the event listener was called
    await event.then(e => {
      expect(e.adminAuthority).toEqual(adminAuthority)
      expect(e.operatorAuthority).toEqual(operatorAuthority)
      expect(e.epochsToClaimSettlement).toEqual(1)
      expect(e.withdrawLockupEpochs).toEqual(2)
    })
  })

  it('find configs', async () => {
    const adminAuthority = Keypair.generate().publicKey
    const operatorAuthority = Keypair.generate().publicKey

    const tx = await transaction(provider)
    const signers: (Signer | Wallet)[] = [provider.wallet]

    const numberOfConfigs = 17
    for (let i = 1; i <= numberOfConfigs; i++) {
      const { keypair, instruction } = await initConfigInstruction({
        program,
        adminAuthority,
        operatorAuthority,
        epochsToClaimSettlement: i,
        withdrawLockupEpochs: i + 1,
      })
      tx.add(instruction)
      signers.push(keypair!)
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
