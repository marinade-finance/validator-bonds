import * as anchor from '@coral-xyz/anchor'
import { AnchorProvider } from '@coral-xyz/anchor'
import { ValidatorBondsProgram, getProgram } from '../../src'
import { Umi } from '@metaplex-foundation/umi'
import {createUmi} from '@metaplex-foundation/umi-bundle-defaults'
import { walletAdapterIdentity } from '@metaplex-foundation/umi-signer-wallet-adapters';
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
  
  const umiProgram = createValidatorBondsProgram()
  const umi = createUmi(provider.connection)
    .use(walletAdapterIdentity(provider.wallet, true))
  umi.programs.add(umiProgram, false)

  expect(umiProgram.publicKey.toString()).toEqual(program.programId.toString())
  
  return { program, provider, umi }
}
