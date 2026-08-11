"""Academic-style chart images for parent report PDFs (Matplotlib + Seaborn).

All report visualization design lives here so ``student_report_pdf.py`` can
focus on PDF layout only.
"""

from __future__ import annotations

import io
import os
from typing import Any

# Blue / gray academic palette
PRIMARY_BLUE = "#2563eb"
PRIMARY_BLUE_DARK = "#1e40af"
ACCENT_GRAY = "#64748b"
MUTED_GRAY = "#94a3b8"
LIGHT_GRAY = "#e2e8f0"
TEXT_DARK = "#1e293b"
TEXT_BODY = "#334155"
PANEL_BG = "#fafbfc"

CHART_DPI = 180
FONT_FAMILY = "NanumGothic"


def _resolve_nanum_font_path() -> str | None:
    """Locate ``NanumGothic.ttf`` next to this module."""
    here = os.path.dirname(os.path.abspath(__file__))
    for candidate in (
        os.path.join(here, "NanumGothic.ttf"),
        os.path.abspath(os.path.join(here, "..", "NanumGothic.ttf")),
        os.path.abspath("streamlit-app/NanumGothic.ttf"),
    ):
        if os.path.isfile(candidate):
            return candidate
    return None


def _register_nanum_font() -> None:
    """Register NanumGothic with matplotlib for Korean labels."""
    import matplotlib.pyplot as plt
    from matplotlib import font_manager as fm

    fp = _resolve_nanum_font_path()
    if not fp:
        return
    try:
        fm.fontManager.addfont(fp)
        prop = fm.FontProperties(fname=fp)
        family = prop.get_name()
        plt.rcParams["font.family"] = family
        plt.rcParams["font.sans-serif"] = [family, "DejaVu Sans"]
        plt.rcParams["axes.unicode_minus"] = False
    except Exception:
        pass


def _apply_academic_style() -> None:
    """Seaborn-backed journal-style defaults (blue/gray, horizontal grid)."""
    import matplotlib.pyplot as plt

    try:
        import seaborn as sns

        sns.set_theme(
            style="white",
            context="paper",
            palette=[PRIMARY_BLUE, ACCENT_GRAY, MUTED_GRAY],
            font_scale=1.05,
        )
    except ImportError:
        pass

    _register_nanum_font()
    plt.rcParams.update(
        {
            "figure.facecolor": "white",
            "axes.facecolor": PANEL_BG,
            "axes.edgecolor": MUTED_GRAY,
            "axes.labelcolor": TEXT_BODY,
            "axes.titlecolor": TEXT_DARK,
            "axes.titlesize": 11,
            "axes.labelsize": 9,
            "xtick.color": TEXT_BODY,
            "ytick.color": TEXT_BODY,
            "text.color": TEXT_BODY,
            "font.size": 10,
            "grid.color": LIGHT_GRAY,
            "grid.linewidth": 0.55,
            "grid.alpha": 0.85,
            "legend.framealpha": 0.92,
            "legend.edgecolor": LIGHT_GRAY,
        }
    )


def _style_academic_axes(ax) -> None:
    """Thin horizontal grid only; hide top/right spines."""
    ax.grid(True, axis="y", linestyle="-", linewidth=0.55, color=LIGHT_GRAY, alpha=0.9)
    ax.grid(False, axis="x")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["left"].set_color(MUTED_GRAY)
    ax.spines["bottom"].set_color(MUTED_GRAY)


def _figure_to_png_bytes(fig) -> bytes:
    import matplotlib.pyplot as plt

    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=CHART_DPI, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    buf.seek(0)
    return buf.read()


def cumulative_score_chart_png(
    history: list[dict[str, Any]],
    student_name: str,
    *,
    test_average: float | None = None,
) -> bytes:
    """Line chart — student score trend (academic journal style)."""
    import matplotlib.pyplot as plt

    _apply_academic_style()

    if not history:
        fig, ax = plt.subplots(figsize=(7.5, 3.4), dpi=CHART_DPI)
        ax.text(
            0.5,
            0.5,
            "누적 시험 기록 없음",
            ha="center",
            va="center",
            fontsize=11,
            color=ACCENT_GRAY,
        )
        ax.axis("off")
        return _figure_to_png_bytes(fig)

    labels = [f"{h['date']}\n{h['test_name'][:12]}" for h in history]
    scores = [float(h["score"]) for h in history]
    x = list(range(len(scores)))

    fig, ax = plt.subplots(figsize=(7.5, 3.4), dpi=CHART_DPI)
    ax.fill_between(x, scores, alpha=0.10, color=ACCENT_GRAY, zorder=1)
    ax.plot(
        x,
        scores,
        marker="o",
        linewidth=2.2,
        color=PRIMARY_BLUE,
        markersize=7.5,
        markerfacecolor="white",
        markeredgewidth=2,
        markeredgecolor=PRIMARY_BLUE,
        zorder=3,
    )

    if test_average is not None:
        ax.axhline(
            float(test_average),
            color=ACCENT_GRAY,
            linestyle=(0, (4, 3)),
            linewidth=1.4,
            label=f"전체 평균 {test_average:.1f}점",
            zorder=2,
        )
        ax.legend(loc="upper left", fontsize=8, frameon=True)

    for i, sc in enumerate(scores):
        ax.annotate(
            f"{sc:.0f}",
            (i, sc),
            textcoords="offset points",
            xytext=(0, 9),
            ha="center",
            fontsize=8,
            color=TEXT_DARK,
        )

    ax.set_xticks(x)
    ax.set_xticklabels(labels, fontsize=7, ha="center")
    ax.set_ylim(0, 108)
    ax.set_ylabel("점수")
    ax.set_title(f"{student_name} — 누적 성취도 추이", pad=12, fontweight="medium")
    _style_academic_axes(ax)

    fig.tight_layout()
    return _figure_to_png_bytes(fig)


def score_compare_chart_png(
    student_score: float,
    test_average: float | None,
    student_name: str,
) -> bytes:
    """Grouped bar chart — student vs test-wide average."""
    import matplotlib.pyplot as plt
    import numpy as np

    _apply_academic_style()

    labels = [student_name]
    values = [float(student_score)]
    colors = [PRIMARY_BLUE]
    if test_average is not None:
        labels.append("전체 평균")
        values.append(float(test_average))
        colors.append(MUTED_GRAY)

    fig, ax = plt.subplots(figsize=(5.5, 3.2), dpi=CHART_DPI)
    x = np.arange(len(labels))
    bars = ax.bar(
        x,
        values,
        color=colors,
        width=0.52,
        edgecolor=LIGHT_GRAY,
        linewidth=0.9,
        zorder=3,
    )

    for bar, val, color in zip(bars, values, colors):
        ax.text(
            bar.get_x() + bar.get_width() / 2,
            bar.get_height() + 1.8,
            f"{val:.1f}",
            ha="center",
            va="bottom",
            fontsize=10,
            color=PRIMARY_BLUE_DARK if color == PRIMARY_BLUE else TEXT_DARK,
            fontweight="medium",
        )

    ax.set_xticks(x)
    ax.set_xticklabels(labels, fontsize=9)
    ax.set_ylim(0, 110)
    ax.set_ylabel("점수")
    ax.set_title("성적 비교", pad=10, fontweight="medium")
    _style_academic_axes(ax)

    fig.tight_layout()
    return _figure_to_png_bytes(fig)
