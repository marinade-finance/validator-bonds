# Validator Bonds Plugin Demos

Two demos. `install` is automated. `qa` is recorded by hand — the answer
varies per run and benefits from a human watching it land.

## install — plugin install from GitHub

Shows: fresh Debian box → install Claude Code → add Marinade marketplace →
install validator-bonds plugin → `claude plugins list`.

```
make install.gif        # record + convert
make run-install        # live run (no recording)
```

## qa — asking the skill a hard question

**Intent:** show that the plugin answers a concrete, non-trivial validator
economics question using exact formulas — not generic advice. The question
combines auction mechanics, bond sizing, and profitability in one shot.

**Question to ask (interactive Claude session after installing the plugin):**

> I want 1,000,000 SOL of Marinade stake on my validator.
> What totalPmpe do I need to win the auction, what minimum bond balance must
> I hold at all times, what does my bid cost me per epoch in SOL, and can I
> be profitable — does the extra stake revenue outweigh the bid and bond
> opportunity cost? Show the formulas. Assume relaxedTotalPmpe = 140,
> bidPmpe = 50, typical epoch rewards ~0.00001 SOL per SOL staked.

**To record:**

```sh
# install the plugin in your local Claude first (or use --plugin-dir for local):
claude plugins marketplace add marinade-finance/validator-bonds
claude plugins install validator-bonds

# start recording, then type the question above interactively:
asciinema rec qa.cast --cols 140 --rows 35
claude
# ... paste question, let it answer, exit
# Ctrl-D to stop recording

agg qa.cast qa.gif
```

For local (pre-merge) testing, substitute:

```sh
asciinema rec qa.local.cast --cols 140 --rows 35
claude --plugin-dir /path/to/plugins/validator-bonds
```
