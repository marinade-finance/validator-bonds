import { CliCommandError } from '@marinade.finance/cli-common'
import {
  Bond,
  bondAddress,
  getVoteAccountFromData,
  MARINADE_CONFIG_ADDRESS,
  ValidatorBondsProgram,
  WithdrawRequest,
  withdrawRequestAddress,
} from '@marinade.finance/validator-bonds-sdk'
import {
  programAccountInfo,
  ProgramAccountInfo,
} from '@marinade.finance/validator-bonds-sdk/src/web3.js/accounts'
import { AccountInfo, Connection, PublicKey } from '@solana/web3.js'
import { Logger } from 'pino'
import { setProgramIdByOwner } from '../context'

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
      'Account of type bond or voteAccount was not found'
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

  // If the address is a vote account, derive the bond account address from it
  if (voteAccountAddress !== null) {
    if (config === undefined) {
      config = MARINADE_CONFIG_ADDRESS
    }
    ;({ program } = await setProgramIdByOwner(address))
    ;[address] = bondAddress(config, voteAccountAddress, program.programId)
    const bondAccountInfo =
      await program.provider.connection.getAccountInfo(address)
    if (bondAccountInfo === null) {
      throw new CliCommandError({
        valueName: '[vote account address]:[bond account address]',
        value: voteAccountAddress.toBase58() + ':' + address.toBase58(),
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
      msg: 'Failed to fetch bond account data',
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
    const voteAccount = await getVoteAccountFromData(address, accountInfo)
    voteAccountAddress = voteAccount.publicKey
  } catch (e) {
    // Ignore error, we will try to fetch the address as the bond account data
    logger.debug(
      'Address is not a vote account, considering being it as a bond',
      e
    )
  }
  return voteAccountAddress
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
  let accountInfo = await checkAccountExistence(
    program.provider.connection,
    address,
    'Account of type withdrawRequest or bond or voteAccount was not found'
  )

  try {
    const withdrawRequestData = program.coder.accounts.decode<WithdrawRequest>(
      program.account.withdrawRequest.idlAccount.name,
      accountInfo.data
    )
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
    'Account of type withdrawRequest was not found'
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
      msg: errorMsg,
    })
  }
  return accountInfo
}
