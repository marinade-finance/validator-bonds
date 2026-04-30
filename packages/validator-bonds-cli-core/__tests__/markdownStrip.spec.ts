import { stripMarkdownForTerminal } from '../src/banner'

describe('stripMarkdownForTerminal', () => {
  it('rewrites markdown links to "label (url)"', () => {
    expect(
      stripMarkdownForTerminal(
        'See [the docs](https://docs.example.com/foo) for details.',
      ),
    ).toBe('See the docs (https://docs.example.com/foo) for details.')
  })

  it('drops the label when it is identical to the url', () => {
    expect(stripMarkdownForTerminal('[https://x.test](https://x.test)')).toBe(
      'https://x.test',
    )
  })

  it('strips bold and italic emphasis', () => {
    expect(stripMarkdownForTerminal('**bold** and *italic*')).toBe(
      'bold and italic',
    )
    expect(stripMarkdownForTerminal('__also bold__ and _also italic_')).toBe(
      'also bold and also italic',
    )
  })

  it('does not eat intra-word underscores', () => {
    expect(stripMarkdownForTerminal('user_id and ENV_VAR')).toBe(
      'user_id and ENV_VAR',
    )
  })

  it('strips inline code, strikethrough, headings and blockquotes', () => {
    expect(stripMarkdownForTerminal('use `npm install`')).toBe(
      'use npm install',
    )
    expect(stripMarkdownForTerminal('~~old~~ new')).toBe('old new')
    expect(stripMarkdownForTerminal('## Heading\nbody')).toBe('Heading\nbody')
    expect(stripMarkdownForTerminal('> a quote\n> second')).toBe(
      'a quote\nsecond',
    )
  })

  it('handles a realistic notification message', () => {
    const input =
      '**Action required**: top up your bond. See [the bond docs](https://docs.marinade.finance/bond) before epoch 965.'
    expect(stripMarkdownForTerminal(input)).toBe(
      'Action required: top up your bond. See the bond docs (https://docs.marinade.finance/bond) before epoch 965.',
    )
  })

  it('leaves plain text untouched', () => {
    expect(
      stripMarkdownForTerminal('Plain text — nothing to strip here.'),
    ).toBe('Plain text — nothing to strip here.')
  })
})
