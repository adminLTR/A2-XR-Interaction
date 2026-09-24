from __future__ import annotations

import csv
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
FIG_DIR = ROOT / "figures"

OUTLIER_SEC = 300.0

VR = ("vr-grab", "vr-trackball", "vr-gizmo")
DOF = ("desktop-1", "vr-grab")

SHORT = {
    "desktop-1": "Desktop 1 (mouse)",
    "vr-grab": "VR grab",
    "vr-trackball": "VR trackball",
    "vr-gizmo": "VR gizmo",
}

COLORS = {
    "desktop-1": "#4C78A8",
    "vr-grab": "#54A24B",
    "vr-trackball": "#EECA3B",
    "vr-gizmo": "#B279A2",
}

METRICS = (
    ("completion_time_s", "Completion time (s)", "completion_time"),
    ("final_position_error", "Position error (scene units)", "position_error"),
    ("final_orientation_error_deg", "Orientation error (degrees)", "orientation_error"),
)

NUMERIC = (
    "trial_number",
    "presentation_order",
    "completion_time_s",
    "final_position_error",
    "final_orientation_error_deg",
    "mode_switches",
    "path_length",
)


def _parse_float(raw: str) -> float | None:
    s = (raw or "").strip()
    return float(s) if s else None


def _normalize_desktop_mapping(raw: str) -> str | None:
    m = (raw or "").strip()
    if m in ("1", "desktop-1"):
        return "desktop-1"
    if m in ("2", "desktop-2"):
        return "desktop-2"
    return None


def load_desktop() -> list[dict]:
    rows: list[dict] = []
    for path in sorted(DATA_DIR.glob("a1_P*.csv")):
        with path.open(newline="", encoding="utf-8") as fh:
            for raw in csv.DictReader(fh):
                mapping = _normalize_desktop_mapping(str(raw.get("mapping", "")))
                if mapping is None:
                    continue
                row = dict(raw)
                row["mapping"] = mapping
                row["condition"] = mapping
                for key in NUMERIC:
                    v = row.get(key, "")
                    if key in ("mode_switches", "trial_number", "presentation_order"):
                        row[key] = int(float(v)) if str(v).strip() else 0
                    else:
                        row[key] = float(v) if str(v).strip() else 0.0
                row["interrupted"] = row["completion_time_s"] > OUTLIER_SEC
                rows.append(row)
    return rows


def load_vr() -> list[dict]:
    rows: list[dict] = []
    for path in sorted(DATA_DIR.glob("a2_*.csv")):
        with path.open(newline="", encoding="utf-8") as fh:
            for raw in csv.DictReader(fh):
                mapping = (raw.get("mapping") or "").strip()
                if mapping not in VR:
                    continue
                t = _parse_float(raw.get("completion_time_s", ""))
                p = _parse_float(raw.get("final_position_error", ""))
                o = _parse_float(raw.get("final_orientation_error_deg", ""))
                if t is None or p is None or o is None:
                    continue
                row = dict(raw)
                row["mapping"] = mapping
                row["condition"] = mapping
                row["trial_number"] = int(float(row["trial_number"]))
                row["presentation_order"] = int(float(row["presentation_order"]))
                row["completion_time_s"] = t
                row["final_position_error"] = p
                row["final_orientation_error_deg"] = o
                row["mode_switches"] = int(_parse_float(row.get("mode_switches", "0")) or 0)
                row["path_length"] = _parse_float(row.get("path_length", "0")) or 0.0
                row["interrupted"] = t > OUTLIER_SEC
                rows.append(row)
    return rows


def rows_for_metric(rows: list[dict], field: str) -> list[dict]:
    if field == "completion_time_s":
        return [r for r in rows if not r["interrupted"]]
    return rows


def values(rows: list[dict], condition: str, field: str) -> np.ndarray:
    subset = [r for r in rows if r["condition"] == condition]
    return np.array([r[field] for r in subset], dtype=float)


def mean_sd(vals: np.ndarray) -> tuple[float, float]:
    if len(vals) == 0:
        return float("nan"), float("nan")
    sd = float(np.std(vals, ddof=1)) if len(vals) > 1 else 0.0
    return float(np.mean(vals)), sd


def _style() -> None:
    plt.rcParams.update(
        {
            "font.size": 12,
            "axes.titlesize": 13,
            "axes.labelsize": 12,
            "figure.dpi": 140,
            "savefig.dpi": 200,
            "savefig.bbox": "tight",
            "axes.spines.top": False,
            "axes.spines.right": False,
        }
    )


def plot_bar_metric(
    rows: list[dict],
    conditions: tuple[str, ...],
    field: str,
    ylabel: str,
    title: str,
    dest: Path,
) -> None:
    data_rows = rows_for_metric(rows, field)
    fig, ax = plt.subplots(figsize=(7.0, 4.8))
    x = np.arange(len(conditions))
    means, sds = [], []
    for c in conditions:
        m, s = mean_sd(values(data_rows, c, field))
        means.append(m)
        sds.append(s)
    bars = ax.bar(
        x,
        means,
        yerr=sds,
        capsize=6,
        color=[COLORS[c] for c in conditions],
        edgecolor="black",
        linewidth=0.6,
        width=0.62,
        error_kw={"elinewidth": 1.2},
    )
    for i, c in enumerate(conditions):
        vals = values(data_rows, c, field)
        jitter = (np.random.default_rng(i + 11).random(len(vals)) - 0.5) * 0.15
        ax.scatter(x[i] + jitter, vals, s=55, c="black", alpha=0.75, zorder=3)
    ax.set_xticks(x, [SHORT[c] for c in conditions], rotation=15, ha="right")
    ax.set_ylabel(ylabel)
    ax.set_title(title)
    ax.grid(axis="y", linestyle=":", alpha=0.45)
    for bar, mean in zip(bars, means):
        if not np.isnan(mean):
            ax.text(
                bar.get_x() + bar.get_width() / 2,
                bar.get_height(),
                f"{mean:.2f}",
                ha="center",
                va="bottom",
                fontsize=10,
            )
    fig.tight_layout()
    fig.savefig(dest)
    plt.close(fig)


def main() -> None:
    _style()
    (FIG_DIR / "vr").mkdir(parents=True, exist_ok=True)
    (FIG_DIR / "dof_comparison").mkdir(parents=True, exist_ok=True)

    desktop = load_desktop()
    vr = load_vr()
    if not desktop:
        raise SystemExit("No desktop CSV rows in data/a1_P*.csv (need desktop-1 for DoF charts)")
    if not vr:
        raise SystemExit("No VR CSV rows in data/a2_*.csv")

    dof_rows = [r for r in desktop if r["condition"] == "desktop-1"] + [
        r for r in vr if r["condition"] == "vr-grab"
    ]

    for field, ylabel, slug in METRICS:
        plot_bar_metric(
            vr,
            VR,
            field,
            ylabel,
            f"VR — {ylabel}",
            FIG_DIR / "vr" / f"{slug}.png",
        )
        plot_bar_metric(
            dof_rows,
            DOF,
            field,
            ylabel,
            f"DoF comparison — {ylabel} (desktop-1 vs VR grab)",
            FIG_DIR / "dof_comparison" / f"{slug}.png",
        )

    interrupted = [r for r in desktop if r["interrupted"]]
    print("VR trials:", len(vr), "participant(s)", sorted({r["participant_id"] for r in vr}))
    print("DoF chart uses desktop-1 trials:", len([r for r in desktop if r["condition"] == "desktop-1"]))
    if interrupted:
        print("Time outliers excluded from time charts (>300 s):")
        for r in interrupted:
            print(f"  {r['participant_id']} {r['condition']} trial {r['trial_number']}: {r['completion_time_s']:.1f}s")
    print(f"\nWrote {FIG_DIR / 'vr'}/*.png and {FIG_DIR / 'dof_comparison'}/*.png")


if __name__ == "__main__":
    main()
