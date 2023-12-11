import * as anchor from '@coral-xyz/anchor'
import { AnchorProvider } from '@coral-xyz/anchor'
import {
  ValidatorBondsProgram,
  getProgram,
} from '@marinade.finance/validator-bonds-sdk'

export async function initTest(): Promise<{
  program: ValidatorBondsProgram
  provider: AnchorProvider
}> {
  if (process.env.ANCHOR_PROVIDER_URL?.includes('localhost')) {
    // workaround to: https://github.com/coral-xyz/anchor/pull/2725
    process.env.ANCHOR_PROVIDER_URL = 'http://127.0.0.1:8899'
  }
  const provider = AnchorProvider.env() as anchor.AnchorProvider
  provider.opts.skipPreflight = true
  return { program: getProgram(provider), provider }
}
