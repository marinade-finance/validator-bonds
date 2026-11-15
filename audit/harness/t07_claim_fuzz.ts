// Random settlements end to end: several leaves, several funded accounts, random merges and
// lamport donations, claims in random order, then close and reset.
// Invariants: every leaf is paid at most once and exactly its amount, the total never exceeds
// `max_total_claim`, and the bond's stake shrinks by exactly what claimants received (plus the
// split rent that was lent by the fee payer).
import { Harness, SOL, U64_MAX, check, finish, section, transferIx, why } from './lib.ts'

import type { Address } from '@solana/kit'

const RUNS = Number(process.env.RUNS ?? 60)
let seed = BigInt(process.env.SEED ?? 4242)
const rnd = (): bigint => {
  seed ^= (seed << 13n) & U64_MAX
  seed ^= seed >> 7n
  seed ^= (seed << 17n) & U64_MAX
  return seed
}
const between = (lo: bigint, hi: bigint): bigint => lo + (rnd() % (hi - lo + 1n))
const chance = (percent: bigint): boolean => rnd() % 100n < percent

const h = await Harness.start()
const RENT = h.rentFor(200)
const donor = await h.signer()
let broken = 0
let paidLeaves = 0
let overFunded = 0
const rejections = new Map<string, number>()
const fail = (run: number, what: string) => {
  broken++
  console.log(`  BROKEN run ${run}: ${what}`)
}

for (let run = 0; run < RUNS; run++) {
  const identity = await h.signer()
  const vote = await h.voteAccount(identity.address)
  const bond = await h.initBond(vote)

  const leafCount = Number(between(1n, 6n))
  const claimants = []
  const leaves = []
  for (let i = 0; i < leafCount; i++) {
    const c = await h.signer()
    claimants.push(c)
    leaves.push({ staker: c.address, withdrawer: c.address, claim: between(1n, 4n * SOL), index: BigInt(i) })
  }
  const total = leaves.reduce((n, l) => n + l.claim, 0n)
  const s = await h.initSettlement(bond, leaves)

  // bond stake: sometimes enough, sometimes not
  const stakes: Address[] = []
  const stakeCount = Number(between(1n, 4n))
  for (let i = 0; i < stakeCount; i++) {
    stakes.push(await h.bondStake(vote, between(11n * (SOL / 10n), 6n * SOL) + RENT))
  }
  const all = new Set<Address>(stakes)
  const bondBefore = stakes.reduce((n, a) => n + h.lamportsOf(a), 0n)

  const fundedAccounts: Address[] = []
  let splitRent = 0n
  for (const stake of stakes) {
    const { ix, split } = await h.fundSettlementIx(bond, vote, s.settlement, stake)
    const res = await h.trySend([ix])
    if (!res.ok) {
      rejections.set(`fund: ${why(res.logs)}`, (rejections.get(`fund: ${why(res.logs)}`) ?? 0) + 1)
      continue
    }
    if (h.stake(stake).staker === s.staker) fundedAccounts.push(stake)
    if (h.stake(split).state !== 'Closed') {
      all.add(split)
      splitRent += RENT
    }
  }
  if (h.settlement(s.settlement)!.lamportsFunded > total) overFunded++
  h.warpEpochs(1n)

  let donated = 0n
  // permissionless noise: merge funded accounts, send lamports into them
  let live = [...fundedAccounts]
  while (live.length > 1 && chance(50n)) {
    const source = live.pop()!
    const res = await h.trySend([await h.mergeIx(source, live[0]!, s.staker, s.settlement)])
    if (!res.ok) fail(run, `merge of funded accounts: ${why(res.logs)}`)
  }
  for (const account of live) {
    if (chance(30n)) {
      const amount = between(1n, 3n * SOL)
      await h.send([transferIx(donor, account, amount)])
      donated += amount
    }
  }

  // claims in random order, each leaf tried against every funded account, twice
  const order = leaves.map((_, i) => i).sort(() => (chance(50n) ? 1 : -1))
  const targets = new Map<number, Address>()
  const paid = new Map<number, bigint>()
  for (const attempt of [0, 1]) {
    for (const i of order) {
      const leaf = leaves[i]!
      if (!targets.has(i)) {
        targets.set(i, await h.putStake({ lamports: 2n * SOL, staker: leaf.staker, withdrawer: leaf.withdrawer, voter: vote }))
      }
      const to = targets.get(i)!
      for (const from of live) {
        if (h.stake(from).state === 'Closed') continue
        const before = h.lamportsOf(to)
        const res = await h.trySend([await h.claimIx(bond, s, i, from, to)])
        if (!res.ok) {
          const cause = `claim: ${why(res.logs)}`
          rejections.set(cause, (rejections.get(cause) ?? 0) + 1)
          continue
        }
        const got = h.lamportsOf(to) - before
        if (got !== leaf.claim) fail(run, `leaf ${i} paid ${got}, not ${leaf.claim}`)
        if (paid.has(i)) fail(run, `leaf ${i} paid twice (attempt ${attempt})`)
        paid.set(i, got)
        paidLeaves++
      }
    }
  }
  const paidTotal = [...paid.values()].reduce((n, v) => n + v, 0n)
  const state = h.settlement(s.settlement)!
  if (state.lamportsClaimed !== paidTotal) fail(run, `lamports_claimed ${state.lamportsClaimed} != paid ${paidTotal}`)
  if (paidTotal > state.maxTotalClaim) fail(run, `paid ${paidTotal} above max_total_claim`)
  if (state.merkleNodesClaimed !== BigInt(paid.size)) fail(run, 'merkle_nodes_claimed')

  // expire, close, reset; everything left must be back under the bonds PDA
  h.warpEpochs(4n)
  const refund = live.find(a => h.stake(a).state !== 'Closed') ?? stakes[0]!
  const close = await h.tryBonds('close_settlement_v2', {
    bond,
    settlement: s.settlement,
    settlement_claims: s.claims,
    rent_collector: h.payer.address,
    split_rent_collector: h.payer.address,
    split_rent_refund_account: refund,
  })
  if (!close.ok) {
    rejections.set(`close: ${why(close.logs)}`, (rejections.get(`close: ${why(close.logs)}`) ?? 0) + 1)
    continue
  }
  let bondAfter = 0n
  for (const account of all) {
    const view = h.stake(account)
    if (view.state === 'Closed') continue
    if (view.staker === s.staker) {
      const reset = await h.tryBonds('reset_stake', { bond, settlement: s.settlement, stake_account: account, vote_account: vote })
      if (!reset.ok) fail(run, `reset_stake: ${why(reset.logs)}`)
    }
    const after = h.stake(account)
    if (after.staker !== h.withdrawer || after.withdrawer !== h.withdrawer) fail(run, 'stake not back under the PDA')
    bondAfter += after.lamports
  }
  // the fee payer lent the split rent and was repaid at close, so it nets out
  if (bondAfter !== bondBefore + donated - paidTotal) {
    fail(run, `bond ${bondBefore} + donated ${donated} - paid ${paidTotal} != ${bondAfter} (split rent ${splitRent})`)
  }
}

section(`${RUNS} random settlements`)
console.log(`  ${paidLeaves} leaves paid; ${overFunded} settlements funded above their total`)
check('claim, close and reset keep every invariant', broken === 0, `${broken} broken`)
section('rejections')
for (const [cause, count] of [...rejections].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(4)} × ${cause}`)
}
finish()
