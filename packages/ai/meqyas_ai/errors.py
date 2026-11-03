"""Typed errors raised by the AI layer.

Every error carries a stable ``code`` so the API can map it to an HTTP status
and the UI can show a precise message, without leaking provider internals.
"""

from __future__ import annotations

from typing import Any


class AIError(Exception):
    code = "ai_error"
    retryable = False

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}
        # Filled by the AgentRunner so callers can persist the failed run.
        self.run_record: Any | None = None


class AINotConfiguredError(AIError):
    code = "ai_not_configured"


class AIProviderUnavailableError(AIError):
    code = "ai_unavailable"
    retryable = True


class AIAuthError(AIError):
    code = "ai_auth_error"


class AIRateLimitedError(AIError):
    code = "ai_rate_limited"
    retryable = True


class AITimeoutError(AIError):
    code = "ai_timeout"
    retryable = True


class AIBadRequestError(AIError):
    code = "ai_bad_request"


class AIUnsupportedOperationError(AIError):
    code = "ai_unsupported"


class AIStructuredOutputError(AIError):
    """The model failed to produce output matching the schema after all repair attempts."""

    code = "ai_invalid_output"


class AIBudgetExceededError(AIError):
    code = "ai_budget_exceeded"
