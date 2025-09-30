import { CliCommandError } from '@marinade.finance/cli-common'
import { loadFile } from '@marinade.finance/ts-common'
import Decimal from 'decimal.js'

import { getCliContext } from '../context'
import { parseSettlementMerkleTree } from '../dtoMerkleTree'
import { parseSettlements } from '../dtoSettlements'

import type { Command } from 'commander'

export function installCheckSettlement(program: Command) {
  program
    .command('check-settlement')
    .description(
      'Check settlements.json and settlement-merkle-trees.json consistency',
    )
    .requiredOption('-s, --settlements <path>', 'Path to settlements.json file')
    .requiredOption(
      '-m, --merkle-trees <path>',
      'Path to settlement-merkle-trees.json file',
    )
    .action(
      async ({
        settlements,
        merkleTrees,
      }: {
        settlements: string
        merkleTrees: string
      }) => {
        await manageCheckSettlement({
          settlementsPath: settlements,
          merkleTreesPath: merkleTrees,
        })
      },
    )
}

async function manageCheckSettlement({
  settlementsPath,
  merkleTreesPath,
}: {
  settlementsPath: string
  merkleTreesPath: string
}) {
  const { logger } = getCliContext()
  logger.info(
    `Loading settlement and merkle tree files [${settlementsPath}, ${merkleTreesPath}]`,
  )

  const settlementsData = await loadFile(settlementsPath)
  const merkleTreesData = await loadFile(merkleTreesPath)

  const settlements = await parseSettlements(settlementsData, settlementsPath)
  const merkleTrees = await parseSettlementMerkleTree(
    merkleTreesData,
    merkleTreesPath,
  )

  logger.debug(
    `Loaded settlements from ${settlementsPath} and merkle trees from ${merkleTreesPath}`,
  )

  // Check 0: Epoch comparison
  if (settlements.epoch !== merkleTrees.epoch) {
    throw CliCommandError.instance(
      `Mismatch in epochs: Settlements(${settlements.epoch}) vs Merkle Trees(${merkleTrees.epoch})`,
    )
  } else {
    logger.info(`Epochs match: ${settlements.epoch}`)
  }

  // Check 1: Count comparison
  const settlementsCount = settlements.settlements.length
  const merkleTreesCount = merkleTrees.merkle_trees.length
  if (settlementsCount !== merkleTreesCount) {
    throw CliCommandError.instance(
      `Mismatch in number of settlements and merkle tree count: Settlements(${settlementsCount}) vs Merkle Trees(${merkleTreesCount})`,
    )
  }
  logger.info(`✓ Count [${settlementsCount}] check passed`)

  // Check 2: Sum comparison
  const settlementsSum = settlements.settlements.reduce((total, settlement) => {
    const settlementSum = settlement.claims.reduce(
      (sum, claim) => sum.plus(claim.claim_amount),
      new Decimal(0),
    )
    return total.plus(settlementSum)
  }, new Decimal(0))

  const merkleTreesSum = merkleTrees.merkle_trees.reduce(
    (total, tree) => total.plus(new Decimal(tree.max_total_claim_sum)),
    new Decimal(0),
  )

  logger.info(
    `Settlements sum: ${settlementsSum.toString()}, Merkle trees sum: ${merkleTreesSum.toString()}`,
  )

  if (!settlementsSum.equals(merkleTreesSum)) {
    const errorMsg =
      `Mismatch in total settlements and merkle tree claim amount: Settlements(${settlementsSum.toString()}) ` +
      `vs Merkle Trees(${merkleTreesSum.toString()})`
    logger.error(errorMsg)
    throw CliCommandError.instance(errorMsg)
  }

  logger.info('✓ Sum check passed')
}
