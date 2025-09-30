import { CLIContext } from '@marinade.finance/cli-common'
import { getContext, setContext } from '@marinade.finance/ts-common'

import type { CLIContextConfig } from '@marinade.finance/cli-common'

export type SanityCheckCLIContextConfig = CLIContextConfig

export class SanityCheckCLIContext extends CLIContext {
  constructor({ ...rest }: SanityCheckCLIContextConfig) {
    super(rest)
  }

  static define({
    logger,
    commandName,
  }: CLIContextConfig): SanityCheckCLIContext {
    const context = new CLIContext({
      logger,
      commandName,
    })
    setContext(context)
    return context
  }
}

export function getCliContext(): SanityCheckCLIContext {
  return getContext()
}
