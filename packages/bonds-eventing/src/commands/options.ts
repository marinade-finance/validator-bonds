import { InvalidArgumentError, Option } from 'commander'

import type { Command } from 'commander'

export function addSharedEventingOptions(command: Command): Command {
  return command
    .addOption(
      new Option('--bonds-api-url <url>', 'Validator bonds API base URL')
        .env('BONDS_API_URL')
        .default('https://validator-bonds-api.marinade.finance'),
    )
    .addOption(
      new Option(
        '--notifications-api-url <url>',
        'marinade-notifications base URL',
      ).env('NOTIFICATIONS_API_URL'),
    )
    .addOption(
      new Option(
        '--notifications-jwt <token>',
        'JWT for notifications API auth',
      ).env('NOTIFICATIONS_JWT'),
    )
    .addOption(
      new Option(
        '--directory-url <url>',
        'marinade-directory base URL (required)',
      ).env('DIRECTORY_URL'),
    )
    .addOption(
      new Option(
        '--directory-token <token>',
        'Bearer token for marinade-directory, granted /bonds/eventing/**:rw and /bonds/events/**:rw (required)',
      ).env('DIRECTORY_TOKEN'),
    )
    .addOption(
      new Option(
        '--retry-max-attempts <n>',
        'Max retries for notification POST',
      )
        .env('EVENTING_RETRY_MAX_ATTEMPTS')
        .default(4),
    )
    .addOption(
      new Option(
        '--retry-base-delay-ms <ms>',
        'Base delay for exponential backoff',
      )
        .env('EVENTING_RETRY_BASE_DELAY_MS')
        .default(30000),
    )
    .addOption(
      new Option(
        '--emit-concurrency <n>',
        'Number of events to POST in parallel',
      )
        .env('EVENTING_EMIT_CONCURRENCY')
        .default(20),
    )
    .addOption(
      booleanOption(
        '--dry-run',
        'Skip POST and DB write, just log events',
        'DRY_RUN',
      ),
    )
    .addOption(
      booleanOption(
        '--allow-empty-state',
        'Allow a first run with no previous state; every validator is first seen',
        'EVENTING_ALLOW_EMPTY_STATE',
      ),
    )
}

// Commander turns a plain boolean flag on whenever its env var is set, even to
// "false", so the flag takes an optional value parsed as true or false.
function booleanOption(flag: string, description: string, envVar: string) {
  return new Option(`${flag} [bool]`, description)
    .env(envVar)
    .preset('true')
    .argParser(parseBoolean)
    .default(false)
}

function parseBoolean(value: string): boolean {
  if (value === 'true') return true
  if (value === 'false') return false
  throw new InvalidArgumentError(`expected true or false, got '${value}'`)
}
