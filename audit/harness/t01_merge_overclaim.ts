// Lead 3: `claim_settlement_v2` caps claims by `max_total_claim`, not by `lamports_funded`.
// Every funded stake account keeps a reserve (1 SOL + meta rent) that is meant to return to the
// bond on `reset_stake`. A permissionless `merge_stake` of the funded accounts leaves one reserve
// instead of N, and the other N-1 reserves become claimable.
import { Harness, META_RENT, SOL, check, finish, fmt, section } from './lib.ts'

const RESERVE = SOL + META_RENT
const ACCOUNTS = 3

async function scenario(merge: boolean) {
  const h = await Harness.start()
  const identity = await h.signer()
  const vote = await h.voteAccount(identity.address)
  const bond = await h.initBond(vote)
  const claimant = await h.signer()

  // the bond holds 3 x 2 SOL; the settlement asks for more than the bond can pay
  const stakes = []
  for (let i = 0; i < ACCOUNTS; i++) stakes.push(await h.bondStake(vote, 2n * SOL))
  const claim = 49n * (SOL / 10n)
  const s = await h.initSettlement(
    bond,
    [{ staker: claimant.address, withdrawer: claimant.address, claim, index: 0n }],
    { maxTotalClaim: 10n * SOL },
  )
  for (const stake of stakes) await h.fundSettlement(bond, vote, s.settlement, stake)
  const funded = h.settlement(s.settlement)!.lamportsFunded
  check(
    'each account funds its balance minus the reserve',
    funded === BigInt(ACCOUNTS) * (2n * SOL - RESERVE),
    fmt(funded),
  )

  h.warpEpochs(1n)
  let from = stakes[0]!
  if (merge) {
    // anyone can send this: no signer besides the fee payer
    for (const source of stakes.slice(1)) {
      await h.send([await h.mergeIx(source, from, s.staker, s.settlement)])
    }
    check('merged account holds all three balances', h.lamportsOf(from) === 6n * SOL)
  }
  const to = await h.putStake({
    lamports: 5n * SOL,
    staker: claimant.address,
    withdrawer: claimant.address,
    voter: vote,
  })
  const res = await h.trySend([await h.claimIx(bond, s, 0, from, to)])
  const state = h.settlement(s.settlement)!
  return { h, res, funded, claimed: state.lamportsClaimed, left: h.lamportsOf(from), claim }
}

section('control: no merge')
const control = await scenario(false)
check('a 4.9 SOL claim cannot be paid from a 2 SOL funded account', !control.res.ok, control.res.error)
check('nothing claimed', control.claimed === 0n)

section('merge the funded accounts, then claim')
const merged = await scenario(true)
check('the 4.9 SOL claim succeeds', merged.res.ok, merged.res.error)
check(
  'lamports_claimed exceeds lamports_funded',
  merged.claimed > merged.funded,
  `claimed ${fmt(merged.claimed)} vs funded ${fmt(merged.funded)}`,
)
const expectedBack = BigInt(ACCOUNTS) * RESERVE
console.log(
  `  bond gets back ${fmt(merged.left)} after close instead of ${fmt(expectedBack)}`,
  `(${fmt(expectedBack - merged.left)} of reserves paid out)`,
)
check('reserves of the merged-away accounts were paid to the claimant', merged.left < expectedBack)

finish()
