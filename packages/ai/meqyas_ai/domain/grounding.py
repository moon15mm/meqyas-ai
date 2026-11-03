"""Number grounding: every number a narrative states must come from computed data.

Agents that write prose about results (data analyst, recommendations, report writer)
are checked with :func:`ungrounded_numbers`; any number that cannot be traced to the
facts they were given triggers a repair round (PRODUCT.md principle 4).
"""

from __future__ import annotations

import re
from collections.abc import Iterable

_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")
_NUMBER = re.compile(r"(?<![\w.])[-+−]?\d+(?:[.,٫]\d+)?")
#: Small counts ("three dimensions", "2 waves") and list numbering are always allowed.
FREE_MAX = 12


def numbers_in(text: str) -> list[float]:
    out: list[float] = []
    for raw in _NUMBER.findall((text or "").translate(_DIGITS)):
        cleaned = raw.replace("−", "-").replace("٫", ".")
        # "1,234" thousands vs "3,5" decimal: a comma followed by exactly 3 digits is a thousands separator.
        if re.fullmatch(r"[-+]?\d{1,3},\d{3}", cleaned):
            cleaned = cleaned.replace(",", "")
        else:
            cleaned = cleaned.replace(",", ".")
        try:
            out.append(float(cleaned))
        except ValueError:
            continue
    return out


def ungrounded_numbers(text: str, sources: Iterable[str], *, tolerance: float = 0.5) -> list[float]:
    """Numbers in ``text`` that match no number in ``sources`` (rounding tolerated)."""
    allowed = [abs(n) for source in sources for n in numbers_in(source)]
    missing: list[float] = []
    for number in numbers_in(text):
        value = abs(number)
        if value <= FREE_MAX and float(value).is_integer():
            continue
        if any(abs(value - a) <= tolerance for a in allowed):
            continue
        missing.append(number)
    return missing


_PERCENT = re.compile(r"(\d+(?:[.,٫]\d+)?)\s*(?:%|٪|في\s?المئة|في\s?المائة|بالمئة|بالمائة|percent\b)", re.IGNORECASE)


def percentages_in(text: str) -> list[float]:
    return [n for raw in _PERCENT.findall((text or "").translate(_DIGITS)) for n in numbers_in(raw)]


def ungrounded_percentages(text: str, sources: Iterable[str], *, tolerance: float = 0.5) -> list[float]:
    """Numbers written as percentages that no source states as a percentage — e.g. a score
    "75.5 / 100" presented as "75.5%". The number exists, but its unit was changed."""
    allowed = [p for source in sources for p in percentages_in(source)]
    return [p for p in percentages_in(text) if not any(abs(p - a) <= tolerance for a in allowed)]


#: Inline citations such as "[F12]" or "(F3، F7)": sources are shown next to the text instead.
_INLINE_IDS = re.compile(r"\s*[\[(（]\s*[FC]\d+(?:\s*[,،;]\s*[FC]\d+)*\s*[\])）]")


def strip_inline_citations(text: str) -> str:
    return _INLINE_IDS.sub("", text or "").strip()
