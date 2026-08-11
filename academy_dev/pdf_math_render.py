"""LaTeX / fraction helpers and inline PDF math drawing (fpdf2)."""

from __future__ import annotations

import re
from typing import Any, Callable

# Built-in fpdf2 font for numeric alignment in math segments.
MATH_FONT_FAMILY = "Courier"

# Vulgar fractions (Unicode) for common ratios.
UNICODE_FRACTIONS: dict[str, str] = {
    "1/2": "½",
    "1/3": "⅓",
    "2/3": "⅔",
    "1/4": "¼",
    "3/4": "¾",
    "1/5": "⅕",
    "2/5": "⅖",
    "3/5": "⅗",
    "4/5": "⅘",
    "1/6": "⅙",
    "5/6": "⅚",
    "1/8": "⅛",
    "3/8": "⅜",
    "5/8": "⅝",
    "7/8": "⅞",
}

_UNICODE_FRAC_CHARS = frozenset(UNICODE_FRACTIONS.values())

_FRACTION_RE = re.compile(r"(\d{1,4})\s*/\s*(\d{1,4})")

_MATH_HINT_RE = re.compile(
    r"(\d{1,4})\s*/\s*(\d{1,4})"
    r"|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]"
    r"|루트|\^|√",
)

_STACKED_FRAC_FONT_DELTA = 2
_FRAC_LINE_GAP = 0.35


def clean_latex_text(text: str) -> str:
    """Convert common LaTeX to plain text students can read in PDF."""
    if not text:
        return ""
    s = str(text).strip()
    s = s.replace(r"\(", "").replace(r"\)", "").replace(r"\[", "").replace(r"\]", "")
    s = re.sub(r"^\$|\$$", "", s)

    replacements = [
        (r"\\times", "x "),
        (r"\\cdot", "· "),
        (r"\\div", "/ "),
        (r"\\leq", "≤ "),
        (r"\\geq", "≥ "),
        (r"\\neq", "≠ "),
        (r"\\pm", "± "),
        (r"\\mp", "∓ "),
        (r"\\infty", "∞ "),
        (r"\\pi", "π "),
        (r"\\alpha", "α "),
        (r"\\beta", "β "),
        (r"\\gamma", "γ "),
        (r"\\theta", "θ "),
        (r"\\left", ""),
        (r"\\right", ""),
        (r"\\,", " "),
        (r"\\;", " "),
        (r"\\!", ""),
        (r"\\quad", "  "),
    ]
    for pat, rep in replacements:
        s = re.sub(pat, rep, s)

    for _ in range(8):
        new = re.sub(r"\\frac\{([^{}]*)\}\{([^{}]*)\}", r"\1 / \2", s)
        if new == s:
            break
        s = new

    s = re.sub(r"\\sqrt\{([^{}]*)\}", r"루트\1", s)
    s = re.sub(r"\\sqrt\[([^\]]*)\]\{([^{}]*)\}", r"\1루트\2", s)
    s = re.sub(r"\^\{([^{}]*)\}", r"^\1", s)
    s = re.sub(r"_\{([^{}]*)\}", r"_\1", s)
    s = re.sub(r"\^\(([^)]*)\)", r"^(\1)", s)
    s = re.sub(r"_\(([^)]*)\)", r"_(\1)", s)
    s = re.sub(r"\\([a-zA-Z]+)", r"\1", s)
    s = s.replace("{", "").replace("}", "")
    s = re.sub(r"\s+ ", " ", s).strip()
    return s


def simplify_latex_text(text: str) -> str:
    """Alias for :func:`clean_latex_text`."""
    return clean_latex_text(text)


DEFAULT_WRAP_CHARS = 40
SIMILAR_SECTION_GAP_MM = 5.0


def _insert_forced_line_breaks(text: str, max_chars: int = DEFAULT_WRAP_CHARS) -> str:
    """Insert ``\\n`` every *max_chars* (prefer breaking at spaces)."""
    if not text or max_chars <= 0:
        return text or ""
    out_lines: list[str] = []
    for paragraph in re.split(r"\n+ ", str(text).strip()):
        chunk = paragraph.strip()
        if not chunk:
            continue
        while len(chunk) > max_chars:
            cut = max_chars
            space_at = chunk.rfind(" ", 0, max_chars + 1)
            if space_at >= max(max_chars // 3, 8):
                cut = space_at
            out_lines.append(chunk[:cut].strip())
            chunk = chunk[cut:].strip()
        if chunk:
            out_lines.append(chunk)
    return "\n".join(out_lines)


def clean_math_text(text: str, *, max_chars: int = DEFAULT_WRAP_CHARS) -> str:
    """LaTeX → readable math text with forced line breaks for PDF."""
    plain = clean_latex_text(text)
    plain = re.sub(r"\s*/\s*", "/ ", plain)
    plain = re.sub(r"+ ", " ", plain).strip()
    return _insert_forced_line_breaks(plain, max_chars=max_chars)


def apply_unicode_fractions(text: str) -> str:
    """Replace well-known ``a/b`` ratios with Unicode vulgar fractions."""

    def _repl(match: re.Match[str]) -> str:
        key = f"{match.group(1)}/{match.group(2)}"
        return UNICODE_FRACTIONS.get(key, match.group(0))

    return _FRACTION_RE.sub(_repl, text or "")


def prepare_pdf_math_text(text: str) -> str:
    """LaTeX clean → Unicode fractions for PDF (wrong-note inline math)."""
    return apply_unicode_fractions(clean_latex_text(text))


def line_has_math(text: str) -> bool:
    """True when the line contains fractions or other math markers."""
    return bool(_MATH_HINT_RE.search(prepare_pdf_math_text(text)))


def estimate_multicell_height(
    text: str,
    w_mm: float,
    *,
    line_h: float = 6.0,
    font_size: int = 9,
) -> float:
    """Estimate ``multi_cell`` height respecting embedded ``\\n`` breaks."""
    if not (text or "").strip():
        return 0.0
    chars_per_line = max(int(w_mm / (font_size * 0.38)), 8)
    total = 0.0
    for raw_line in str(text).split("\n"):
        line = raw_line.strip()
        if not line:
            total += line_h * 0.5
            continue
        wrapped = max(1, (len(line) + chars_per_line - 1) // chars_per_line)
        total += wrapped * line_h
    return total


def draw_similar_multicell_block(
    pdf,
    *,
    x: float,
    y: float,
    w: float,
    text: str,
    line_h: float,
    _font: Callable[..., Any],
    body_color: tuple[int, int, int] = (28, 28, 28),
    font_size: int = 9,
    body_font_family: str = "",
) -> float:
    """Draw similar-question text with ``multi_cell`` auto-wrap (no inline overlap)."""
    from fpdf.enums import XPos, YPos

    if not (text or "").strip():
        return y

    _font(font_size, color=body_color)
    if body_font_family:
        pdf.set_font(body_font_family, size=font_size)
    pdf.set_text_color(*body_color)
    pdf.set_xy(x, y)
    pdf.multi_cell(
        w,
        line_h,
        text,
        wrapmode="CHAR",
        new_x=XPos.LEFT,
        new_y=YPos.NEXT,
    )
    return pdf.get_y()


def _parse_draw_segments(text: str) -> list[dict[str, str]]:
    """Split prepared text into plain text and stacked-fraction segments."""
    segments: list[dict[str, str]] = []
    pos = 0
    for match in _FRACTION_RE.finditer(text):
        if match.start() > pos:
            segments.append({"type": "text", "value": text[pos : match.start()]})
        key = f"{match.group(1)}/{match.group(2)}"
        if key in UNICODE_FRACTIONS:
            segments.append({"type": "text", "value": UNICODE_FRACTIONS[key]})
        else:
            segments.append({
                "type": "stacked_frac",
                "num": match.group(1),
                "den": match.group(2),
            })
        pos = match.end()
    if pos < len(text):
        segments.append({"type": "text", "value": text[pos:]})
    if not segments:
        segments.append({"type": "text", "value": text})
    return segments


def _has_stacked_fraction(text: str) -> bool:
    return any(seg["type"] == "stacked_frac" for seg in _parse_draw_segments(text))


def _stacked_frac_metrics(
    pdf,
    num: str,
    den: str,
    *,
    base_font_size: int = 9,
) -> tuple[float, float, int]:
    fs = max(6, base_font_size - _STACKED_FRAC_FONT_DELTA)
    pdf.set_font(MATH_FONT_FAMILY, size=fs)
    num_w = pdf.get_string_width(num)
    den_w = pdf.get_string_width(den)
    width = max(num_w, den_w) + 1.2
    row_h = fs * 0.42
    height = row_h * 2 + _FRAC_LINE_GAP + 0.6
    return width, height, fs


def _draw_stacked_fraction(
    pdf,
    x: float,
    y: float,
    num: str,
    den: str,
    *,
    base_font_size: int = 9,
    color: tuple[int, int, int] = (28, 28, 28),
) -> tuple[float, float]:
    """Draw numerator over denominator; return (width_mm, height_mm)."""
    width, height, fs = _stacked_frac_metrics(
        pdf, num, den, base_font_size=base_font_size
    )
    pdf.set_text_color(*color)
    pdf.set_font(MATH_FONT_FAMILY, size=fs)

    num_w = pdf.get_string_width(num)
    den_w = pdf.get_string_width(den)
    cx = x + width / 2
    row_h = fs * 0.42

    pdf.set_xy(cx - num_w / 2, y)
    pdf.cell(num_w, row_h, num, align="C")
    line_y = y + row_h
    pdf.set_draw_color(*color)
    pdf.set_line_width(0.15)
    pdf.line(x + 0.2, line_y, x + width - 0.2, line_y)
    pdf.set_xy(cx - den_w / 2, line_y + _FRAC_LINE_GAP)
    pdf.cell(den_w, row_h, den, align="C")
    return width, height


def _char_uses_math_font(ch: str) -> bool:
    if ch == " ":
        return False
    if ch in _UNICODE_FRAC_CHARS:
        return True
    if ord(ch) > 127:
        return False
    return bool(re.match(r"[0-9+\-x×·^√=().,/ ]", ch))


def _draw_text_chunk(
    pdf,
    chunk: str,
    *,
    x: float,
    y: float,
    max_w: float,
    line_h: float,
    font_size: int,
    body_font: Callable[..., Any],
    body_font_family: str,
    body_color: tuple[int, int, int],
) -> tuple[float, float, float]:
    """Draw one text chunk with char wrap; return (next_x, next_y, row_h)."""
    if not chunk:
        return x, y, line_h

    cur_x = x
    cur_y = y
    row_h = line_h
    max_x = x + max_w

    for ch in chunk:
        if _char_uses_math_font(ch):
            pdf.set_font(MATH_FONT_FAMILY, size=font_size)
        else:
            body_font(font_size, color=body_color)
            if body_font_family:
                pdf.set_font(body_font_family, size=font_size)

        ch_w = pdf.get_string_width(ch)
        if cur_x + ch_w > max_x and cur_x > x:
            cur_y += row_h
            cur_x = x
            row_h = line_h

        pdf.set_xy(cur_x, cur_y)
        pdf.cell(ch_w, line_h, ch, align="L")
        cur_x += ch_w

    return cur_x, cur_y, row_h


def draw_pdf_math_block(
    pdf,
    *,
    x: float,
    y: float,
    w: float,
    text: str,
    line_h: float,
    _font: Callable[..., Any],
    safe_text: Callable[[str], str],
    body_color: tuple[int, int, int] = (28, 28, 28),
    font_size: int = 9,
    body_font_family: str = "",
) -> float:
    """Draw a text block with Unicode fractions and stacked ``a/b`` layout."""
    prepared = prepare_pdf_math_text(text)
    if not prepared.strip():
        return y

    if not _has_stacked_fraction(prepared):
        has_korean = bool(re.search(r"[가-힣]", prepared))
        if line_has_math(prepared) and not has_korean:
            pdf.set_font(MATH_FONT_FAMILY, size=font_size)
        else:
            _font(font_size, color=body_color)
            if body_font_family:
                pdf.set_font(body_font_family, size=font_size)
        pdf.set_text_color(*body_color)
        pdf.set_xy(x, y)
        pdf.multi_cell(w, line_h, safe_text(prepared), wrapmode="CHAR")
        return pdf.get_y() + 1.0

    segments = _parse_draw_segments(prepared)
    cur_x = x
    cur_y = y
    row_h = line_h
    max_x = x + w

    for seg in segments:
        if seg["type"] == "stacked_frac":
            num, den = seg["num"], seg["den"]
            frac_w, frac_h, _ = _stacked_frac_metrics(
                pdf, num, den, base_font_size=font_size
            )
            if cur_x + frac_w > max_x and cur_x > x:
                cur_y += row_h
                cur_x = x
                row_h = line_h
            _draw_stacked_fraction(
                pdf,
                cur_x,
                cur_y,
                num,
                den,
                base_font_size=font_size,
                color=body_color,
            )
            cur_x += frac_w + 0.6
            row_h = max(row_h, frac_h)
            continue

        chunk = safe_text(seg.get("value") or "")
        if not chunk:
            continue

        cur_x, cur_y, row_h = _draw_text_chunk(
            pdf,
            chunk,
            x=x,
            y=cur_y,
            max_w=w,
            line_h=line_h,
            font_size=font_size,
            body_font=_font,
            body_font_family=body_font_family,
            body_color=body_color,
        )
        cur_x += 0.3

    return cur_y + row_h + 1.0


def _simulate_wrap_height(
    text: str,
    w_mm: float,
    *,
    line_h: float = 6.5,
    font_size: int = 9,
) -> float:
    """Estimate height without a live pdf (stacked-fraction aware)."""
    prepared = prepare_pdf_math_text(text)
    if not prepared.strip():
        return 0.0

    if not _has_stacked_fraction(prepared):
        chars_per_line = max(int(w_mm / (font_size * 0.38)), 8)
        lines = max(1, (len(prepared) + chars_per_line - 1) // chars_per_line)
        return lines * line_h

    char_w = font_size * 0.22
    frac_w = font_size * 0.9
    frac_h = max(line_h, font_size * 0.95)
    cur_x = 0.0
    cur_y = 0.0
    row_h = line_h

    for seg in _parse_draw_segments(prepared):
        if seg["type"] == "stacked_frac":
            seg_w = max(len(seg["num"]), len(seg["den"])) * char_w + 1.2
            seg_h = frac_h
            if cur_x + seg_w > w_mm and cur_x > 0:
                cur_y += row_h
                cur_x = 0.0
                row_h = line_h
            cur_x += seg_w + 0.6
            row_h = max(row_h, seg_h)
        else:
            chunk = seg.get("value") or ""
            for ch in chunk:
                ch_w = char_w * (0.85 if ord(ch) > 127 else 1.0)
                if cur_x + ch_w > w_mm and cur_x > 0:
                    cur_y += row_h
                    cur_x = 0.0
                    row_h = line_h
                cur_x += ch_w
    return cur_y + row_h


def estimate_plain_text_height(
    text: str,
    w_mm: float,
    *,
    line_h: float = 6.5,
    font_size: int = 9,
) -> float:
    """Estimate wrapped text block height in mm."""
    return _simulate_wrap_height(text, w_mm, line_h=line_h, font_size=font_size)


def estimate_pdf_text_height(
    text: str,
    w_mm: float,
    *,
    line_h: float = 6.5,
    font_size: int = 9,
) -> float:
    """Alias for :func:`estimate_plain_text_height`."""
    return estimate_plain_text_height(text, w_mm, line_h=line_h, font_size=font_size)
