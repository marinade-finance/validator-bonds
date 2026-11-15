// Lead 2 follow-up: bond stake accounts that count as collateral off-chain (the collector sums
// whole account balances) but that `fund_settlement` cannot fund partially.
//
// Shape A — small delegation, large free balance. `fund_settlement` first withdraws free lamports
//   into the split account, then splits the remaining delegated excess. When that excess is
//   below the stake program's 1 SOL minimum delegation the split CPI fails.
// Shape B — inactive stake whose recorded delegation is larger than its balance. The handler
//   computes `lamports - delegation.stake` and panics on the subtraction.
import { Harness, SOL, U64_MAX, check, finish, fmt, section, transferIx } from './lib.ts'

const h = await Harness.start()
const identity = await h.signer()
const vote = await h.voteAccount(identity.address)
const bond = await h.initBond(vote)
const claimant = await h.signer()
let leafIndex = 0n
const settle = (amount: bigint) =>
  h.initSettlement(bond, [
    { staker: claimant.address, withdrawer: claimant.address, claim: amount, index: leafIndex++ },
  ])
const fund = async (stake: Parameters<Harness['fundSettlementIx']>[3], amount: bigint) => {
  const s = await settle(amount)
  const { ix } = await h.fundSettlementIx(bond, vote, s.settlement, stake)
  return { res: await h.trySend([ix]), s }
}

section('shape A: 1.5 SOL delegated, then 100 SOL sent into the stake account')
const a = await h.bondStake(vote, 15n * (SOL / 10n) + h.rentFor(200))
const anyone = await h.signer()
await h.send([transferIx(anyone, a, 100n * SOL)])
console.log('  account:', fmt(h.stake(a).lamports), 'delegated', fmt(h.stake(a).delegated!))
for (const amount of [1n, 5n, 50n, 99n]) {
  const { res } = await fund(a, amount * SOL)
  check(`a ${amount} SOL settlement cannot be funded from it`, !res.ok, res.error)
}
const whole = await fund(a, 996n * (SOL / 10n))
check('only a settlement of nearly the whole balance funds it', whole.res.ok, whole.res.error)

section('shape A: operator workaround — merge into another active bond stake first')
const a2 = await h.bondStake(vote, 15n * (SOL / 10n) + h.rentFor(200))
await h.send([transferIx(anyone, a2, 100n * SOL)])
const helper = await h.bondStake(vote, 3n * SOL)
await h.send([await h.mergeIx(a2, helper, h.withdrawer)])
const afterMerge = await fund(helper, 5n * SOL)
check('after the merge a 5 SOL settlement funds', afterMerge.res.ok, afterMerge.res.error)

section('shape B: inactive stake, recorded delegation 100 SOL, balance 10 SOL')
const b = await h.bondStake(vote, 10n * SOL, {
  delegated: 100n * SOL,
  deactivationEpoch: h.epoch - 5n,
})
const partial = await fund(b, 2n * SOL)
check('a 2 SOL settlement cannot be funded from it (panic)', !partial.res.ok, partial.res.error)

section('shape B: operator workaround — merge into an inactive bond stake with a sane delegation')
const sane = await h.bondStake(vote, 2n * SOL, { deactivationEpoch: h.epoch - 5n })
const merge = await h.trySend([await h.mergeIx(b, sane, h.withdrawer)])
check('merge of the two inactive accounts works', merge.ok, merge.error)
const afterSane = await fund(sane, 2n * SOL)
check('after the merge a 2 SOL settlement funds', afterSane.res.ok, afterSane.res.error)
void U64_MAX

finish()
