import { deserializeUnchecked } from 'borsh'
import {
  StakeState,
  STAKE_STATE_BORSH_SCHEMA,
} from '@marinade.finance/marinade-ts-sdk/dist/src/marinade-state/borsh/stake-state'

// borrowed from https://github.com/marinade-finance/marinade-ts-sdk/blob/v5.0.6/src/marinade-state/marinade-state.ts#L234
export function deserializeStakeState(data: Buffer): StakeState {
  // The data's first 4 bytes are: u8 0x0 0x0 0x0 but borsh uses only the first byte to find the enum's value index.
  // The next 3 bytes are unused and we need to get rid of them (or somehow fix the BORSH schema?)
  const adjustedData = Buffer.concat([
    data.subarray(0, 1), // the first byte indexing the enum
    data.subarray(4, data.length), // the first byte indexing the enum
  ])
  return deserializeUnchecked(
    STAKE_STATE_BORSH_SCHEMA,
    StakeState,
    adjustedData
  )
}
