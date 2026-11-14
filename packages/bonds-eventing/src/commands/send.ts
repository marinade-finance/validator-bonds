import { getContext } from '@marinade.finance/ts-common'
import { Argument } from 'commander'

import { addSendOptions } from './options'
import { logResolvedConfig, parseSendConfig } from '../config'
import { createEventingPool } from '../db'
import { loadPendingEvents, markEvent } from '../persist-events'
import { sendPendingEvents } from '../send-events'

import type { BondType } from '../types'
import type { Command } from 'commander'

export function installSend(program: Command) {
  addSendOptions(
    program
      .command('send')
      .description('Deliver pending bond events to marinade-notifications')
      .addArgument(
        new Argument('<bond_type>', 'Bond type to send').choices([
          'bidding',
          'institutional',
        ]),
      ),
  ).action(manageSend)
}

async function manageSend(bondType: BondType, opts: Record<string, unknown>) {
  const { logger } = getContext()
  const config = parseSendConfig(opts)

  logResolvedConfig(logger, config)

  const pool = await createEventingPool(
    config.postgresUrl,
    config.postgresSslRootCert,
  )
  try {
    const rows = await loadPendingEvents(pool, bondType)
    const summary = await sendPendingEvents(
      rows,
      (id, result) => markEvent(pool, id, result),
      config,
      logger,
    )
    logger.info(summary, `Send complete for ${bondType}`)
  } finally {
    await pool.end()
  }
}
