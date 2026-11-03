"""Small wording helpers for the messages the platform prepares for people (Arabic plurals,
dates, the three-step start guide)."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def plural_ar(n: int, one: str, two: str, few: str, other: str) -> str:
    """Arabic counted nouns: 1 → «استبانة واحدة», 2 → «استبانتان», 3–10 → «3 استبانات», else «11 استبانة»."""
    if n == 1:
        return one
    if n == 2:
        return two
    if 3 <= n % 100 <= 10:
        return f"{n:,} {few}"
    return f"{n:,} {other}"


def surveys_ar(n: int) -> str:
    return plural_ar(n, "استبانة واحدة", "استبانتان", "استبانات", "استبانة")


def days_ar(n: int) -> str:
    return plural_ar(n, "يوم واحد", "يومان", "أيام", "يومًا")


def responses_ar(n: int) -> str:
    return plural_ar(n, "رد واحد", "ردّان", "ردود", "رد")


def members_ar(n: int) -> str:
    return plural_ar(n, "عضو واحد", "عضوان", "أعضاء", "عضوًا")


def plural_en(n: int, noun: str) -> str:
    return f"{n:,} {noun}{'' if n == 1 else 's'}"


def date_text(value: datetime, locale: str) -> str:
    return value.strftime("%Y-%m-%d") if locale == "en" else value.strftime("%Y/%m/%d")


def datetime_text(value: datetime, locale: str, timezone: str | None = None) -> str:
    try:
        local = value.astimezone(ZoneInfo(timezone or "Asia/Riyadh"))
    except (ZoneInfoNotFoundError, ValueError):
        local = value
    return local.strftime("%Y-%m-%d %H:%M") if locale == "en" else local.strftime("%Y/%m/%d %H:%M")


START_STEPS_AR = [
    "كيف تبدأ في ثلاث خطوات:",
    "1. من الصفحة الرئيسية صف ما تريد قياسه بجملة واحدة (مثل: «أريد قياس رضا عملاء متجري»)، "
    "فيقترح عليك المساعد خطة القياس والاستبيان — أو اختر قالبًا جاهزًا من «قوالب القياس».",
    "2. راجع الاستبيان ثم انشره، وشارك رابطه أو رمز QR مع جمهورك.",
    "3. تابع الإجابات والتحليلات والتوصيات أولًا بأول من صفحة المشروع.",
]

START_STEPS_EN = [
    "Get started in three steps:",
    "1. On the home page, describe what you want to measure in one sentence (e.g. “I want to measure my "
    "store's customer satisfaction”) and the assistant proposes the plan and survey — or pick a "
    "ready-made template.",
    "2. Review the survey, publish it and share its link or QR code with your audience.",
    "3. Follow the answers, analytics and recommendations from the project page.",
]
