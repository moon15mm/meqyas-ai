"""Copy the real code excerpts and the real test-run output into src/data/ for the video.

Run from the repository root:  uv run python marketing/demo-video/scripts/extract_assets.py
"""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DATA = Path(__file__).resolve().parents[1] / "src" / "data"


def block(path: str, start: str, stop: str | None = None) -> dict[str, object]:
    """Lines from the one starting with `start` up to (not including) the next line starting with `stop`."""
    lines = (ROOT / path).read_text(encoding="utf-8").splitlines()
    i = next(n for n, line in enumerate(lines) if line.lstrip().startswith(start))
    j = len(lines)
    if stop:
        j = next((n for n in range(i + 1, len(lines)) if lines[n].lstrip().startswith(stop)), len(lines))
    body = lines[i:j]
    while body and not body[-1].strip():
        body.pop()
    return {"path": path, "first_line": i + 1, "lines": body}


code = {
    "schema": block("packages/ai/meqyas_ai/schemas/retention.py", "class RetentionAnalysisOut"),
    "post_process": block("packages/ai/meqyas_ai/agents/cx_retention_agent.py", "def post_process"),
    "tiers": block("packages/ai/meqyas_ai/providers/factory.py", "DEFAULT_MODELS", "}"),
}
code["tiers"]["lines"].append("}")
(DATA / "code.json").write_text(json.dumps(code, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

run = subprocess.run(
    ["uv", "run", "--frozen", "pytest", "packages/ai/tests", "-vv", "-p", "no:cacheprovider", "--color=no"],
    cwd=ROOT,
    capture_output=True,
    text=True,
    check=False,
)
lines = run.stdout.splitlines()
tests = [re.sub(r"\s+\[\s*\d+%\]$", "", line) for line in lines if " PASSED" in line or " FAILED" in line]
summary = next(line.strip("= ") for line in reversed(lines) if " passed" in line or " failed" in line)
(DATA / "tests.json").write_text(
    json.dumps({"command": "pytest packages/ai/tests -v", "tests": tests, "summary": summary}, indent=2) + "\n",
    encoding="utf-8",
)
print(f"code.json: {len(code)} excerpts · tests.json: {len(tests)} tests · {summary}")
