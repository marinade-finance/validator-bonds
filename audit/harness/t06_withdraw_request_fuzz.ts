// `claim_withdraw_request` against the live stake program: a validator must never receive more
// than the requested amount, and whatever is not withdrawn must stay under the bonds PDA.
import { generateKeyPairSigner } from '@solana/kit'

import { Harness, SOL, U64_MAX, check, finish, section, u64, why, withdrawRequestAddress } from './lib.ts'

const RUNS = Number(process.env.RUNS ?? 150)
let seed = BigInt(process.env.SEED ?? 77)
const rnd = (): bigint => {
  seed ^= (seed << 13n) & U64_MAX
  seed ^= seed >> 7n
  seed ^= (seed << 17n) & U64_MAX
  return seed
}
const between = (lo: bigint, hi: bigint): bigint => lo + (rnd() % (hi - lo + 1n))
const pick = <T>(items: T[]): T => items[Number(rnd() % BigInt(items.length))]!

const h = await Harness.start()
const RENT = h.rentFor(200)
const failures = new Map<string, number>()
let broken = 0
let claims = 0
let splits = 0

for (let run = 0; run < RUNS; run++) {
  const identity = await h.signer()
  const vote = await h.voteAccount(identity.address)
  const bond = await h.initBond(vote)
  const request = await withdrawRequestAddress(bond)
  const requested = pick([between(1n, 3n * SOL), between(SOL, 40n * SOL), U64_MAX])
  await h.bonds(
    'init_withdraw_request',
    { bond, vote_account: vote, authority: identity, withdraw_request: request, rent_payer: h.payer },
    u64(requested),
  )
  h.warpEpochs(4n)

  const stakes: { address: string; lamports: bigint }[] = []
  for (let i = 0; i < 3; i++) {
    const delegated = between(SOL, 15n * SOL)
    const free = pick([0n, 0n, between(0n, 3n * SOL)])
    const kind = pick(['active', 'active', 'inactive'])
    const lamports = delegated + RENT + free
    const address = await h.bondStake(vote, lamports, {
      delegated,
      deactivationEpoch: kind === 'inactive' ? h.epoch - 2n : U64_MAX,
    })
    stakes.push({ address, lamports })
  }
  const bondBefore = stakes.reduce((n, s) => n + s.lamports, 0n)

  let received = 0n
  let underPda = 0n
  for (const s of stakes) {
    const split = await generateKeyPairSigner()
    const res = await h.tryBonds('claim_withdraw_request', {
      bond,
      vote_account: vote,
      authority: identity,
      withdraw_request: request,
      stake_account: s.address as never,
      withdrawer: identity.address,
      split_stake_account: split,
      split_stake_rent_payer: h.payer,
    })
    if (!res.ok) {
      const cause = why(res.logs)
      failures.set(cause, (failures.get(cause) ?? 0) + 1)
      underPda += h.lamportsOf(s.address as never)
      continue
    }
    claims++
    const out = h.stake(s.address as never)
    if (out.staker !== identity.address || out.withdrawer !== identity.address) {
      broken++
      console.log(`  BROKEN run ${run}: claimed account authorities`)
    }
    received += out.lamports
    const rest = h.stake(split.address)
    if (rest.state !== 'Closed') {
      splits++
      if (rest.staker !== h.withdrawer || rest.withdrawer !== h.withdrawer || rest.voter !== vote) {
        broken++
        console.log(`  BROKEN run ${run}: remainder left the bond`)
      }
      // the split account's own rent comes from the fee payer and stays with the bond
      underPda += rest.lamports - RENT
    }
  }
  if (received > requested) {
    broken++
    console.log(`  BROKEN run ${run}: received ${received} > requested ${requested}`)
  }
  if (received + underPda !== bondBefore) {
    broken++
    console.log(`  BROKEN run ${run}: ${received} + ${underPda} != ${bondBefore}`)
  }
}

section(`claim_withdraw_request over ${RUNS} bonds, 3 stake accounts each`)
console.log(`  ${claims} claims succeeded (${splits} with a split)`)
check('never more than requested, nothing lost, remainders stay under the PDA', broken === 0, `${broken} broken`)
section('rejections')
for (const [cause, count] of [...failures].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(4)} × ${cause}`)
}
finish()
