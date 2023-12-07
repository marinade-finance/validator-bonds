import { deserializeUnchecked } from 'borsh'
import {
  StakeState,
  STAKE_STATE_BORSH_SCHEMA,
} from '@marinade.finance/marinade-ts-sdk/dist/src/marinade-state/borsh/stake-state'
import * as BufferLayout from '@solana/buffer-layout'
import {
  PublicKey,
  StakeProgram,
  TransactionInstruction,
} from '@solana/web3.js'
import {
  IInstructionInputData,
  InstructionType,
  encodeData,
} from '@solana/web3.js/src/instruction'
import * as Layout from '@solana/web3.js/src/layout'
import { toBuffer } from '@solana/web3.js/src/utils/to-buffer'

// Depending if new vote account feature-set is gated on.
// It can be 3762 or 3736
// https://github.com/solana-labs/solana-web3.js/blob/v1.87.6/packages/library-legacy/src/programs/vote.ts#L372
// It may emit error:
//  Failed to process transaction: transport transaction error: Error processing Instruction 1: invalid account data for instruction
export const VOTE_ACCOUNT_SIZE = 3762

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

/**
 * SetLockup stake instruction params
 *
 *  - If a lockup is not active, the withdraw authority or custodian may set a new lockup
 *  - If a lockup is active, the lockup custodian may update the lockup parameters
 */
export type SetLockupStakeParams = {
  stakePubkey: PublicKey
  authorizedPubkey: PublicKey
  unixTimestamp?: number
  epoch?: number
  custodian?: PublicKey
}

export function setLockup(
  params: SetLockupStakeParams
): TransactionInstruction {
  const { stakePubkey, authorizedPubkey, unixTimestamp, epoch, custodian } =
    params

  const keys = [
    // Initialized stake account
    { pubkey: stakePubkey, isSigner: false, isWritable: true },
    //  Lockup authority or withdraw authority
    { pubkey: authorizedPubkey, isSigner: true, isWritable: false },
  ]

  const instructionIndex = 6
  const instructionBuf = Buffer.alloc(4)
  instructionBuf.writeUInt32LE(instructionIndex, 0)
  let timestampBuf = Buffer.from([0])
  if (unixTimestamp) {
    timestampBuf = Buffer.alloc(9)
    timestampBuf.writeUInt8(1, 0)
    timestampBuf.writeBigInt64LE(BigInt(unixTimestamp), 1)
  }
  let epochBuf = Buffer.from([0])
  if (epoch) {
    epochBuf = Buffer.alloc(9)
    epochBuf.writeUInt8(1, 0)
    epochBuf.writeBigInt64LE(BigInt(epoch), 1)
  }
  let custodianBuf = Buffer.from([0])
  if (custodian) {
    custodianBuf = Buffer.alloc(33)
    custodianBuf.writeUInt8(1, 0)
    custodianBuf.set(custodian.toBuffer(), 1)
  }

  const instructionData = {
    keys,
    programId: StakeProgram.programId,
    data: Buffer.from([
      ...instructionBuf,
      ...timestampBuf,
      ...epochBuf,
      ...custodianBuf,
    ]),
  }
  return new TransactionInstruction(instructionData)
}
