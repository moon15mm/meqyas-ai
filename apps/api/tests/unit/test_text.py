from app.domain.text import keywords, normalize_ar, tokens


def test_normalization_folds_spelling_variants() -> None:
    assert normalize_ar("الأدوات") == normalize_ar("الادوات")
    assert normalize_ar("مدرسة") == normalize_ar("مدرسه")
    assert normalize_ar("تَدْرِيب") == "تدريب"


def test_stop_words_are_removed_after_normalization() -> None:
    # «على» folds to «علي»; the stop list must fold the same way.
    assert tokens("اعتمد على الأدوات إلى حد ما") == ["اعتمد", "ادوات", "حد"]
    assert tokens("I rely on the tools") == ["rely", "tools"]


def test_phrases_only_join_adjacent_words() -> None:
    answers = [
        "ضعف الإنترنت في الفصول",
        "ضعف الإنترنت، والوقت قصير",
        "ضعف الإنترنت في المدرسة",
    ]
    terms = {k.term: k.answers for k in keywords(answers)}
    assert terms.get("ضعف الإنترنت") == 3
    # «الإنترنت» and «الفصول» were separated by «في»: not a phrase.
    assert not any(t.startswith("الإنترنت ") for t in terms)


def test_counts_answers_not_occurrences() -> None:
    answers = ["تدريب تدريب تدريب", "التدريب مفيد", "لا شيء"]
    terms = {k.term: k.answers for k in keywords(answers)}
    assert next(n for t, n in terms.items() if normalize_ar(t).endswith("تدريب")) == 2


def test_words_already_covered_by_a_phrase_are_not_repeated() -> None:
    answers = ["تبادل التجارب مع الزملاء", "تبادل التجارب مفيد", "أريد تبادل التجارب"]
    terms = [k.term for k in keywords(answers)]
    assert "تبادل التجارب" in terms
    assert "التجارب" not in terms and "تبادل" not in terms
