import { ProgramAccount } from '@coral-xyz/anchor'
import { PublicKey } from '@solana/web3.js'
import { ValidatorBondsProgram, Config, Bond, WithdrawRequest } from './sdk'
import BN from 'bn.js'
import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes'

// TODO:
//   - users can create arbitrary stake accounts (even with lockups), sdk must be prepared for that when showing total usable deposits

export async function getConfig(
  program: ValidatorBondsProgram,
  address: PublicKey
): Promise<Config> {
  return program.account.config.fetch(address)
}

export async function findConfigs({
  program,
  adminAuthority,
  operatorAuthority,
}: {
  program: ValidatorBondsProgram
  adminAuthority?: PublicKey
  operatorAuthority?: PublicKey
}): Promise<ProgramAccount<Config>[]> {
  const filters = []
  if (adminAuthority) {
    filters.push({
      memcmp: {
        bytes: adminAuthority.toBase58(),
        // 8 anchor offset
        offset: 8,
      },
    })
  }
  if (operatorAuthority) {
    filters.push({
      memcmp: {
        bytes: operatorAuthority.toBase58(),
        // 8 anchor offset + first data 32B admin pubkey
        offset: 40,
      },
    })
  }
  return await program.account.config.all(filters)
}

export async function getBond(
  program: ValidatorBondsProgram,
  address: PublicKey
): Promise<Bond> {
  return program.account.bond.fetch(address)
}

export async function findBonds({
  program,
  config,
  validatorVoteAccount,
  bondAuthority,
}: {
  program: ValidatorBondsProgram
  config?: PublicKey
  validatorVoteAccount?: PublicKey
  bondAuthority?: PublicKey
}): Promise<ProgramAccount<Bond>[]> {
  const filters = []
  if (config) {
    filters.push({
      memcmp: {
        bytes: config.toBase58(),
        // 8 anchor offset
        offset: 8,
      },
    })
  }
  if (validatorVoteAccount) {
    filters.push({
      memcmp: {
        bytes: validatorVoteAccount.toBase58(),
        // 8 anchor offset + first data 32B config pubkey
        offset: 40,
      },
    })
  }
  if (bondAuthority) {
    filters.push({
      memcmp: {
        bytes: bondAuthority.toBase58(),
        // 8 anchor offset + 32B config pubkey + 32B validator vote pubkey
        offset: 72,
      },
    })
  }
  return await program.account.bond.all(filters)
}

export async function getWithdrawRequest(
  program: ValidatorBondsProgram,
  address: PublicKey
): Promise<WithdrawRequest> {
  return program.account.withdrawRequest.fetch(address)
}

export async function findWithdrawRequests({
  program,
  validatorVoteAccount,
  bond,
  epoch,
}: {
  program: ValidatorBondsProgram
  validatorVoteAccount?: PublicKey
  bond?: PublicKey
  epoch?: number | BN
}): Promise<ProgramAccount<WithdrawRequest>[]> {
  const filters = []
  if (validatorVoteAccount) {
    filters.push({
      memcmp: {
        bytes: validatorVoteAccount.toBase58(),
        // 8 anchor offset
        offset: 8,
      },
    })
  }
  if (bond) {
    filters.push({
      memcmp: {
        bytes: bond.toBase58(),
        // 8 anchor offset + 32B validator vote pubkey
        offset: 40,
      },
    })
  }
  if (epoch) {
    filters.push({
      memcmp: {
        bytes: bs58.encode(new BN(epoch).toArray('le', 8)),
        // 8 anchor offset + 32B validator vote pubkey + 32B bond pubkey
        offset: 72,
      },
    })
  }
  return await program.account.withdrawRequest.all(filters)
}
