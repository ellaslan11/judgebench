import pytest

from jbc.judges.llm_judge import parse_json


def test_plain_and_fenced():
    assert parse_json('{"score": 4}') == {"score": 4}
    assert parse_json('```json\n{"score": 4}\n```') == {"score": 4}


def test_skips_braces_in_prose_and_nested_objects():
    text = 'Uses `{x}` here.\n{"scores": {"R7": 3}, "reasons": {}} trailing'
    assert parse_json(text, "scores")["scores"] == {"R7": 3}


def test_missing_required_key_raises():
    with pytest.raises(ValueError):
        parse_json('{"R7": 3}', "scores")


def test_invalid_escape_in_string():
    assert parse_json('{"scores": {"R7": 2}, "why": "regex \\d+ breaks"}', "scores")["scores"] == {"R7": 2}
