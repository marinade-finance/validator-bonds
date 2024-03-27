import {
  CompiledInnerInstruction,
  VersionedTransactionResponse,
} from '@solana/web3.js'
import BN from 'bn.js'
import { Idl, IdlEvents, utils as anchorUtils } from '@coral-xyz/anchor'
import { ValidatorBonds, ValidatorBondsProgram } from './sdk'

// https://github.com/coral-xyz/anchor/blob/v0.29.0/lang/src/event.rs
export const EVENT_IX_TAG: BN = new BN('1d9acb512ea545e4', 'hex')

export function isEventData(buffer: Buffer): boolean {
  return buffer.subarray(0, 8).equals(EVENT_IX_TAG.toBuffer('le'))
}

export type IdlEventKeys<I extends Idl> = keyof IdlEvents<I>
export type IdlEventValues<I extends Idl> = IdlEvents<I>[keyof IdlEvents<I>]

export type ValidatorBondsEvent = {
  name: IdlEventKeys<ValidatorBonds>
  data: IdlEventValues<ValidatorBonds>
}

// https://github.com/coral-xyz/anchor/blob/v0.29.0/tests/events/tests/events.ts#L61-L62
export function parseCpiEvents(
  program: ValidatorBondsProgram,
  transactionResponse: VersionedTransactionResponse | undefined | null
): ValidatorBondsEvent[] {
  const e: ValidatorBondsEvent[] = []
  const inner: CompiledInnerInstruction[] =
    transactionResponse?.meta?.innerInstructions ?? []
  for (let i = 0; i < inner.length; i++) {
    for (let j = 0; j < inner[i].instructions.length; j++) {
      const ix = inner[i].instructions[j]
      const programPubkey =
        transactionResponse?.transaction.message.staticAccountKeys[
          ix.programIdIndex
        ]
      if (
        programPubkey === undefined ||
        !programPubkey.equals(program.programId)
      ) {
        // we are at instructions that does not match the validator bonds program
        continue
      }
      const ixData = anchorUtils.bytes.bs58.decode(ix.data)
      // working with event data and decoding it
      if (isEventData(ixData)) {
        const eventBuffer = anchorUtils.bytes.base64.encode(ixData.subarray(8))
        const eventDecoded = program.coder.events.decode(eventBuffer)
        if (eventDecoded !== null) {
          e.push({
            name: eventDecoded.name as IdlEventKeys<ValidatorBonds>,
            data: eventDecoded.data as IdlEventValues<ValidatorBonds>,
          })
        }
      }
    }
  }
  return e
}

// Define a type guard function to check if an object instance contains all properties of a given type
export function hasAllProperties<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  obj: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type: { [K in keyof T]: any }
): obj is T {
  for (const key in type) {
    if (!(key in obj)) {
      return false
    }
  }
  return true
}

/**
 * Call like:
 * `isEvent<typeof INIT_CONFIG_EVENT>(event)`
 */
export function isEvent<E extends IdlEventKeys<ValidatorBonds>>(
  event: IdlEventValues<ValidatorBonds> | undefined
): event is IdlEvents<ValidatorBonds>[E] {
  return hasAllProperties<E>(event, {} as E)
}

export function findEvent<E extends IdlEventKeys<ValidatorBonds>>(
  events: ValidatorBondsEvent[],
  eventName: E
): ValidatorBondsEvent | undefined {
  return events.find(e => e.name === eventName)
}

export function assertEvent<E extends IdlEventKeys<ValidatorBonds>>(
  events: ValidatorBondsEvent[],
  eventName: E
): IdlEvents<ValidatorBonds>[E] {
  const event = findEvent(events, eventName)?.data
  if (event === undefined) {
    throw new Error(`Event ${eventName} not found`)
  }
  if (!isEvent<E>(event)) {
    throw new Error(`Event ${eventName} is not an ${eventName}`)
  }
  return event
}
