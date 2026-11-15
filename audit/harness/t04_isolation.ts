// Leads 6, 7, 8: can anyone other than the bond's own authority, the config's operator, or a
// claimant with a valid proof move a bond's stake? Every attempt below is expected to fail.
import { generateKeyPairSigner } from '@solana/kit'

import {
  Harness,
  SOL,
  SYSTEM,
  bondAddress,
  cat,
  check,
  finish,
  merkle,
  nodeHash,
  pk,
  section,
  settlementAddress,
  settlementClaims,
  settlementStaker,
  u64,
  why,
  withdrawerAuthority,
  withdrawRequestAddress,
} from './lib.ts'

import type { Address, KeyPairSigner } from '@solana/kit'

const h = await Harness.start()
const identityA = await h.signer()
const voteA = await h.voteAccount(identityA.address)
const bondA = await h.initBond(voteA)
const stakeA = await h.bondStake(voteA, 50n * SOL)

const attacker = await h.signer()
const denied = async (
  name: string,
  ix: string,
  accounts: Record<string, Address | KeyPairSigner | null>,
  args?: Uint8Array,
) => {
  const res = await h.tryBonds(ix, accounts, args)
  check(name, !res.ok, res.ok ? 'SUCCEEDED' : why(res.logs))
}

// ---- the attacker's own config: they are admin and operator of it, and open a bond for voteA
const config2 = await generateKeyPairSigner()
await h.bonds(
  'init_config',
  { config: config2, rent_payer: h.payer },
  cat(pk(attacker.address), pk(attacker.address), u64(3n), u64(3n), u64(0n)),
)
const withdrawer2 = await withdrawerAuthority(config2.address)
const bond2 = await bondAddress(config2.address, voteA)
await h.bonds(
  'init_bond',
  { config: config2.address, vote_account: voteA, validator_identity: null, bond: bond2, rent_payer: h.payer },
  cat(pk(SYSTEM), u64(0n), u64(0n)),
)
const leaf = { staker: attacker.address, withdrawer: attacker.address, claim: 40n * SOL, index: 0n }
const tree = merkle([leaf])
const settlement2 = await settlementAddress(bond2, tree.root, h.epoch)
const claims2 = await settlementClaims(settlement2)
await h.bonds(
  'init_settlement',
  {
    config: config2.address,
    bond: bond2,
    settlement: settlement2,
    settlement_claims: claims2,
    operator_authority: attacker,
    rent_payer: h.payer,
  },
  cat(tree.root, u64(40n * SOL), u64(1n), pk(attacker.address), u64(h.epoch)),
)
const staker2 = await settlementStaker(settlement2)

section('lead 7: a second config cannot reach stake of the first')
const fundAccounts = async (over: Record<string, Address | KeyPairSigner | null>) => ({
  config: config2.address,
  bonds_withdrawer_authority: withdrawer2,
  bond: bond2,
  vote_account: voteA,
  settlement: settlement2,
  operator_authority: attacker,
  stake_account: stakeA,
  settlement_staker_authority: staker2,
  split_stake_account: await generateKeyPairSigner(),
  split_stake_rent_payer: h.payer,
  ...over,
})
await denied('fund own settlement with the victim stake', 'fund_settlement', await fundAccounts({}))
await denied(
  'same, passing the victim config PDA as withdrawer authority',
  'fund_settlement',
  await fundAccounts({ bonds_withdrawer_authority: h.withdrawer }),
)
await denied(
  'same, passing the victim config with the attacker as operator',
  'fund_settlement',
  await fundAccounts({ config: h.config.address, bonds_withdrawer_authority: h.withdrawer }),
)
await denied(
  'same, victim config and victim bond, attacker settlement',
  'fund_settlement',
  await fundAccounts({ config: h.config.address, bonds_withdrawer_authority: h.withdrawer, bond: bondA }),
)

// a real settlement of the victim config, funded with the victim stake
const real = await h.initSettlement(bondA, [
  { staker: identityA.address, withdrawer: identityA.address, claim: 10n * SOL, index: 0n },
])
const { split: restA } = await h.fundSettlement(bondA, voteA, real.settlement, stakeA)
h.warpEpochs(1n)
const attackerStake = await h.putStake({
  lamports: 2n * SOL,
  staker: attacker.address,
  withdrawer: attacker.address,
  voter: voteA,
})
const claimArgs = cat(
  new Uint8Array(4),
  nodeHash(leaf),
  pk(leaf.staker),
  pk(leaf.withdrawer),
  u64(leaf.claim),
  u64(leaf.index),
)
await denied(
  'claim own-config settlement out of stake funded to a victim settlement',
  'claim_settlement_v2',
  {
    config: config2.address,
    bonds_withdrawer_authority: withdrawer2,
    bond: bond2,
    settlement: settlement2,
    settlement_claims: claims2,
    stake_account_from: stakeA,
    stake_account_to: attackerStake,
  },
  claimArgs,
)
await denied(
  'same, with the victim config and its withdrawer PDA',
  'claim_settlement_v2',
  {
    bond: bond2,
    settlement: settlement2,
    settlement_claims: claims2,
    stake_account_from: stakeA,
    stake_account_to: attackerStake,
  },
  claimArgs,
)
const forged = { ...leaf, claim: 5n * SOL }
await denied(
  'claim a leaf that is not in the victim settlement tree',
  'claim_settlement_v2',
  {
    bond: bondA,
    settlement: real.settlement,
    settlement_claims: real.claims,
    stake_account_from: stakeA,
    stake_account_to: attackerStake,
  },
  cat(new Uint8Array(4), nodeHash(forged), pk(forged.staker), pk(forged.withdrawer), u64(forged.claim), u64(forged.index)),
)
const plainA = await h.bondStake(voteA, 5n * SOL)
await denied(
  'merge victim stake under the attacker config',
  'merge_stake',
  { config: config2.address, source_stake: restA, destination_stake: plainA, staker_authority: h.withdrawer },
  pk(SYSTEM),
)
await denied(
  'withdraw_stake as operator of the attacker config',
  'withdraw_stake',
  {
    config: config2.address,
    bonds_withdrawer_authority: withdrawer2,
    operator_authority: attacker,
    settlement: attacker.address,
    stake_account: restA,
    withdraw_to: attacker.address,
  },
)
await denied('withdraw_stake as a non-operator of the victim config', 'withdraw_stake', {
  operator_authority: attacker,
  settlement: SYSTEM,
  stake_account: restA,
  withdraw_to: attacker.address,
})

section('lead 8: reset_stake / withdraw_stake and the "closed settlement" check')
await denied('reset stake of a live settlement', 'reset_stake', {
  bond: bondA,
  settlement: real.settlement,
  stake_account: stakeA,
  vote_account: voteA,
})
await denied('reset it naming an unrelated system-owned address as the settlement', 'reset_stake', {
  bond: bondA,
  settlement: attacker.address,
  stake_account: stakeA,
  vote_account: voteA,
})
await denied('reset plain bond stake (never funded to a settlement)', 'reset_stake', {
  bond: bondA,
  settlement: attacker.address,
  stake_account: restA,
  vote_account: voteA,
})
await denied('operator withdraw_stake of delegated settlement stake', 'withdraw_stake', {
  operator_authority: h.operator,
  settlement: attacker.address,
  stake_account: stakeA,
  withdraw_to: h.operator.address,
})
await denied('operator withdraw_stake of plain bond stake', 'withdraw_stake', {
  operator_authority: h.operator,
  settlement: attacker.address,
  stake_account: restA,
  withdraw_to: h.operator.address,
})

section('lead 6: withdraw request authority')
const identityB = await h.signer()
const voteB = await h.voteAccount(identityB.address)
const bondB = await h.initBond(voteB)
const requestA = await withdrawRequestAddress(bondA)
const requestB = await withdrawRequestAddress(bondB)
const initRequest = (bond: Address, vote: Address, request: Address, authority: KeyPairSigner) => ({
  ix: 'init_withdraw_request',
  accounts: { bond, vote_account: vote, authority, withdraw_request: request, rent_payer: h.payer },
})
{
  const r = initRequest(bondA, voteA, requestA, attacker)
  await denied('stranger opens a withdraw request on bond A', r.ix, r.accounts, u64(10n * SOL))
}
{
  const r = initRequest(bondA, voteA, requestA, identityB)
  await denied('validator B opens a withdraw request on bond A', r.ix, r.accounts, u64(10n * SOL))
}
{
  const r = initRequest(bondA, voteB, requestA, identityB)
  await denied('validator B, bond A with vote account B', r.ix, r.accounts, u64(10n * SOL))
}
// validator B opens a legitimate request on its own bond and tries to take bond A's stake with it
await h.bonds(
  'init_withdraw_request',
  { bond: bondB, vote_account: voteB, authority: identityB, withdraw_request: requestB, rent_payer: h.payer },
  u64(10n * SOL),
)
h.warpEpochs(4n)
const claimRequest = async (over: Record<string, Address | KeyPairSigner | null>) => ({
  bond: bondB,
  vote_account: voteB,
  authority: identityB,
  withdraw_request: requestB,
  stake_account: restA,
  withdrawer: identityB.address,
  split_stake_account: await generateKeyPairSigner(),
  split_stake_rent_payer: h.payer,
  ...over,
})
await denied('validator B claims its request out of stake delegated to A', 'claim_withdraw_request', await claimRequest({}))
await denied(
  'same, naming bond A with request B',
  'claim_withdraw_request',
  await claimRequest({ bond: bondA, vote_account: voteA }),
)
await denied(
  'validator B claims settlement-funded stake of A',
  'claim_withdraw_request',
  await claimRequest({ stake_account: stakeA }),
)
const stakeB = await h.bondStake(voteB, 20n * SOL)
await denied(
  'stranger claims validator B request',
  'claim_withdraw_request',
  await claimRequest({ authority: attacker, stake_account: stakeB, withdrawer: attacker.address }),
)
const okClaim = await h.tryBonds('claim_withdraw_request', await claimRequest({ stake_account: stakeB }))
check('control: validator B claims its own stake', okClaim.ok, okClaim.ok ? '' : why(okClaim.logs))
check('control: the claimed account now belongs to B', h.stake(stakeB).withdrawer === identityB.address)
check('victim stake untouched', h.stake(restA).withdrawer === h.withdrawer && h.stake(stakeA).withdrawer === h.withdrawer)

finish()
