"""Deterministic text analytics for open answers (ANALYTICS.md §7): Arabic/English
normalization, stop words and keyword extraction. No model is involved, so keywords
are always available — even when AI is disabled for the organization."""

from __future__ import annotations

import re
import unicodedata
from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass
from itertools import pairwise

_DIACRITICS = re.compile("[ً-ْٰـ]")  # harakat, dagger alef, tatweel
_NON_WORD = re.compile(r"[^\w\s]", re.UNICODE)
_DIGITS = re.compile(r"\d+")
_REPEAT = re.compile(r"(.)\1{2,}")

AR_STOPWORDS = frozenset(
    """
    في من على الى إلى عن مع هذا هذه ذلك تلك التي الذي الذين اللتي اللذين هو هي هم هن انا أنا نحن انت أنت
    انتم كان كانت يكون تكون كانوا لم لن لا ما ماذا لماذا كيف متى اين أين هل قد لقد ثم او أو و ف ب ك ل
    ان أن إن إنه انه انها أنها كل بعض غير بين عند عندما حتى اذا إذا لكن لكنه ايضا أيضا جدا جداً فقط
    كما مثل بعد قبل خلال حول ضمن لدى لدي لديه لديها عليه عليها فيه فيها منه منها به بها له لها لهم
    هناك هنا الان الآن يوجد توجد كذلك اي أي التى الذى شيء شي اكثر أكثر اقل أقل كثير قليل ذات نفس عبر
    يا وهو وهي وفي ومن وعلى ولا وما وكان وقد ولكن او اما أما
    """.split()
)
EN_STOPWORDS = frozenset(
    """
    a an the and or but if then else of to in on at for from by with without about as is are was were be been
    being it its this that these those i me my we our you your he she they them their his her not no nor so
    too very can could should would will just do does did have has had more most less least some any all each
    other than there here when where why how what which who whom also into out up down over under again once
    """.split()
)


def normalize_ar(text: str) -> str:
    """Fold Arabic orthographic variants so «الأدوات» and «الادوات» count as one word."""
    t = unicodedata.normalize("NFKC", text or "")
    t = _DIACRITICS.sub("", t)
    t = re.sub("[إأآٱ]", "ا", t)
    t = t.replace("ى", "ي").replace("ة", "ه").replace("ؤ", "و").replace("ئ", "ي")
    return t


_STOP = frozenset({normalize_ar(w) for w in AR_STOPWORDS} | EN_STOPWORDS)


def _runs(text: str) -> list[list[str]]:
    """Content words in order, split wherever a stop word, number or punctuation stood
    between them — so a two-word phrase is only counted when its words were adjacent."""
    t = normalize_ar(text).lower()
    t = _DIGITS.sub(" | ", _NON_WORD.sub(" | ", t))
    runs: list[list[str]] = [[]]
    for word in t.split():
        word = _REPEAT.sub(r"", word)
        if word == "|" or len(word) < 2 or word in _STOP:
            if runs[-1]:
                runs.append([])
            continue
        # The definite article is noise for counting: «التدريب» ~ «تدريب».
        if word.startswith("ال") and len(word) > 4:
            word = word[2:]
        elif word.startswith("وال") and len(word) > 5:
            word = word[3:]
        runs[-1].append(word)
    return [r for r in runs if r]


def tokens(text: str) -> list[str]:
    return [w for run in _runs(text) for w in run]


@dataclass(frozen=True, slots=True)
class Keyword:
    term: str
    #: Number of answers containing the term (document frequency).
    answers: int


def keywords(texts: Iterable[str], *, limit: int = 15, min_answers: int = 2) -> list[Keyword]:
    """Most frequent words and two-word phrases across answers (counted once per answer)."""
    df: Counter[str] = Counter()
    display: dict[str, Counter[str]] = {}
    for text in texts:
        runs = _runs(text)
        grams = {w for run in runs for w in run} | {f"{a} {b}" for run in runs for a, b in pairwise(run)}
        df.update(grams)
        # Keep the most common surface form of each folded term for display.
        raw = [w for w in _NON_WORD.sub(" ", unicodedata.normalize("NFKC", text or "")).split() if len(w) > 1]
        for w in raw:
            folded = tokens(w)
            if folded:
                display.setdefault(folded[0], Counter())[w] += 1
    ranked = [(term, n) for term, n in df.items() if n >= min_answers]
    # Prefer phrases over their words when they are about as frequent.
    ranked.sort(key=lambda kv: (-kv[1], -len(kv[0].split()), kv[0]))
    chosen: list[Keyword] = []
    phrases: list[tuple[list[str], int]] = []  # folded words of chosen phrases
    for term, n in ranked:
        parts = term.split()
        if len(parts) == 1 and any(term in words and m >= n * 0.8 for words, m in phrases):
            continue
        if len(parts) > 1:
            phrases.append((parts, n))
        shown = " ".join(display.get(p, Counter({p: 1})).most_common(1)[0][0] for p in parts)
        chosen.append(Keyword(term=shown, answers=n))
        if len(chosen) >= limit:
            break
    return chosen
