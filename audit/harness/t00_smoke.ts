// Smoke test: the full fund -> settle -> claim path works against the mainnet binaries.
import { Harness, META_RENT, SOL, check, finish, fmt, section } from './lib.ts'

const h = await Harness.start()
const identity = await h.signer()
const vote = await h.voteAccount(identity.address)
const bond = await h.initBond(vote)

section('environment')
check('stake rent is the mainnet value', h.rentFor(200) === 1_666_240n, `${h.rentFor(200)}`)

section('fund_settlement + claim_settlement_v2')
const claimant = await h.signer()
const stake = await h.bondStake(vote, 10n * SOL)
const s = await h.initSettlement(bond, [
  { staker: claimant.address, withdrawer: claimant.address, claim: 2n * SOL, index: 0n },
])
const { split } = await h.fundSettlement(bond, vote, s.settlement, stake)
const funded = h.stake(stake)
const rest = h.stake(split)
console.log('  funded stake:', fmt(funded.lamports), 'split:', fmt(rest.lamports), rest.state)
check('settlement records 2 SOL funded', h.settlement(s.settlement)!.lamportsFunded === 2n * SOL)
check(
  'funded account = claim + 1 SOL + meta rent + split rent',
  funded.lamports === 2n * SOL + SOL + META_RENT + h.rentFor(200),
  `${funded.lamports}`,
)
check('funded account staker is the settlement PDA', funded.staker === s.staker)
check('split stays with the bond', rest.staker === h.withdrawer && rest.withdrawer === h.withdrawer)

const to = await h.putStake({
  lamports: 5n * SOL,
  staker: claimant.address,
  withdrawer: claimant.address,
  voter: vote,
})
const early = await h.trySend([await h.claimIx(bond, s, 0, stake, to)])
check('claim in the funding epoch fails (stake still deactivating)', !early.ok, early.error)
h.warpEpochs(1n)
await h.send([await h.claimIx(bond, s, 0, stake, to)])
check('claimant received 2 SOL', h.lamportsOf(to) === 7n * SOL)
check('settlement records the claim', h.settlement(s.settlement)!.lamportsClaimed === 2n * SOL)
const again = await h.trySend([await h.claimIx(bond, s, 0, stake, to)])
check('second claim of the same leaf is rejected', !again.ok, again.error)

finish()
