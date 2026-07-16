import { writeFileSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { CLIContext } from '@marinade.finance/cli-common'
import { NULL_LOG, setContext } from '@marinade.finance/ts-common'

import { parseSettlements } from '../src/dtoSettlements'
import {
  parseLosslessJson,
  readLargeJsonFileLossless,
} from '../src/losslessJson'

import type { StakerPayoutClaim } from '../src/dtoSettlements'

beforeAll(() => {
  setContext(new CLIContext({ logger: NULL_LOG, commandName: 'test' }))
})

// 2^53 + 1 and 2^53 + 5: JSON.parse rounds both to 9007199254740992.
const OVER_SAFE = '9007199254740993'
const OVER_SAFE_2 = '9007199254740997'

describe('parseLosslessJson', () => {
  it('preserves integers above 2^53-1 as bigint', async () => {
    const parsed = (await parseLosslessJson(
      `{"big": ${OVER_SAFE}, "small": 42, "float": 1.5, "negBig": -${OVER_SAFE_2}}`,
    )) as Record<string, unknown>
    expect(parsed.big).toBe(9007199254740993n)
    expect(parsed.small).toBe(42)
    expect(parsed.float).toBe(1.5)
    expect(parsed.negBig).toBe(-9007199254740997n)
  })

  it('keeps safe-range integers and floats as plain numbers', async () => {
    const parsed = (await parseLosslessJson(
      '{"epoch": 800, "count": 3, "pmpe": 0.35891}',
    )) as Record<string, unknown>
    expect(typeof parsed.epoch).toBe('number')
    expect(typeof parsed.count).toBe('number')
    expect(parsed.pmpe).toBeCloseTo(0.35891)
  })

  it('rejects malformed JSON', async () => {
    await expect(parseLosslessJson('{"broken": ')).rejects.toThrow()
  })
})

describe('lossless end-to-end through settlement DTOs', () => {
  const bigSettlementJson = `{
    "slot": 12345,
    "epoch": 800,
    "settlements": [
      {
        "reason": "Bidding",
        "funder": "ValidatorBond",
        "vote_account": "11111111111111111111111111111111",
        "claims_count": 1,
        "claims_amount": ${OVER_SAFE},
        "claims": [
          {
            "withdraw_authority": "11111111111111111111111111111111",
            "stake_authority": "11111111111111111111111111111111",
            "claim_amount": ${OVER_SAFE},
            "kind": "StakerPayout",
            "active_stake": ${OVER_SAFE_2},
            "activating_stake": 0,
            "stake_accounts": { "11111111111111111111111111111111": ${OVER_SAFE_2} }
          }
        ]
      }
    ]
  }`

  it('keeps lamports above 2^53-1 exact (JSON.parse would round them)', async () => {
    // Sanity: the native parser really does corrupt this value.
    const lossy = JSON.parse(bigSettlementJson) as {
      settlements: { claims_amount: number }[]
    }
    expect(BigInt(lossy.settlements[0]!.claims_amount)).not.toBe(
      9007199254740993n,
    )

    const dto = await parseSettlements(bigSettlementJson)
    const settlement = dto.settlements[0]!
    expect(settlement.claims_amount).toBe(9007199254740993n)
    const staker = settlement.claims[0] as StakerPayoutClaim
    expect(staker.claim_amount).toBe(9007199254740993n)
    expect(staker.active_stake).toBe(9007199254740997n)
    expect(staker.stake_accounts).toEqual({
      '11111111111111111111111111111111': 9007199254740997n,
    })
  })

  it('readLargeJsonFileLossless streams a file with exact big integers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lossless-'))
    const filePath = join(dir, 'big.json')
    writeFileSync(filePath, `{"claim": ${OVER_SAFE}, "epoch": 800}`)
    const parsed = (await readLargeJsonFileLossless(filePath)) as Record<
      string,
      unknown
    >
    expect(parsed.claim).toBe(9007199254740993n)
    expect(parsed.epoch).toBe(800)
  })

  it('readLargeJsonFileLossless rejects on a missing file', async () => {
    await expect(
      readLargeJsonFileLossless('/nonexistent/path/to/file.json'),
    ).rejects.toThrow()
  })
})
