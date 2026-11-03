"""The TypeScript enums (packages/shared) and Python enums must stay identical."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]


def test_enum_fixture_matches_python() -> None:
    spec = importlib.util.spec_from_file_location("export_enums", ROOT / "scripts" / "export_enums.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    fixture = json.loads((ROOT / "tests" / "fixtures" / "enums.json").read_text(encoding="utf-8"))
    assert module.snapshot() == fixture, "Run `uv run python scripts/export_enums.py` and update packages/shared"
