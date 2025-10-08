import { CLIContext } from '@marinade.finance/cli-common'
import { getContext, loadFile, setContext } from '@marinade.finance/ts-common'

import type { CLIContextConfig } from '@marinade.finance/cli-common'

export type SanityCheckCLIContextConfig = CLIContextConfig & {
  currentPath: string
  currentData: string
}

export type SanityCheckCLIContextConfigInputParams = Omit<
  SanityCheckCLIContextConfig,
  'currentData'
>

export class SanityCheckCLIContext extends CLIContext {
  currentPath: string
  currentData: string

  constructor({
    currentPath,
    currentData,
    ...rest
  }: SanityCheckCLIContextConfig) {
    super(rest)

    this.currentPath = currentPath
    this.currentData = currentData
  }

  static async define({
    logger,
    commandName,
    currentPath,
  }: SanityCheckCLIContextConfigInputParams): Promise<SanityCheckCLIContext> {
    const currentData = await loadFile(currentPath)
    const context = new SanityCheckCLIContext({
      logger,
      commandName,
      currentPath,
      currentData,
    })
    setContext(context)
    return context
  }
}

export function getCliContext(): SanityCheckCLIContext {
  return getContext()
}
