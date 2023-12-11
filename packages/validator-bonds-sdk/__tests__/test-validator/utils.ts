import * as anchor from '@coral-xyz/anchor'
import { AnchorProvider } from '@coral-xyz/anchor'
import { ValidatorBondsProgram, getProgram } from '../../src'
import { Program as UmiProgram, Umi } from '@metaplex-foundation/umi'
import {createUmi} from '@metaplex-foundation/umi-bundle-defaults'
import NodeWallet from '@coral-xyz/anchor/dist/cjs/nodewallet'
import { web3JsRpc } from '@metaplex-foundation/umi-rpc-web3js'
import { walletAdapterIdentity } from '@metaplex-foundation/umi-signer-wallet-adapters';
import { fromWeb3JsInstruction, fromWeb3JsKeypair, fromWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters'
import { defaultProgramRepository } from '@metaplex-foundation/umi-program-repository'
import { createValidatorBondsProgram } from '@marinade.finance/validator-bonds-umi'

export async function initTest(): Promise<{
  program: ValidatorBondsProgram
  provider: AnchorProvider
  umi: Umi,
}> {
  anchor.setProvider(anchor.AnchorProvider.env())
  const provider = anchor.getProvider() as anchor.AnchorProvider
  provider.opts.skipPreflight = true
  const program = getProgram(provider)
  
  const umi = createUmi(provider.connection)
    .use(walletAdapterIdentity(provider.wallet, true))
  umi.programs.add(createValidatorBondsProgram(), false)
  
  return { program, provider, umi }
}
