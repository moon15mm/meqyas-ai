from __future__ import annotations

import httpx
import openai
import pytest
from meqyas_ai.errors import AIBadRequestError, AIProviderUnavailableError
from meqyas_ai.providers.base import GenerationOptions, Message
from meqyas_ai.providers.openai_provider import OpenAIProvider


def _bad_request(body: dict) -> openai.BadRequestError:
    response = httpx.Response(400, request=httpx.Request("POST", "https://api.example/v1/chat/completions"))
    return openai.BadRequestError("bad request", response=response, body=body)


async def test_failed_generation_is_returned_for_repair(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = OpenAIProvider(api_key="k", base_url="https://api.example/v1", name="openai_compatible")

    async def raise_validation(**_: object) -> None:
        raise _bad_request({"code": "json_validate_failed", "failed_generation": '{"partial": true}'})

    monkeypatch.setattr(provider, "_create", raise_validation)
    result = await provider.generate_structured(
        [Message("user", "x")], GenerationOptions(model="m"), schema_name="s", json_schema={"type": "object"}
    )
    assert result.text == '{"partial": true}'
    assert result.finish_reason == "schema_validation_failed"


async def test_other_bad_requests_still_raise(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = OpenAIProvider(api_key="k", base_url="https://api.example/v1", name="openai_compatible")

    async def raise_other(**_: object) -> None:
        raise _bad_request({"code": "context_length_exceeded", "message": "too long"})

    monkeypatch.setattr(provider, "_create", raise_other)
    with pytest.raises(AIBadRequestError):
        await provider.generate_structured(
            [Message("user", "x")], GenerationOptions(model="m"), schema_name="s", json_schema={"type": "object"}
        )


def test_reasoning_models_drop_temperature() -> None:
    provider = OpenAIProvider(api_key="k")
    assert "temperature" not in provider._params(GenerationOptions(model="gpt-5-mini", temperature=0.3))
    params = provider._params(GenerationOptions(model="gpt-4.1", temperature=0.3, max_tokens=100))
    assert params["temperature"] == 0.3 and params["max_completion_tokens"] == 100
    compat = OpenAIProvider(api_key="k", base_url="https://api.groq.com/openai/v1")
    assert compat._params(GenerationOptions(model="x", max_tokens=50))["max_tokens"] == 50


def _not_found(message: str) -> openai.NotFoundError:
    response = httpx.Response(404, request=httpx.Request("POST", "https://api.example/v1/chat/completions"))
    return openai.NotFoundError(message, response=response, body={"error": {"message": message}})


@pytest.mark.parametrize(
    "exc",
    [
        _bad_request({"error": {"code": "model_decommissioned", "message": "retired"}}),
        _bad_request(
            {"message": "The model `llama-3.3-70b-versatile` has been decommissioned and is no longer supported."}
        ),
        _not_found("The model `openai/gpt-oss-999b` does not exist or you do not have access to it."),
    ],
)
async def test_retired_models_are_an_availability_error(monkeypatch: pytest.MonkeyPatch, exc: Exception) -> None:
    """A retired model must reach the fallback provider, not surface as a bad request."""
    provider = OpenAIProvider(api_key="k", base_url="https://api.example/v1", name="openai_compatible")

    async def raise_gone(**_: object) -> None:
        raise exc

    monkeypatch.setattr(provider, "_create", raise_gone)
    with pytest.raises(AIProviderUnavailableError):
        await provider.generate([Message("user", "x")], GenerationOptions(model="m"))


def test_factory_passes_name_and_retries() -> None:
    from meqyas_ai.providers import ProviderConfig, build_provider

    provider, tiers = build_provider(
        ProviderConfig(
            provider="openai_compatible",
            openai_base_url="https://openrouter.ai/api/v1",
            openai_api_key="k",
            model_fast="openai/gpt-oss-20b",
            model_smart="openai/gpt-oss-120b",
            max_retries=1,
            name="fallback:openrouter.ai",
        )
    )
    assert provider.name == "fallback:openrouter.ai" and tiers.smart == "openai/gpt-oss-120b"
    assert provider._client.max_retries == 1  # type: ignore[attr-defined]
