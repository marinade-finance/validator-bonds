#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "pyyaml",
#   "matplotlib",
#   "numpy",
# ]
# ///
"""Render report.yml → report.png: epoch-level SAM fee simulation chart."""

import yaml
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import numpy as np

REPORT = "report.yml"
OUT = "report.png"

C_ACTUAL  = "steelblue"
C_REF     = "slategray"
C_CAP     = "seagreen"
C_MINFEE  = "mediumpurple"
C_COST    = "firebrick"


def pct(s):
    return float(str(s).rstrip("%"))


def ratio(s):
    a, b = str(s).split("/")
    return int(a) / int(b) * 100 if int(b) else 0


def load():
    with open(REPORT) as f:
        data = yaml.safe_load(f)
    epochs, ssr_apy, apy_adj, apy_max = [], [], [], []
    fee_adj, fee_max, vcap, vmin = [], [], [], []
    for e in data["epochs"]:
        sim = e["simulations"][0]
        epochs.append(e["epoch"])
        ssr_apy.append(pct(e["ssr_apy"]))
        apy_adj.append(pct(sim["apy_adj"]))
        apy_max.append(pct(sim["apy_max"]))
        fee_adj.append(sim["fee_sol_adj"])
        fee_max.append(sim["fee_sol_max"])
        vcap.append(ratio(sim["validators_capped"]))
        vmin.append(ratio(sim.get("validators_at_min_fee", "0/1")))
    return epochs, ssr_apy, apy_adj, apy_max, fee_adj, fee_max, vcap, vmin


def main():
    epochs, ssr_apy, apy_adj, apy_max, fee_adj, fee_max, vcap, vmin = load()
    x = np.array(epochs)
    xs = np.arange(len(x))
    shortfall = [mx - adj for mx, adj in zip(fee_max, fee_adj)]

    plt.style.use("seaborn-v0_8-whitegrid")
    fig = plt.figure(figsize=(14, 13))
    fig.suptitle(
        f"Marinade Validator Bond Fee Simulation · Epochs {epochs[0]}–{epochs[-1]}",
        fontsize=16, fontweight="bold", y=0.98,
    )

    gs = fig.add_gridspec(
        3, 2,
        height_ratios=[2, 2, 1],
        hspace=0.55, wspace=0.30,
        left=0.07, right=0.97, top=0.94, bottom=0.05,
    )

    def style(ax, title, ylabel):
        ax.set_title(title, fontsize=11, fontweight="semibold", pad=6)
        ax.set_ylabel(ylabel, fontsize=10)
        ax.tick_params(labelsize=9)
        ax.set_xticks(xs)
        ax.set_xticklabels(x, rotation=45, ha="right", fontsize=9)

    # ── 1. APY band (full width) ───────────────────────────────────────────────
    ax1 = fig.add_subplot(gs[0, :])
    style(ax1, "Post-Fee APY  (adjusted · SSR baseline · max-fee cap)", "APY %")
    ax1.plot(xs, ssr_apy, lw=1.8, ls="--", color=C_REF,    label="SSR baseline", zorder=3)
    ax1.plot(xs, apy_adj, lw=2.2,           color=C_ACTUAL, label="Adjusted",     zorder=4)
    ax1.plot(xs, apy_max, lw=1.5, ls=":",   color=C_REF,    label="Max-fee cap",  zorder=3)
    ax1.fill_between(xs, apy_max, apy_adj, color=C_ACTUAL, alpha=0.08, label="Adj–Max spread")
    for i in range(len(x)):
        ax1.annotate(f"{apy_adj[i]:.2f}", (xs[i], apy_adj[i]),
                     textcoords="offset points", xytext=(0, 6),
                     fontsize=8, ha="center", color=C_ACTUAL)
    ax1.legend(fontsize=9, loc="lower left", ncol=4)
    ax1.yaxis.set_major_formatter(mticker.FormatStrFormatter("%.2f%%"))

    # ── 2. Fee extraction (full width) ────────────────────────────────────────
    ax2 = fig.add_subplot(gs[1, :])
    style(ax2, "Marinade Fee Extraction (SOL)", "SOL")
    w = 0.35
    ax2.bar(xs - w/2, fee_adj, w, color=C_ACTUAL, alpha=0.85, label="Adjusted")
    ax2.bar(xs + w/2, fee_max, w, color=C_REF,    alpha=0.70, label="Max-fee cap")
    for i, v in enumerate(fee_adj):
        ax2.annotate(f"{v:.0f}", (xs[i] - w/2, v),
                     textcoords="offset points", xytext=(0, 4),
                     fontsize=8, ha="center")
    ax2.legend(fontsize=9)
    ax2.yaxis.set_major_formatter(mticker.FuncFormatter(lambda v, _: f"{v:.0f}"))

    # ── 3a. Validators at cap / at min fee ────────────────────────────────────
    ax3 = fig.add_subplot(gs[2, 0])
    style(ax3, "Validators at Cap / at Min Fee (%)", "%")
    ax3.fill_between(xs, vcap, alpha=0.10, color=C_CAP)
    ax3.plot(xs, vcap, lw=2, marker="o", markersize=4, color=C_CAP,     label="At cap")
    ax3.fill_between(xs, vmin, alpha=0.10, color=C_MINFEE)
    ax3.plot(xs, vmin, lw=1.8, marker="s", markersize=4, color=C_MINFEE, label="At min fee")
    ax3.axhline(100, color="gray", lw=0.8, ls=":")
    ax3.set_ylim(0, 115)
    ax3.legend(fontsize=9)
    ax3.yaxis.set_major_formatter(mticker.FuncFormatter(lambda v, _: f"{v:.0f}%"))

    # ── 3b. Shortfall ─────────────────────────────────────────────────────────
    ax4 = fig.add_subplot(gs[2, 1])
    style(ax4, f"Shortfall vs Max Fee (SOL)  [total: {sum(shortfall):.0f} SOL]", "SOL")
    ax4.bar(xs, shortfall, color=C_COST, alpha=0.80)
    for i, v in enumerate(shortfall):
        ax4.annotate(f"{v:.0f}", (xs[i], v),
                     textcoords="offset points", xytext=(0, 4),
                     fontsize=8, ha="center")
    ax4.yaxis.set_major_formatter(mticker.FuncFormatter(lambda v, _: f"{v:.0f}"))

    fig.text(0.5, 0.01, "max_fee_bps = 800 · source: report.yml",
             ha="center", fontsize=9, color="gray")

    fig.savefig(OUT, dpi=160, bbox_inches="tight")
    print(f"saved → {OUT}")


if __name__ == "__main__":
    main()
