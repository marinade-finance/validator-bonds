import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { join } from 'node:path'

const PACKAGE_DIR = join(__dirname, '..')
const REPO_ROOT = join(__dirname, '..', '..', '..')
const INJECT_SCRIPT = join(REPO_ROOT, 'scripts', 'inject-mixpanel-token.js')
const DIST_CLIUSAGE = join(PACKAGE_DIR, 'dist', 'src', 'cliUsage.js')

describe('inject-mixpanel-token.js round-trip', () => {
  let tmpDir: string

  beforeAll(() => {
    if (!existsSync(DIST_CLIUSAGE)) {
      throw new Error(
        `Missing ${DIST_CLIUSAGE}; run "pnpm build" before "pnpm test".`,
      )
    }
    // Place the temp probe under PACKAGE_DIR (not OS tmpdir) so Node's
    // upward node_modules walk from the required file reaches the workspace
    // store.
    tmpDir = mkdtempSync(join(PACKAGE_DIR, '.tmp-mp-inject-'))
  })

  afterAll(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  })

  it('replaces only BUILD_TIME_MIXPANEL_TOKEN and getMixpanelToken returns it', () => {
    const tmpDistSrc = join(tmpDir, 'dist', 'src')
    mkdirSync(tmpDistSrc, { recursive: true })
    const tmpFile = join(tmpDistSrc, 'cliUsage.js')
    copyFileSync(DIST_CLIUSAGE, tmpFile)

    execFileSync('node', [INJECT_SCRIPT], {
      cwd: tmpDir,
      env: { ...process.env, MIXPANEL_TOKEN: 'specinjectedtoken' },
    })

    const after = readFileSync(tmpFile, 'utf-8')
    expect(after).toContain('specinjectedtoken')
    expect(after).not.toContain('__MIXPANEL_TOKEN_PLACEHOLDER__')

    const probe = `
      delete process.env.MIXPANEL_TOKEN_TEST;
      const m = require(${JSON.stringify(tmpFile)});
      process.stdout.write(JSON.stringify({
        token: m.getMixpanelToken() ?? null,
        disabled: m.isTelemetryDisabled(),
      }));
    `
    const probeEnv = { ...process.env }
    delete probeEnv.MIXPANEL_TOKEN_TEST
    const stdout = execFileSync('node', ['-e', probe], {
      cwd: PACKAGE_DIR,
      env: probeEnv,
    }).toString()
    const result = JSON.parse(stdout) as {
      token: string | null
      disabled: boolean
    }
    expect(result.token).toBe('specinjectedtoken')
    expect(result.disabled).toBe(false)
  })
})
