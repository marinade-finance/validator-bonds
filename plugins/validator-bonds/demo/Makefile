SHELL  := bash
DIR    := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
COLS   := 140
ROWS   := 35
IMAGE  := debian:bookworm

# prereqs: asciinema (pip install asciinema), agg (cargo install agg)
# auth:    export CLAUDE_CODE_OAUTH_TOKEN before running

DOCKER = docker run --rm -it \
    -e CLAUDE_CODE_OAUTH_TOKEN \
    -e TERM=xterm-256color \
    -e COLUMNS=$(COLS) \
    -e LINES=$(ROWS)

.PHONY: demo run-install clean

demo: install.gif

run-install:
	$(DOCKER) -v "$(DIR)install.sh:/demo.sh:ro" $(IMAGE) bash /demo.sh

install.cast:
	asciinema rec $@ --overwrite --cols $(COLS) --rows $(ROWS) -c \
	    'docker run --rm -it -v "$(DIR)install.sh:/demo.sh:ro" -e CLAUDE_CODE_OAUTH_TOKEN -e TERM=xterm-256color -e COLUMNS=$(COLS) -e LINES=$(ROWS) $(IMAGE) bash /demo.sh'

install.gif: install.cast
	agg $< $@

clean:
	rm -f install.cast install.gif
