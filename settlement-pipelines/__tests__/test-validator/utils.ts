import { spawn } from 'child_process'

export async function cargoRun(
  args: string[],
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('cargo', ['run', '--bin', ...args])
    let stderr = ''
    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })
    child.stdout.resume()
    child.on('error', reject)
    child.on('close', code => resolve({ code, stderr }))
  })
}

// stake program 0x10 (EpochRewardsActive) rejects stake changes while an epoch pays out rewards
export function onlyEpochRewardsActiveFailures(stderr: string): boolean {
  const failures = stderr.match(/^.*\(source: transaction_execution\)/gm) ?? []
  return (
    failures.length > 0 &&
    failures.every(f =>
      /: failed(?: in \S+)?: .*custom program error: 0x10\b/.test(f),
    )
  )
}
