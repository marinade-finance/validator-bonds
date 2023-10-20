import * as anchor from '@coral-xyz/anchor'
import { AnchorProvider } from '@coral-xyz/anchor'
import { ValidatorBondsProgram, getProgram } from '../../src'

export async function initTest(): Promise<{
  program: ValidatorBondsProgram
  provider: AnchorProvider
}> {
  anchor.setProvider(anchor.AnchorProvider.env())
  const provider = anchor.getProvider() as anchor.AnchorProvider
  provider.opts.skipPreflight = true
  return { program: getProgram(provider), provider }
}
