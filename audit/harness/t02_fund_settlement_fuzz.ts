// Lead 2: `fund_settlement` arithmetic against the live stake program, over random shapes of the
// bond stake account (balance, delegated part, free lamports, activation state) and of the amount
// the settlement still needs.
//
// For every successful funding it checks conservation of lamports and the bookkeeping of
// `lamports_funded`. Failures are grouped by cause so that unexpected classes stand out.
import { Harness, META_RENT, SOL, U64_MAX, check, errorOf, finish, fmt, section } from './lib.ts'

const RUNS = Number(process.env.RUNS ?? 400)
let seed = BigInt(process.env.SEED ?? 20261115)
const rnd = (): bigint => {
  // xorshift64
  seed ^= (seed << 13n) & U64_MAX
  seed ^= seed >> 7n
  seed ^= (seed << 17n) & U64_MAX
  return seed
}
const between = (lo: bigint, hi: bigint): bigint => lo + (rnd() % (hi - lo + 1n))
const pick = <T>(items: T[]): T => items[Number(rnd() % BigInt(items.length))]!

const h = await Harness.start()
const identity = await h.signer()
const vote = await h.voteAccount(identity.address)
const bond = await h.initBond(vote)
const claimant = await h.signer()
const RENT = h.rentFor(200)
const RESERVE = SOL + META_RENT

type Kind = 'active' | 'activating' | 'inactive'
const failures = new Map<string, { count: number; example: string }>()
let funded = 0
let split = 0
let whole = 0
let broken = 0

for (let run = 0; run < RUNS; run++) {
  const kind: Kind = pick(['active', 'active', 'active', 'activating', 'inactive'])
  // amounts cluster around the reserve and the split thresholds, where the branches switch
  const delegated = pick([
    between(SOL, 3n * SOL),
    between(SOL, 50n * SOL),
    SOL + between(0n, 10_000_000n),
  ])
  const free = pick([0n, 0n, between(0n, 5_000_000n), between(0n, 20n * SOL)])
  const lamports = delegated + RENT + free
  const need = pick([between(1n, 2n * SOL), between(1n, 60n * SOL), lamports - RESERVE + between(0n, 4n * RENT) - 2n * RENT])
  if (need <= 0n) continue

  const stake = await h.bondStake(vote, lamports, {
    delegated,
    activationEpoch: kind === 'activating' ? h.epoch : h.epoch - 10n,
    deactivationEpoch: kind === 'inactive' ? h.epoch - 5n : U64_MAX,
  })
  const s = await h.initSettlement(bond, [
    { staker: claimant.address, withdrawer: claimant.address, claim: need, index: BigInt(run) },
  ])
  const { ix, split: splitAccount } = await h.fundSettlementIx(bond, vote, s.settlement, stake)
  const payerBefore = h.lamportsOf(h.payer.address)
  const res = await h.trySend([ix])
  const shape = `${kind} lamports=${lamports} delegated=${delegated} free=${free} need=${need}`

  if (!res.ok) {
    const cause = errorOf(res.logs).replace(/Program \w+ /, '')
    const entry = failures.get(`${kind}: ${cause}`) ?? { count: 0, example: shape }
    entry.count++
    failures.set(`${kind}: ${cause}`, entry)
    continue
  }
  funded++
  const after = h.stake(stake)
  const rest = h.stake(splitAccount)
  const state = h.settlement(s.settlement)!
  const isSplit = rest.state !== 'Closed'
  if (isSplit) split++
  else whole++

  const problems: string[] = []
  // lamports are conserved; a split account brings in exactly its own rent from the payer
  const total = after.lamports + rest.lamports
  if (total !== lamports + (isSplit ? RENT : 0n)) problems.push(`lamports not conserved: ${total}`)
  if (after.staker !== s.staker || after.withdrawer !== h.withdrawer) problems.push('funded account authorities')
  if (after.deactivationEpoch === U64_MAX) problems.push('funded account not deactivated')
  if (isSplit) {
    if (state.lamportsFunded !== need) problems.push(`split funded ${state.lamportsFunded} != need`)
    if (after.lamports !== need + RESERVE + RENT) problems.push(`funded balance ${after.lamports}`)
    if (rest.staker !== h.withdrawer || rest.withdrawer !== h.withdrawer) problems.push('split authorities')
    if (rest.voter !== vote) problems.push('split voter')
    if (rest.lamports < RESERVE) problems.push(`split below reserve: ${rest.lamports}`)
    if (!state.splitRentCollectorSet || state.splitRentAmount !== RENT) problems.push('split rent record')
  } else {
    if (state.lamportsFunded !== lamports - RESERVE) problems.push(`whole funded ${state.lamportsFunded}`)
    if (h.lamportsOf(h.payer.address) < payerBefore - 20_000n) problems.push('split rent not refunded to payer')
    // over-funding is allowed only when the remainder could not live as its own account
    const over = state.lamportsFunded > need ? state.lamportsFunded - need : 0n
    if (over >= RESERVE + RENT + RESERVE) problems.push(`over-funded by ${over}`)
  }
  if (problems.length > 0) {
    broken++
    console.log(`  BROKEN ${shape}: ${problems.join('; ')}`)
  }
}

section(`fund_settlement over ${RUNS} random stake accounts`)
console.log(`  funded ${funded} (split ${split}, whole ${whole}), failed ${RUNS - funded}`)
check('every successful funding keeps the invariants', broken === 0, `${broken} broken`)
section('failure classes')
for (const [cause, { count, example }] of [...failures].sort((a, b) => b[1].count - a[1].count)) {
  console.log(`  ${String(count).padStart(4)} × ${cause}\n         e.g. ${example}`)
}
void fmt
finish()
