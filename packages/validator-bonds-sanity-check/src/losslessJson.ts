/**
 * BigInt-safe JSON parsing.
 *
 * Native `JSON.parse` and `@streamparser/json`'s default tokenizer both turn
 * every numeric token into an IEEE-754 double BEFORE any DTO `@Transform`
 * runs, so integers above 2^53-1 (lamport-scale u64 values) are silently
 * rounded and `BigInt(value)` only launders the corrupted double. This module
 * parses numeric tokens from their raw source text instead: integer tokens
 * outside the double-safe range come out as `bigint`, everything else stays
 * `number` (so `epoch`, counts and float fields keep their existing typing).
 * The DTOs' `BigInt(value)` transforms accept both, making them exact.
 */
import { loadContentAsStream } from '@marinade.finance/ts-common'
import { Tokenizer, TokenParser } from '@streamparser/json'

import type { TokenizerOptions } from '@streamparser/json'

const INTEGER_TOKEN = /^-?\d+$/
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER)
const MIN_SAFE = -MAX_SAFE

/** Integer tokens beyond ±(2^53-1) become bigint; everything else a number. */
class LosslessTokenizer extends Tokenizer {
  protected override parseNumber(numberStr: string): number {
    if (INTEGER_TOKEN.test(numberStr)) {
      const big = BigInt(numberStr)
      if (big > MAX_SAFE || big < MIN_SAFE) {
        // The tokenizer contract says `number`, but the token parser and the
        // emitted values carry any JS value through untouched.
        return big as unknown as number
      }
    }
    return Number(numberStr)
  }
}

type FeedInput = string | Buffer | Uint8Array

interface LosslessParserHandle {
  write: (chunk: FeedInput) => void
  end: () => void
  fail: (err: Error) => void
  promise: Promise<unknown>
}

/**
 * Wires a `LosslessTokenizer` to a `TokenParser` the same way
 * `@streamparser/json`'s `JSONParser` does internally (the stock class offers
 * no tokenizer injection point) and collects the single root JSON value.
 */
function createLosslessParser(opts?: TokenizerOptions): LosslessParserHandle {
  const tokenizer = new LosslessTokenizer(opts)
  const tokenParser = new TokenParser({ paths: ['$'] })

  tokenizer.onToken = tokenParser.write.bind(tokenParser)
  tokenizer.onEnd = () => {
    if (!tokenParser.isEnded) tokenParser.end()
  }
  tokenParser.onError = tokenizer.error.bind(tokenizer)

  let result: unknown
  let hasValue = false
  let settled = false
  let resolvePromise: (value: unknown) => void
  let rejectPromise: (err: Error) => void
  const promise = new Promise<unknown>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })

  tokenParser.onValue = ({ value }) => {
    result = value
    hasValue = true
  }
  tokenParser.onEnd = () => {
    if (!tokenizer.isEnded) tokenizer.end()
    if (settled) return
    settled = true
    if (hasValue) {
      resolvePromise(result)
    } else {
      rejectPromise(new Error('No JSON value found in the input'))
    }
  }
  const fail = (err: Error) => {
    if (settled) return
    settled = true
    rejectPromise(err)
  }
  tokenizer.onError = fail

  return {
    write: chunk => tokenizer.write(chunk),
    end: () => {
      if (!tokenizer.isEnded) tokenizer.end()
    },
    fail,
    promise,
  }
}

/** BigInt-safe drop-in for `JSON.parse` over a whole JSON document string. */
export async function parseLosslessJson(data: string): Promise<unknown> {
  const parser = createLosslessParser()
  try {
    parser.write(data)
    parser.end()
  } catch (err) {
    parser.fail(err as Error)
  }
  return parser.promise
}

/**
 * BigInt-safe replacement for cli-common's `readLargeJsonFile`: streams the
 * file (or URL) content through the lossless tokenizer, so arbitrarily large
 * documents parse without ever holding a corrupt double.
 */
export async function readLargeJsonFileLossless(
  content: string,
): Promise<unknown> {
  const readStream = await loadContentAsStream(content)
  const parser = createLosslessParser()
  readStream.on('data', (chunk: FeedInput) => {
    try {
      parser.write(chunk)
    } catch (err) {
      readStream.destroy()
      parser.fail(err as Error)
    }
  })
  readStream.on('end', () => {
    try {
      parser.end()
    } catch (err) {
      parser.fail(err as Error)
    }
  })
  readStream.on('error', err => {
    parser.fail(err)
  })
  return parser.promise
}
