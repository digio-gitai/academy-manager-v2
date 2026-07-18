"""Server-side LaTeX / fraction → HTML for WeasyPrint (pure HTML/CSS fractions)."""

from __future__ import annotations

import html as html_module
import re

from pdf_math_render import clean_latex_text

# \frac{a}{b} or plain 4/19 (not part of dates/URLs)
_FRACTION_PATTERN = re.compile(
    r"\\frac\{(?P<lnum>[^{}]*)\}\{(?P<lden>[^{}]*)\}"
    r"|(?<![/\d])(?P<pnum>\d{1,4})\s*/\s*(?P<pden>\d{1,4})(?![/\d])"
)


def _fraction_html(numerator: str, denominator: str) -> str:
    num = html_module.escape(str(numerator or "").strip())
    den = html_module.escape(str(denominator or "").strip())
    return (
        f'<span class="fraction">'
        f'<span class="numerator">{num}</span>'
        f'<span class="denominator">{den}</span>'
        f"</span>"
    )


def convert_fractions_to_html(text: str) -> str:
    """Replace ``\\frac{a}{b}`` and ``a/b`` with stacked HTML fraction spans."""
    if not text:
        return ""
    s = str(text)
    parts: list[str] = []
    pos = 0
    for match in _FRACTION_PATTERN.finditer(s):
        if match.start() > pos:
            plain = s[pos : match.start()]
            parts.append(html_module.escape(_light_latex_cleanup(plain)))
        if match.group("lnum") is not None:
            parts.append(_fraction_html(match.group("lnum"), match.group("lden")))
        else:
            parts.append(_fraction_html(match.group("pnum"), match.group("pden")))
        pos = match.end()
    if pos < len(s):
        parts.append(html_module.escape(_light_latex_cleanup(s[pos:])))
    return "".join(parts)


def _light_latex_cleanup(text: str) -> str:
    """Minimal LaTeX cleanup for non-fraction segments (no matplotlib)."""
    if not text or "\\" not in text:
        return text
    return clean_latex_text(text)


def text_with_latex_to_html(text: str) -> str:
    """Plain text + LaTeX/fractions → HTML (CSS fractions, escaped text)."""
    if not (text or "").strip():
        return ""
    body = convert_fractions_to_html(str(text))
    return body.replace("\n", "<br>\n")
