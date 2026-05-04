import { getBanner, normalizeBannerText, wrapLines } from '../src/banner'

describe('normalizeBannerText', () => {
  it('decodes &nbsp; into a regular space', () => {
    expect(normalizeBannerText('hello&nbsp;world')).toBe('hello world')
  })

  it('isolates a markdown link onto its own line', () => {
    expect(normalizeBannerText('see [docs](https://x.io) please')).toBe(
      'see \n[docs](https://x.io)\n please',
    )
  })

  it('keeps trailing punctuation attached to the link', () => {
    expect(normalizeBannerText('see [docs](https://x.io). please')).toBe(
      'see \n[docs](https://x.io).\n please',
    )
  })

  it('does not insert newlines when newlines are already adjacent', () => {
    const input = 'see\n[docs](https://x.io)\nplease'
    expect(normalizeBannerText(input)).toBe(input)
  })
})

describe('wrapLines', () => {
  it('returns the input unchanged when width is non-positive', () => {
    const input = ['anything goes here']
    expect(wrapLines(input, 0)).toBe(input)
    expect(wrapLines(input, -3)).toBe(input)
  })

  it('passes lines shorter than width through unchanged', () => {
    expect(wrapLines(['short line'], 80)).toEqual(['short line'])
  })

  it('wraps on word boundaries within width', () => {
    expect(wrapLines(['one two three four'], 7)).toEqual([
      'one two',
      'three',
      'four',
    ])
  })

  it('lets tokens longer than width overflow on their own line', () => {
    expect(wrapLines(['short verylongword tail'], 6)).toEqual([
      'short',
      'verylongword',
      'tail',
    ])
  })
})

describe('getBanner simple mode', () => {
  let originalColumns: number | undefined

  beforeEach(() => {
    originalColumns = process.stderr.columns
    Object.defineProperty(process.stderr, 'columns', {
      configurable: true,
      writable: true,
      value: 30,
    })
  })

  afterEach(() => {
    Object.defineProperty(process.stderr, 'columns', {
      configurable: true,
      writable: true,
      value: originalColumns,
    })
  })

  it('wraps a long title so no banner line exceeds the rule width', () => {
    const banner = getBanner({
      text: 'body',
      title: 'a really long banner title here',
      preferredWidth: 30,
      minWidth: 60,
    })
    const lines = banner.split('\n')
    const ruleLines = lines.filter(line => /^═+$/.test(line))
    expect(ruleLines.length).toBeGreaterThan(0)
    const widestLine = Math.max(...lines.map(line => line.length))
    const widestRule = Math.max(...ruleLines.map(line => line.length))
    expect(widestLine).toBeLessThanOrEqual(widestRule)
  })
})
