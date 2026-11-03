"""Run CXRetentionAgent live against Meta Llama and save the real output for the video.

The video's live-run scenes read ``src/data/live-run.json``; nothing in that file is typed by
hand. Run from the repository root:

    OPENAI_API_KEY=<groq key> uv run python marketing/demo-video/scripts/live_run.py

Optional env: OPENAI_BASE_URL (default Groq), AI_MODEL_SMART, AI_STRUCTURED_MODE
(json_schema | json_object | none; default json_object, which every Groq Llama model accepts).
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

from meqyas_ai.agents.cx_retention_agent import CXRetentionAgent
from meqyas_ai.providers.factory import ProviderConfig, build_provider
from meqyas_ai.runtime import AgentRunner

OUT = Path(__file__).resolve().parents[1] / "src" / "data" / "live-run.json"

CASES = {
    "complaint": {
        "feedback_text": "والله ما قصرتوا بس الطلب مدهوك، والشوربة كبت في الكيس، والأكل واصل بارد!",
        "customer_name": "فهد",
        "order_id": "ORD-48213",
        "order_amount": 92.0,
        "customer_clv": 1850.0,
        "order_count": 23,
        "channel": "delivery_app",
    },
    "sarcasm": {
        "feedback_text": "ما شاء الله أسرع مطعم في العالم… ساعتين أنتظر الوجبة وجاتني مثلجة!",
        "customer_name": "نورة",
        "order_id": "ORD-48377",
        "order_amount": 64.0,
        "customer_clv": 740.0,
        "order_count": 9,
        "channel": "delivery_app",
    },
}


async def main() -> int:
    if not os.environ.get("OPENAI_API_KEY"):
        print("OPENAI_API_KEY is not set (use your Groq key).", file=sys.stderr)
        return 2
    cfg = ProviderConfig(
        provider="meta_llama",
        openai_api_key=os.environ["OPENAI_API_KEY"],
        openai_base_url=os.environ.get("OPENAI_BASE_URL", "https://api.groq.com/openai/v1"),
        model_smart=os.environ.get("AI_MODEL_SMART") or None,
        openai_structured_mode=os.environ.get("AI_STRUCTURED_MODE", "json_object"),  # type: ignore[arg-type]
    )
    provider, tiers = build_provider(cfg)
    runner = AgentRunner(provider, tiers)
    agent = CXRetentionAgent()

    results: dict[str, object] = {}
    for key, payload in CASES.items():
        res = await runner.run(agent, payload, use_cache=False)
        results[key] = {
            "input": payload,
            "output": res.output.model_dump(mode="json"),
            "model": res.record.model,
            "provider": res.record.provider,
            "latency_ms": res.record.latency_ms,
            "attempts": res.record.attempts,
        }
        print(f"{key}: {res.record.model} · {res.record.latency_ms} ms · attempts={res.record.attempts}")

    OUT.write_text(
        json.dumps(
            {"recorded_at": datetime.now(UTC).isoformat(timespec="seconds"), **results}, ensure_ascii=False, indent=2
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
