// Audit harness: runs the deployed mainnet validator-bonds and stake program binaries in LiteSVM.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { sha256 } from '@noble/hashes/sha256'
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  generateKeyPairSigner,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
  lamports,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from '@solana/kit'
import { Clock, FailedTransactionMetadata, LiteSVM, Rent } from 'litesvm'

import type { Address, Instruction, KeyPairSigner } from '@solana/kit'

const HERE = dirname(fileURLToPath(import.meta.url))
const IDL = JSON.parse(
  readFileSync(
    join(HERE, '../../packages/validator-bonds-sdk/idl/json/validator_bonds.json'),
    'utf8',
  ),
)

export const BONDS = address('vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4')
export const STAKE = address('Stake11111111111111111111111111111111111111')
export const VOTE = address('Vote111111111111111111111111111111111111111')
export const SYSTEM = address('11111111111111111111111111111111')
export const CLOCK = address('SysvarC1ock11111111111111111111111111111111')
export const RENT = address('SysvarRent111111111111111111111111111111111')
export const STAKE_HISTORY = address('SysvarStakeHistory1111111111111111111111111')
export const STAKE_CONFIG = address('StakeConfig11111111111111111111111111111111')

export const SOL = 1_000_000_000n
export const U64_MAX = 0xffff_ffff_ffff_ffffn
/// What the stake program writes into `Meta.rent_exempt_reserve`, and what old accounts carry.
export const META_RENT = 2_282_880n
export const STAKE_SPACE = 200
export const SLOTS_PER_EPOCH = 432_000n

const enc = getAddressEncoder()
const dec = getAddressDecoder()
export const pk = (a: Address): Uint8Array => new Uint8Array(enc.encode(a))
export const toAddress = (b: Uint8Array): Address => dec.decode(b)

export const u64 = (v: bigint): Uint8Array => {
  const b = new Uint8Array(8)
  new DataView(b.buffer).setBigUint64(0, v, true)
  return b
}
const u32 = (v: number): Uint8Array => {
  const b = new Uint8Array(4)
  new DataView(b.buffer).setUint32(0, v, true)
  return b
}
export const cat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

async function pda(seeds: (Uint8Array | string)[], program = BONDS): Promise<Address> {
  const [a] = await getProgramDerivedAddress({
    programAddress: program,
    seeds: seeds.map(s => (typeof s === 'string' ? new TextEncoder().encode(s) : s)),
  })
  return a
}

export const bondAddress = (config: Address, vote: Address) =>
  pda(['bond_account', pk(config), pk(vote)])
export const withdrawerAuthority = (config: Address) => pda(['bonds_authority', pk(config)])
export const settlementAddress = (bond: Address, root: Uint8Array, epoch: bigint) =>
  pda(['settlement_account', pk(bond), root, u64(epoch)])
export const settlementStaker = (settlement: Address) =>
  pda(['settlement_authority', pk(settlement)])
export const settlementClaims = (settlement: Address) => pda(['claims_account', pk(settlement)])
export const withdrawRequestAddress = (bond: Address) => pda(['withdraw_account', pk(bond)])
const eventAuthority = () => pda(['__event_authority'])

// ---------------------------------------------------------------- merkle tree

export type Leaf = { staker: Address; withdrawer: Address; claim: bigint; index: bigint }

export const nodeHash = (l: Leaf): Uint8Array =>
  sha256(cat(pk(l.staker), pk(l.withdrawer), u64(l.claim), u64(l.index)))
const leafHash = (l: Leaf): Uint8Array => sha256(cat(new Uint8Array([0]), nodeHash(l)))
const cmp = (a: Uint8Array, b: Uint8Array): number => {
  for (let i = 0; i < 32; i++) if (a[i] !== b[i]) return a[i]! - b[i]!
  return 0
}
const parent = (a: Uint8Array, b: Uint8Array): Uint8Array =>
  cmp(a, b) <= 0
    ? sha256(cat(new Uint8Array([1]), a, b))
    : sha256(cat(new Uint8Array([1]), b, a))

/// Sorted-pair merkle tree matching the on-chain `merkle_proof::verify`.
export function merkle(leaves: Leaf[]): { root: Uint8Array; proofs: Uint8Array[][] } {
  let level = leaves.map(leafHash)
  const proofs: Uint8Array[][] = leaves.map(() => [])
  let groups = leaves.map((_, i) => [i])
  while (level.length > 1) {
    const next: Uint8Array[] = []
    const nextGroups: number[][] = []
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 === level.length) {
        next.push(level[i]!)
        nextGroups.push(groups[i]!)
        continue
      }
      for (const m of groups[i]!) proofs[m]!.push(level[i + 1]!)
      for (const m of groups[i + 1]!) proofs[m]!.push(level[i]!)
      next.push(parent(level[i]!, level[i + 1]!))
      nextGroups.push([...groups[i]!, ...groups[i + 1]!])
    }
    level = next
    groups = nextGroups
  }
  return { root: level[0]!, proofs }
}

// ---------------------------------------------------------------- stake state

export type StakeView = {
  lamports: bigint
  state: 'Uninitialized' | 'Initialized' | 'Stake' | 'Closed'
  metaRent?: bigint
  staker?: Address
  withdrawer?: Address
  voter?: Address
  delegated?: bigint
  activationEpoch?: bigint
  deactivationEpoch?: bigint
}

export type StakeInit = {
  lamports: bigint
  staker: Address
  withdrawer: Address
  /// omit for an `Initialized` (non-delegated) account
  voter?: Address
  /// defaults to lamports - metaRent
  delegated?: bigint
  activationEpoch?: bigint
  deactivationEpoch?: bigint
  metaRent?: bigint
  lockup?: { unixTimestamp: bigint; epoch: bigint; custodian: Address }
}

function stakeData(s: StakeInit): Uint8Array {
  const data = new Uint8Array(STAKE_SPACE)
  const view = new DataView(data.buffer)
  const metaRent = s.metaRent ?? META_RENT
  view.setUint32(0, s.voter ? 2 : 1, true)
  view.setBigUint64(4, metaRent, true)
  data.set(pk(s.staker), 12)
  data.set(pk(s.withdrawer), 44)
  if (s.lockup) {
    view.setBigInt64(76, s.lockup.unixTimestamp, true)
    view.setBigUint64(84, s.lockup.epoch, true)
    data.set(pk(s.lockup.custodian), 92)
  }
  if (s.voter) {
    data.set(pk(s.voter), 124)
    view.setBigUint64(156, s.delegated ?? s.lamports - metaRent, true)
    view.setBigUint64(164, s.activationEpoch ?? 0n, true)
    view.setBigUint64(172, s.deactivationEpoch ?? U64_MAX, true)
    view.setFloat64(180, 0.25, true)
    view.setBigUint64(188, 0n, true)
  }
  return data
}

// ---------------------------------------------------------------- harness

export class Failed extends Error {
  constructor(
    readonly logs: string[],
    readonly detail: string,
  ) {
    super(detail)
  }
}

export class Harness {
  svm: LiteSVM
  payer!: KeyPairSigner
  admin!: KeyPairSigner
  operator!: KeyPairSigner
  config!: KeyPairSigner
  withdrawer!: Address
  private blockhashSalt = 0

  private constructor() {
    this.svm = new LiteSVM()
      .withSigverify(false)
      .withBlockhashCheck(false)
      .withTransactionHistory(0n)
    // mainnet Rent sysvar: 5080 lamports per byte, threshold 1.0 -> 1_666_240 for a stake account
    this.svm.setRent(new Rent(5080n, 1.0, 50))
    this.svm.addProgram(STAKE, readFileSync(join(HERE, 'bin/mainnet_stake.so')))
    this.svm.addProgram(BONDS, readFileSync(join(HERE, 'bin/mainnet_bonds.so')))
  }

  /// `claimDelaySlots` mirrors `slots_to_start_settlement_claiming` (mainnet: 200_000).
  static async start(opts: { epoch?: bigint; claimDelaySlots?: bigint } = {}): Promise<Harness> {
    const h = new Harness()
    h.setEpoch(opts.epoch ?? 1000n)
    h.payer = await h.signer()
    h.admin = await h.signer()
    h.operator = await h.signer()
    h.config = await generateKeyPairSigner()
    h.withdrawer = await withdrawerAuthority(h.config.address)
    await h.bonds(
      'init_config',
      { config: h.config, rent_payer: h.payer },
      cat(pk(h.admin.address), pk(h.operator.address), u64(3n), u64(3n), u64(opts.claimDelaySlots ?? 0n)),
    )
    return h
  }

  get epoch(): bigint {
    return this.svm.getClock().epoch
  }

  setEpoch(epoch: bigint, slotInEpoch = 1000n): void {
    const slot = epoch * SLOTS_PER_EPOCH + slotInEpoch
    this.svm.warpToSlot(slot)
    this.svm.setClock(new Clock(slot, 1_700_000_000n, epoch, epoch + 1n, 1_700_000_000n + slot / 2n))
  }

  warpEpochs(n: bigint): void {
    this.setEpoch(this.epoch + n)
  }

  warpSlots(n: bigint): void {
    const c = this.svm.getClock()
    const slot = c.slot + n
    this.svm.warpToSlot(slot)
    this.svm.setClock(
      new Clock(slot, c.epochStartTimestamp, slot / SLOTS_PER_EPOCH, slot / SLOTS_PER_EPOCH + 1n, c.unixTimestamp + n / 2n),
    )
  }

  async signer(sol = 1000n): Promise<KeyPairSigner> {
    const s = await generateKeyPairSigner()
    this.svm.airdrop(s.address, lamports(sol * SOL))
    return s
  }

  rentFor(space: number): bigint {
    return this.svm.minimumBalanceForRentExemption(BigInt(space))
  }

  /// Sends instructions; throws `Failed` with program logs when the transaction fails.
  async send(ixs: Instruction[], signers: KeyPairSigner[] = []): Promise<string[]> {
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      m => setTransactionMessageFeePayerSigner(this.payer, m),
      m =>
        setTransactionMessageLifetimeUsingBlockhash(
          { blockhash: this.svm.latestBlockhash(), lastValidBlockHeight: U64_MAX },
          m,
        ),
      m => appendTransactionMessageInstructions(ixs, m),
    )
    void signers
    const tx = await signTransactionMessageWithSigners(message)
    this.svm.expireBlockhash()
    this.blockhashSalt++
    const res = this.svm.sendTransaction(tx)
    if (res instanceof FailedTransactionMetadata) {
      throw new Failed(res.meta().logs(), res.toString())
    }
    return res.logs()
  }

  /// Like `send`, returns the failure instead of throwing.
  async trySend(ixs: Instruction[]): Promise<{ ok: boolean; logs: string[]; error?: string }> {
    try {
      return { ok: true, logs: await this.send(ixs) }
    } catch (e) {
      if (e instanceof Failed) return { ok: false, logs: e.logs, error: errorOf(e.logs) }
      throw e
    }
  }

  /// Builds a bonds instruction from the IDL account order; `accounts` maps IDL names to an
  /// address or a signer. Fixed-address accounts, the event authority and the program are filled in.
  async bondsIx(
    name: string,
    accounts: Record<string, Address | KeyPairSigner | null>,
    args: Uint8Array = new Uint8Array(),
  ): Promise<Instruction> {
    const ix = IDL.instructions.find((i: { name: string }) => i.name === name)
    if (!ix) throw new Error(`unknown instruction ${name}`)
    const metas = []
    for (const acc of ix.accounts) {
      let value: Address | KeyPairSigner | null | undefined = accounts[acc.name]
      if (value === undefined) {
        if (acc.name === 'event_authority') value = await eventAuthority()
        else if (acc.name === 'program') value = BONDS
        else if (acc.name === 'config') value = this.config.address
        else if (acc.name === 'bonds_withdrawer_authority') value = this.withdrawer
        else if (acc.address) value = address(acc.address)
        else if (acc.optional) value = null
        else throw new Error(`${name}: missing account ${acc.name}`)
      }
      if (value === null) {
        metas.push({ address: BONDS, role: AccountRole.READONLY })
        continue
      }
      const isSigner = typeof value !== 'string'
      const addr = typeof value === 'string' ? value : value.address
      const role = acc.writable
        ? isSigner
          ? AccountRole.WRITABLE_SIGNER
          : AccountRole.WRITABLE
        : isSigner
          ? AccountRole.READONLY_SIGNER
          : AccountRole.READONLY
      metas.push(isSigner ? { address: addr, role, signer: value } : { address: addr, role })
    }
    return {
      programAddress: BONDS,
      accounts: metas,
      data: cat(new Uint8Array(ix.discriminator), args),
    } as Instruction
  }

  async bonds(
    name: string,
    accounts: Record<string, Address | KeyPairSigner | null>,
    args?: Uint8Array,
  ): Promise<string[]> {
    return this.send([await this.bondsIx(name, accounts, args)])
  }

  async tryBonds(
    name: string,
    accounts: Record<string, Address | KeyPairSigner | null>,
    args?: Uint8Array,
  ) {
    return this.trySend([await this.bondsIx(name, accounts, args)])
  }

  // -------------------------------------------------------------- accounts

  /// Vote account holding only what the bonds program reads (version tag + node identity).
  /// Not usable for a stake-program `DelegateStake` CPI, which deserializes the full vote state.
  async voteAccount(identity: Address): Promise<Address> {
    const vote = (await generateKeyPairSigner()).address
    const data = new Uint8Array(3762)
    new DataView(data.buffer).setUint32(0, 2, true)
    data.set(pk(identity), 4)
    data.set(pk(identity), 36)
    this.svm.setAccount({
      address: vote,
      data,
      executable: false,
      lamports: lamports(this.rentFor(3762)),
      programAddress: VOTE,
      space: 3762n,
    })
    return vote
  }

  async putStake(init: StakeInit, at?: Address): Promise<Address> {
    const addr = at ?? (await generateKeyPairSigner()).address
    this.svm.setAccount({
      address: addr,
      data: stakeData(init),
      executable: false,
      lamports: lamports(init.lamports),
      programAddress: STAKE,
      space: BigInt(STAKE_SPACE),
    })
    return addr
  }

  /// A stake account as `fund_bond` leaves it: both authorities are the bonds withdrawer PDA.
  bondStake(voter: Address, amount: bigint, extra: Partial<StakeInit> = {}): Promise<Address> {
    return this.putStake({
      lamports: amount,
      staker: this.withdrawer,
      withdrawer: this.withdrawer,
      voter,
      activationEpoch: this.epoch - 10n,
      ...extra,
    })
  }

  lamportsOf(a: Address): bigint {
    return this.svm.getBalance(a) ?? 0n
  }

  stake(a: Address): StakeView {
    const acc = this.svm.getAccount(a)
    if (!acc.exists || acc.data.length === 0) {
      return { lamports: acc.exists ? acc.lamports : 0n, state: 'Closed' }
    }
    const d = new Uint8Array(acc.data)
    const view = new DataView(d.buffer, d.byteOffset)
    const tag = view.getUint32(0, true)
    const base: StakeView = { lamports: acc.lamports, state: 'Uninitialized' }
    if (tag === 0) return base
    base.state = tag === 1 ? 'Initialized' : 'Stake'
    base.metaRent = view.getBigUint64(4, true)
    base.staker = toAddress(d.slice(12, 44))
    base.withdrawer = toAddress(d.slice(44, 76))
    if (tag === 2) {
      base.voter = toAddress(d.slice(124, 156))
      base.delegated = view.getBigUint64(156, true)
      base.activationEpoch = view.getBigUint64(164, true)
      base.deactivationEpoch = view.getBigUint64(172, true)
    }
    return base
  }

  /// Settlement account fields the tests assert on.
  settlement(a: Address) {
    const acc = this.svm.getAccount(a)
    if (!acc.exists || acc.data.length === 0) return null
    const d = new Uint8Array(acc.data)
    const view = new DataView(d.buffer, d.byteOffset)
    const o = 8 + 32 + 32 + 32
    return {
      maxTotalClaim: view.getBigUint64(o, true),
      maxMerkleNodes: view.getBigUint64(o + 8, true),
      lamportsFunded: view.getBigUint64(o + 16, true),
      lamportsClaimed: view.getBigUint64(o + 24, true),
      merkleNodesClaimed: view.getBigUint64(o + 32, true),
      splitRentCollectorSet: d[o + 56 + 32] === 1,
      splitRentAmount: view.getBigUint64(d[o + 56 + 32] === 1 ? o + 56 + 32 + 33 : o + 56 + 32 + 1, true),
    }
  }

  // -------------------------------------------------------------- flows

  async initBond(vote: Address): Promise<Address> {
    const bond = await bondAddress(this.config.address, vote)
    await this.bonds(
      'init_bond',
      { vote_account: vote, validator_identity: null, bond, rent_payer: this.payer },
      cat(pk(SYSTEM), u64(0n), u64(0n)),
    )
    return bond
  }

  async initSettlement(
    bond: Address,
    leaves: Leaf[],
    opts: { maxTotalClaim?: bigint; epoch?: bigint } = {},
  ) {
    const tree = merkle(leaves)
    const epoch = opts.epoch ?? this.epoch
    const settlement = await settlementAddress(bond, tree.root, epoch)
    const claims = await settlementClaims(settlement)
    const maxTotalClaim = opts.maxTotalClaim ?? leaves.reduce((n, l) => n + l.claim, 0n)
    await this.bonds(
      'init_settlement',
      {
        bond,
        settlement,
        settlement_claims: claims,
        operator_authority: this.operator,
        rent_payer: this.payer,
      },
      cat(tree.root, u64(maxTotalClaim), u64(BigInt(leaves.length)), pk(this.payer.address), u64(epoch)),
    )
    return { settlement, claims, tree, leaves, staker: await settlementStaker(settlement) }
  }

  async fundSettlementIx(bond: Address, vote: Address, settlement: Address, stake: Address) {
    const split = await generateKeyPairSigner()
    const ix = await this.bondsIx('fund_settlement', {
      bond,
      vote_account: vote,
      settlement,
      operator_authority: this.operator,
      stake_account: stake,
      settlement_staker_authority: await settlementStaker(settlement),
      split_stake_account: split,
      split_stake_rent_payer: this.payer,
    })
    return { ix, split: split.address }
  }

  async fundSettlement(bond: Address, vote: Address, settlement: Address, stake: Address) {
    const { ix, split } = await this.fundSettlementIx(bond, vote, settlement, stake)
    const logs = await this.send([ix])
    return { split, logs }
  }

  async claimIx(
    bond: Address,
    s: { settlement: Address; claims: Address; tree: { proofs: Uint8Array[][] }; leaves: Leaf[] },
    leafIndex: number,
    from: Address,
    to: Address,
  ) {
    const leaf = s.leaves[leafIndex]!
    const proof = s.tree.proofs[leafIndex]!
    return this.bondsIx(
      'claim_settlement_v2',
      {
        bond,
        settlement: s.settlement,
        settlement_claims: s.claims,
        stake_account_from: from,
        stake_account_to: to,
      },
      cat(
        u32(proof.length),
        ...proof,
        nodeHash(leaf),
        pk(leaf.staker),
        pk(leaf.withdrawer),
        u64(leaf.claim),
        u64(leaf.index),
      ),
    )
  }

  async mergeIx(source: Address, destination: Address, stakerAuthority: Address, settlement: Address = SYSTEM) {
    return this.bondsIx(
      'merge_stake',
      { source_stake: source, destination_stake: destination, staker_authority: stakerAuthority },
      pk(settlement),
    )
  }
}

/// Last error line of a failed transaction's logs.
export function errorOf(logs: string[]): string {
  const hit = [...logs].reverse().find(l => /AnchorError|Error Code|failed|custom program error/.test(l))
  return hit ?? logs[logs.length - 1] ?? 'no logs'
}

let failures = 0
export function check(name: string, cond: boolean, detail = ''): void {
  if (!cond) failures++
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}
export function section(title: string): void {
  console.log(`\n== ${title}`)
}
export function finish(): void {
  if (failures > 0) {
    console.log(`\n${failures} check(s) failed`)
    process.exit(1)
  }
  console.log('\nall checks passed')
}
export const fmt = (l: bigint): string => `${(Number(l) / 1e9).toFixed(9)} SOL`

/// System program transfer; `from` signs.
export function transferIx(from: KeyPairSigner, to: Address, amount: bigint): Instruction {
  return {
    programAddress: SYSTEM,
    accounts: [
      { address: from.address, role: AccountRole.WRITABLE_SIGNER, signer: from },
      { address: to, role: AccountRole.WRITABLE },
    ],
    data: cat(new Uint8Array([2, 0, 0, 0]), u64(amount)),
  } as Instruction
}

/// Names the failure: the Anchor error code when there is one, otherwise the last error line.
export function why(logs: string[]): string {
  const anchor = logs.find(l => l.includes('Error Code:'))
  if (anchor) return /Error Code: (\w+)/.exec(anchor)![1]!
  const custom = /custom program error: (0x[0-9a-f]+)/.exec(logs.join('\n'))
  if (custom) {
    const code = Number(custom[1])
    const known = IDL.errors.find((e: { code: number }) => e.code === code)
    return known ? known.name : `custom error ${custom[1]}`
  }
  return errorOf(logs)
}
