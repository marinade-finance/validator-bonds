SHELL  := bash
DIR    := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
COLS   := 140
ROWS   := 35
IMAGE  := debian:bookworm

# prereqs: asciinema (pip install asciinema), agg (cargo install agg)

DOCKER = docker run --rm -it \
    -e CLAUDE_CODE_OAUTH_TOKEN \
    -e TERM=xterm-256color \
    -e COLUMNS=$(COLS) \
    -e LINES=$(ROWS)

.PHONY: demo record gif run-install run-qa clean

demo: install.gif qa.gif

# ── live runs (no recording) ──────────────────────────────────────────────────

run-install:
	$(DOCKER) -v "$(DIR)install.sh:/demo.sh:ro" $(IMAGE) bash /demo.sh

run-qa:
	$(DOCKER) -v "$(DIR)qa.sh:/demo.sh:ro" $(IMAGE) bash /demo.sh

# ── recordings ────────────────────────────────────────────────────────────────

record: install.cast qa.cast

install.cast:
	asciinema rec $@ --overwrite --cols $(COLS) --rows $(ROWS) -c \
	    'docker run --rm -it -v "$(DIR)install.sh:/demo.sh:ro" -e CLAUDE_CODE_OAUTH_TOKEN -e TERM=xterm-256color -e COLUMNS=$(COLS) -e LINES=$(ROWS) $(IMAGE) bash /demo.sh'

qa.cast:
	asciinema rec $@ --overwrite --cols $(COLS) --rows $(ROWS) -c \
	    'docker run --rm -it -v "$(DIR)qa.sh:/demo.sh:ro" -e CLAUDE_CODE_OAUTH_TOKEN -e TERM=xterm-256color -e COLUMNS=$(COLS) -e LINES=$(ROWS) $(IMAGE) bash /demo.sh'

# ── GIF conversion ────────────────────────────────────────────────────────────

gif: install.gif qa.gif

%.gif: %.cast
	agg $< $@

clean:
	rm -f install.cast qa.cast install.gif qa.gif
