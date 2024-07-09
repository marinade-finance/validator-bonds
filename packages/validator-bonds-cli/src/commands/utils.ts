import { CliCommandError } from '@marinade.finance/cli-common'
import {
  Bond,
  bondAddress,
  MARINADE_CONFIG_ADDRESS,
  ValidatorBondsProgram,
  WithdrawRequest,
  withdrawRequestAddress,
} from '@marinade.finance/validator-bonds-sdk'
import {
  programAccountInfo,
  ProgramAccountInfo,
  getVoteAccountFromData,
} from '@marinade.finance/web3js-common'
import {
  AccountInfo,
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
} from '@solana/web3.js'
import { Logger } from 'pino'
import { setProgramIdByOwner } from '../context'
import BN from 'bn.js'

/**
 * Expecting the provided address is a bond or vote account,
 * returns the account info of the (derived) bond account.
 */
export async function getBondFromAddress({
  address,
  program,
  logger,
  config,
}: {
  program: ValidatorBondsProgram
  address: PublicKey | ProgramAccountInfo<Buffer>
  logger: Logger
  config: PublicKey | undefined
}): Promise<ProgramAccountInfo<Bond>> {
  let accountInfo: AccountInfo<Buffer>
  if (address instanceof PublicKey) {
    accountInfo = await checkAccountExistence(
      program.provider.connection,
      address,
      'Account of type bond or voteAccount or withdrawRequest was not found'
    )
  } else {
    accountInfo = address.account
    address = address.publicKey
  }

  const voteAccountAddress = await isVoteAccount({
    address,
    accountInfo,
    logger,
  })

  if (voteAccountAddress === null) {
    // it could be withdraw request address or bond, let's try to decode it as withdraw request
    let withdrawRequestData: WithdrawRequest | undefined = undefined
    const withdrawRequestAddress = address
    try {
      withdrawRequestData = decodeWithdrawRequest({ program, accountInfo })
      address = withdrawRequestData.bond
    } catch (e) {
      logger.debug(`Failed to decode account ${address} as withdraw request`, e)
    }
    // we found the provided address as the withdraw request, let's check the bond account
    if (withdrawRequestData !== undefined) {
      const bondAccountInfo =
        await program.provider.connection.getAccountInfo(address)
      if (bondAccountInfo === null) {
        throw new CliCommandError({
          valueName: '[withdraw request address]|[bond address]',
          value: `${withdrawRequestAddress.toBase58()}|${address.toBase58()}`,
          msg: 'Bond account address taken from provided withdraw request was not found',
        })
      }
      accountInfo = bondAccountInfo
    }
  }

  // If the address is a vote account, derive the bond account address from it
  if (voteAccountAddress !== null) {
    if (config === undefined) {
      config = MARINADE_CONFIG_ADDRESS
    }
    ;({ program } = await setProgramIdByOwner(config))
    ;[address] = bondAddress(config, voteAccountAddress, program.programId)
    const bondAccountInfo =
      await program.provider.connection.getAccountInfo(address)
    if (bondAccountInfo === null) {
      throw new CliCommandError({
        valueName: '[vote account address]|[bond address]',
        value: `${voteAccountAddress.toBase58()}|${address.toBase58()}`,
        msg: 'Bond account address derived from provided vote account was not found',
      })
    }
    accountInfo = bondAccountInfo
  }

  if (accountInfo === null) {
    throw new CliCommandError({
      valueName: '[address]',
      value: address.toBase58(),
      msg: 'Address is neither a vote account nor a bond account',
    })
  }

  // Decode data from the account info
  try {
    const bondData = program.coder.accounts.decode<Bond>(
      program.account.bond.idlAccount.name,
      accountInfo.data
    )
    return programAccountInfo(address, accountInfo, bondData)
  } catch (e) {
    throw new CliCommandError({
      valueName: '[address]',
      value: address.toBase58(),
      msg: 'Failed to decode the address as bond account data. It is not a bond, vote, or withdraw account.',
      cause: e as Error,
    })
  }
}

/**
 * Check if the address and data is a vote account
 */
async function isVoteAccount({
  address,
  accountInfo,
  logger,
}: {
  address: PublicKey
  accountInfo: AccountInfo<Buffer>
  logger: Logger
}) {
  // Check if the address is a vote account
  let voteAccountAddress = null
  try {
    const voteAccount = getVoteAccountFromData(address, accountInfo)
    voteAccountAddress = voteAccount.publicKey
  } catch (e) {
    // Ignore error, we will try to fetch the address as the bond account data
    logger.debug(
      'Address is not a vote account, considering being it a bond',
      e
    )
  }
  return voteAccountAddress
}

/**
 * Check if the address and data is a withdraw request.
 * If not throwing exception, returns the withdraw request data.
 */
function decodeWithdrawRequest({
  program,
  accountInfo,
}: {
  program: ValidatorBondsProgram
  accountInfo: AccountInfo<Buffer>
}): WithdrawRequest {
  return program.coder.accounts.decode<WithdrawRequest>(
    program.account.withdrawRequest.idlAccount.name,
    accountInfo.data
  )
}

/**
 * Expecting the provided address is a withdraw request or bond or vote account,
 * returns the account info of the (derived) bond account.
 */
export async function getWithdrawRequestFromAddress({
  address,
  program,
  logger,
  config,
}: {
  program: ValidatorBondsProgram
  address: PublicKey
  logger: Logger
  config: PublicKey | undefined
}): Promise<ProgramAccountInfo<WithdrawRequest>> {
  let accountInfo: AccountInfo<Buffer> = await checkAccountExistence(
    program.provider.connection,
    address,
    'type of voteAccount or bond or withdrawRequest'
  )

  try {
    const withdrawRequestData = decodeWithdrawRequest({ program, accountInfo })
    return programAccountInfo(address, accountInfo, withdrawRequestData)
  } catch (e) {
    logger.debug(`Failed to decode account ${address} as withdraw request`, e)
  }

  let bondAccountAddress = address
  const voteAccountAddress = await isVoteAccount({
    address,
    accountInfo,
    logger,
  })

  ;({ program } = await setProgramIdByOwner(address))
  if (voteAccountAddress !== null) {
    if (config === undefined) {
      config = MARINADE_CONFIG_ADDRESS
    }
    ;[bondAccountAddress] = bondAddress(
      config,
      voteAccountAddress,
      program.programId
    )
  }

  ;[address] = withdrawRequestAddress(bondAccountAddress, program.programId)

  accountInfo = await checkAccountExistence(
    program.provider.connection,
    address,
    'type of withdrawRequest'
  )

  // final decoding of withdraw request account from account info
  // Decode data from the account info
  try {
    const withdrawRequestData = program.coder.accounts.decode<WithdrawRequest>(
      program.account.withdrawRequest.idlAccount.name,
      accountInfo.data
    )
    return programAccountInfo(address, accountInfo, withdrawRequestData)
  } catch (e) {
    throw new CliCommandError({
      valueName: '[address]',
      value: address.toBase58(),
      msg: 'Failed to fetch withdraw request account data',
      cause: e as Error,
    })
  }
}

export function formatToSol(value: BN | number | BigInt): string {
  return `${formatLamportsToSol(value)} ${formatUnit(value, 'SOL')}`
}

function formatLamportsToSol(value: BN | number | BigInt): string {
  value = new BN(value.toString())
  const { div, mod } = new BN(value).divmod(new BN(LAMPORTS_PER_SOL))
  return `${div.toString()}.${mod
    .abs()
    .toString()
    .padStart(Math.log10(LAMPORTS_PER_SOL), '0')}`
}

export function formatUnit(value: BN | number | BigInt, unit: string): string {
  value = new BN(value.toString())
  if (value.eq(new BN(0)) || value.eq(new BN(1))) {
    return unit
  } else {
    return unit + 's'
  }
}

async function checkAccountExistence(
  connection: Connection,
  address: PublicKey,
  errorMsg: string
): Promise<AccountInfo<Buffer>> {
  const accountInfo = await connection.getAccountInfo(address)
  if (accountInfo === null) {
    throw new CliCommandError({
      valueName: '[address]',
      value: address.toBase58(),
      msg: `Address does not exist at ${connection.rpcEndpoint}: ` + errorMsg,
    })
  }
  return accountInfo
}
