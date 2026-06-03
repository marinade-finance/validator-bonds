#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "pyyaml",
#   "matplotlib",
#   "numpy",
# ]
# ///
"""Render report.yml → report.png: epoch-level Marinade fee extraction chart."""

import yaml
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import numpy as np

REPORT = "report.yml"
OUT = "report.png"

C_FEE  = "steelblue"
C_LOSS = "firebrick"


def load():
    with open(REPORT) as f:
        data = yaml.safe_load(f)
    epochs, fee_adj, fee_max = [], [], []
    for e in data["epochs"]:
        sim = e["simulations"][0]
        epochs.append(e["epoch"])
        fee_adj.append(sim["fee_sol_adj"])
        fee_max.append(sim["fee_sol_max"])
    return epochs, fee_adj, fee_max


def main():
    epochs, fee_adj, fee_max = load()
    x = np.array(epochs)
    xs = np.arange(len(x))
    shortfall = [mx - adj for mx, adj in zip(fee_max, fee_adj)]

    plt.style.use("seaborn-v0_8-whitegrid")
    fig = plt.figure(figsize=(14, 9))
    fig.suptitle(
        f"Marinade Fee Extraction · Epochs {epochs[0]}–{epochs[-1]}",
        fontsize=16, fontweight="bold", y=0.98,
    )

    gs = fig.add_gridspec(
        2, 1,
        height_ratios=[3, 1],
        hspace=0.45,
        left=0.07, right=0.97, top=0.93, bottom=0.06,
    )

    def xticks(ax):
        ax.set_xticks(xs)
        ax.set_xticklabels(x, rotation=45, ha="right", fontsize=10)
        ax.tick_params(labelsize=10)

    # ── 1. Extraction (big) ────────────────────────────────────────────────────
    ax1 = fig.add_subplot(gs[0])
    ax1.set_title("Fee Extraction (SOL)", fontsize=12, fontweight="semibold", pad=6)
    ax1.set_ylabel("SOL", fontsize=11)
    xticks(ax1)
    ax1.bar(xs, fee_adj, color=C_FEE, alpha=0.85)
    for i, v in enumerate(fee_adj):
        ax1.annotate(f"{v:.0f}", (xs[i], v),
                     textcoords="offset points", xytext=(0, 5),
                     fontsize=9, ha="center")
    ax1.yaxis.set_major_formatter(mticker.FuncFormatter(lambda v, _: f"{v:.0f}"))

    # ── 2. Loss / shortfall (small) ───────────────────────────────────────────
    ax2 = fig.add_subplot(gs[1])
    ax2.set_title(
        f"Shortfall vs Max Fee (SOL)  [total: {sum(shortfall):.0f} SOL]",
        fontsize=11, fontweight="semibold", pad=6,
    )
    ax2.set_ylabel("SOL", fontsize=11)
    xticks(ax2)
    ax2.bar(xs, shortfall, color=C_LOSS, alpha=0.75)
    for i, v in enumerate(shortfall):
        ax2.annotate(f"{v:.0f}", (xs[i], v),
                     textcoords="offset points", xytext=(0, 4),
                     fontsize=8.5, ha="center")
    ax2.yaxis.set_major_formatter(mticker.FuncFormatter(lambda v, _: f"{v:.0f}"))

    fig.text(0.5, 0.01, "max_fee_bps = 800 · source: report.yml",
             ha="center", fontsize=9, color="gray")

    fig.savefig(OUT, dpi=160, bbox_inches="tight")
    print(f"saved → {OUT}")


if __name__ == "__main__":
    main()
