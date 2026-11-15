// Settlement close / reset lifecycle on the live stake program, plus the design points of
// leads 4, 5 and 6: pause versus cancel, standing withdraw requests, closed vote accounts.
import { generateKeyPairSigner, lamports } from '@solana/kit'

import {
  Harness,
  META_RENT,
  SOL,
  SYSTEM,
  U64_MAX,
  check,
  finish,
  fmt,
  section,
  u64,
  why,
  withdrawRequestAddress,
} from './lib.ts'

import type { Address } from '@solana/kit'

const h = await Harness.start()
const stranger = await h.signer()
const setup = async () => {
  const identity = await h.signer()
  const vote = await h.voteAccount(identity.address)
  const bond = await h.initBond(vote)
  return { identity, vote, bond }
}
const closeAccounts = (bond: Address, s: { settlement: Address; claims: Address }, refund: Address) => ({
  bond,
  settlement: s.settlement,
  settlement_claims: s.claims,
  rent_collector: h.payer.address,
  split_rent_collector: h.payer.address,
  split_rent_refund_account: refund,
})

section('expiry: close by anyone, then reset by anyone')
{
  const { identity, vote, bond } = await setup()
  const stake = await h.bondStake(vote, 20n * SOL)
  const s = await h.initSettlement(bond, [
    { staker: identity.address, withdrawer: identity.address, claim: 4n * SOL, index: 0n },
    { staker: stranger.address, withdrawer: stranger.address, claim: 3n * SOL, index: 1n },
  ])
  const { split } = await h.fundSettlement(bond, vote, s.settlement, stake)
  const before = h.lamportsOf(stake) + h.lamportsOf(split)
  h.warpEpochs(1n)
  const to = await h.putStake({ lamports: 2n * SOL, staker: identity.address, withdrawer: identity.address, voter: vote })
  await h.send([await h.claimIx(bond, s, 0, stake, to)])

  const early = await h.tryBonds('close_settlement_v2', closeAccounts(bond, s, stake))
  check('close before expiry is rejected', !early.ok, why(early.logs))
  h.warpEpochs(3n)
  const late = await h.trySend([await h.claimIx(bond, s, 1, stake, await h.putStake({ lamports: 2n * SOL, staker: stranger.address, withdrawer: stranger.address, voter: vote }))])
  check('claim after expiry is rejected', !late.ok, why(late.logs))
  const collectorBefore = h.lamportsOf(h.payer.address)
  await h.bonds('close_settlement_v2', closeAccounts(bond, s, stake))
  check('settlement account is gone', h.settlement(s.settlement) === null)
  check('rent and split rent went to the recorded collector', h.lamportsOf(h.payer.address) > collectorBefore)

  const reset = await h.tryBonds('reset_stake', { bond, settlement: s.settlement, stake_account: stake, vote_account: vote })
  check('reset_stake works for anyone', reset.ok, reset.ok ? '' : why(reset.logs))
  const back = h.stake(stake)
  check('stake is back under the bonds PDA', back.staker === h.withdrawer && back.withdrawer === h.withdrawer)
  check('stake is delegated again to the bond vote account', back.voter === vote && back.deactivationEpoch === U64_MAX)
  const paid = 4n * SOL + h.rentFor(200)
  check(
    'bond lost exactly the claimed amount and the split rent refund',
    h.lamportsOf(stake) + h.lamportsOf(split) === before - paid,
    fmt(before - h.lamportsOf(stake) - h.lamportsOf(split)),
  )
  check('unclaimed 3 SOL returned with the reserve', h.lamportsOf(stake) === 3n * SOL + SOL + META_RENT)
}

section('lead 4: pause blocks the recovery instructions')
{
  const { identity, vote, bond } = await setup()
  const stake = await h.bondStake(vote, 20n * SOL)
  const s = await h.initSettlement(bond, [
    { staker: identity.address, withdrawer: identity.address, claim: 4n * SOL, index: 0n },
  ])
  await h.fundSettlement(bond, vote, s.settlement, stake)
  h.warpEpochs(1n)
  await h.bonds('emergency_pause', { pause_authority: h.admin })
  const cancelAccounts = { ...closeAccounts(bond, s, stake), authority: h.admin }
  const paused = await h.tryBonds('cancel_settlement', cancelAccounts)
  check('cancel_settlement is rejected while paused', !paused.ok, why(paused.logs))
  const to = await h.putStake({ lamports: 2n * SOL, staker: identity.address, withdrawer: identity.address, voter: vote })
  const claimPaused = await h.trySend([await h.claimIx(bond, s, 0, stake, to)])
  check('claims are rejected while paused', !claimPaused.ok, why(claimPaused.logs))
  // resume and cancel in ONE transaction: no slot in which a claim could land between them
  const atomic = await h.trySend([
    await h.bondsIx('emergency_resume', { pause_authority: h.admin }),
    await h.bondsIx('cancel_settlement', cancelAccounts),
  ])
  check('resume + cancel fit in one transaction', atomic.ok, atomic.ok ? '' : why(atomic.logs))
  const after = await h.trySend([await h.claimIx(bond, s, 0, stake, to)])
  check('claim after the cancel is rejected', !after.ok, why(after.logs))
  const reset = await h.tryBonds('reset_stake', { bond, settlement: s.settlement, stake_account: stake, vote_account: vote })
  check('stake resets to the bond', reset.ok, reset.ok ? '' : why(reset.logs))
}

section('lead 5: a withdraw request stays claimable forever and covers stake funded later')
{
  const { identity, vote, bond } = await setup()
  const request = await withdrawRequestAddress(bond)
  await h.bonds(
    'init_withdraw_request',
    { bond, vote_account: vote, authority: identity, withdraw_request: request, rent_payer: h.payer },
    u64(U64_MAX),
  )
  h.warpEpochs(50n)
  const fresh = await h.bondStake(vote, 500n * SOL, { activationEpoch: h.epoch })
  const res = await h.tryBonds('claim_withdraw_request', {
    bond,
    vote_account: vote,
    authority: identity,
    withdraw_request: request,
    stake_account: fresh,
    withdrawer: identity.address,
    split_stake_account: await generateKeyPairSigner(),
    split_stake_rent_payer: h.payer,
  })
  check('stake funded this epoch leaves through a 50-epoch-old request', res.ok, res.ok ? '' : why(res.logs))
  check('the account belongs to the validator again', h.stake(fresh).withdrawer === identity.address)
}

section('lead 6: a closed vote account strands the bond')
{
  const { identity, vote, bond } = await setup()
  const stake = await h.bondStake(vote, 30n * SOL)
  // the vote account is withdrawn to zero and the address returns to the system program
  h.svm.setAccount({ address: vote, data: new Uint8Array(), executable: false, lamports: lamports(0n), programAddress: SYSTEM, space: 0n })
  const request = await withdrawRequestAddress(bond)
  for (const authority of [identity]) {
    const res = await h.tryBonds(
      'init_withdraw_request',
      { bond, vote_account: vote, authority, withdraw_request: request, rent_payer: h.payer },
      u64(U64_MAX),
    )
    check('validator can no longer open a withdraw request', !res.ok, why(res.logs))
  }
  check('the bond stake stays under the bonds PDA', h.stake(stake).withdrawer === h.withdrawer)
}

finish()
