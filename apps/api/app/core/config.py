"""Application settings (12-factor). Values come from the environment or the
repo-root ``.env``. See ``.env.example`` for documentation of every variable."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

_REPO_ROOT = Path(__file__).resolve().parents[4]
_INSECURE_DEFAULT_SECRET = "dev-insecure-jwt-secret-change-me-please-32b"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(str(_REPO_ROOT / ".env"), str(_REPO_ROOT / "apps" / "api" / ".env")),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # ------------------------------------------------------------- general
    environment: Literal["development", "test", "production"] = "development"
    app_name: str = "MEQYAS AI"
    api_prefix: str = "/api/v1"
    log_level: str = "INFO"
    web_base_url: str = "http://localhost:3000"
    cors_origins: Annotated[list[str], NoDecode] = Field(default_factory=lambda: ["http://localhost:3000"])

    # ------------------------------------------------------------ database
    database_url: str = "postgresql+asyncpg://meqyas:meqyas@localhost:5432/meqyas"
    database_echo: bool = False
    database_pool_size: int = 10
    redis_url: str | None = None

    # ---------------------------------------------------------------- auth
    jwt_secret: SecretStr = SecretStr(_INSECURE_DEFAULT_SECRET)
    jwt_previous_secrets: str = ""
    jwt_algorithm: str = "HS256"
    access_token_ttl_minutes: int = 15
    refresh_token_ttl_days: int = 30
    password_reset_ttl_minutes: int = 30
    #: SUBSCRIPTIONS.md §4: one-time links that set a new account's first password (new
    #: subscribers, invitations, gifts) and recovery links prepared by an administrator (shared by
    #: hand, so they live longer than «forgot password» e-mails).
    activation_link_ttl_days: int = Field(default=14, ge=1, le=60)
    admin_reset_link_ttl_hours: int = Field(default=24, ge=1, le=168)
    gift_link_ttl_days: int = Field(default=14, ge=1, le=60)

    # ------------------------------------------------------- subscriptions
    #: After a subscription ends, its published surveys keep collecting for this many days.
    subscription_grace_days: int = Field(default=7, ge=0, le=90)
    #: The plan of gifted workspaces (GIFTS.md).
    gift_plan: str = "trial"
    cookie_secure: bool | None = None
    encryption_key: SecretStr | None = None

    # ------------------------------------------------------------------ AI
    ai_provider: Literal["openai", "openai_compatible", "ollama", "anthropic", "none"] = "openai"
    ai_model_fast: str | None = None
    ai_model_smart: str | None = None
    ai_request_timeout_s: float = 90.0
    ai_cache_ttl_s: int = 3600
    #: Daily AI budget of a workspace whose plan does not set its own (SUBSCRIPTIONS.md).
    ai_daily_token_limit_per_org: int = 2_000_000
    openai_api_key: SecretStr | None = None
    openai_base_url: str | None = None
    openai_structured_mode: Literal["json_schema", "json_object", "none"] = "json_schema"
    ollama_enabled: bool = False
    ollama_base_url: str = "http://localhost:11434"
    ollama_model_fast: str | None = None
    ollama_model_smart: str | None = None
    anthropic_api_key: SecretStr | None = None
    #: Optional second provider (another company serving equivalent models). Used
    #: automatically while the primary is rate-limited, down, rejects its key or no longer
    #: serves the model (AI_ARCHITECTURE.md §11).
    ai_fallback_provider: Literal["openai", "openai_compatible", "anthropic", "none"] = "none"
    ai_fallback_base_url: str | None = None
    ai_fallback_api_key: SecretStr | None = None
    ai_fallback_model_fast: str | None = None
    ai_fallback_model_smart: str | None = None
    ai_fallback_structured_mode: Literal["json_schema", "json_object", "none"] = "json_schema"

    # ------------------------------------------------------------- storage
    storage_provider: Literal["local", "s3"] = "local"
    storage_local_path: str = str(_REPO_ROOT / "storage")
    s3_endpoint: str | None = None
    s3_access_key: SecretStr | None = None
    s3_secret_key: SecretStr | None = None
    s3_bucket: str = "meqyas"
    s3_region: str = "auto"

    # ---------------------------------------------------------------- misc
    rate_limit_enabled: bool = True
    #: Reverse proxies in front of the API that append the client IP to X-Forwarded-For.
    #: 0 = use the socket peer (never trust the header). Behind the bundled Caddy proxy: 1.
    trusted_proxy_hops: int = Field(default=0, ge=0, le=5)
    seed_demo_on_startup: bool = True
    email_from: str = "MEQYAS AI <no-reply@meqyas.example>"
    smtp_url: str | None = None

    @field_validator("database_url")
    @classmethod
    def _async_driver(cls, v: str) -> str:
        if v.startswith("postgres://"):
            v = "postgresql://" + v[len("postgres://") :]
        if v.startswith("postgresql://"):
            v = "postgresql+asyncpg://" + v[len("postgresql://") :]
        return v

    @field_validator("storage_local_path")
    @classmethod
    def _absolute_storage(cls, v: str) -> str:
        path = Path(v)
        return str(path if path.is_absolute() else (_REPO_ROOT / path).resolve())

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, v: object) -> object:
        if isinstance(v, str) and not v.strip().startswith("["):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v

    @field_validator(
        "redis_url",
        "openai_base_url",
        "ai_model_fast",
        "ai_model_smart",
        "ai_fallback_base_url",
        "ai_fallback_model_fast",
        "ai_fallback_model_smart",
        "smtp_url",
        "s3_endpoint",
        mode="before",
    )
    @classmethod
    def _blank_to_none(cls, v: object) -> object:
        return None if isinstance(v, str) and not v.strip() else v

    @field_validator(
        "openai_api_key",
        "anthropic_api_key",
        "ai_fallback_api_key",
        "encryption_key",
        "s3_access_key",
        "s3_secret_key",
        mode="before",
    )
    @classmethod
    def _blank_secret_to_none(cls, v: object) -> object:
        return None if isinstance(v, str) and not v.strip() else v

    @model_validator(mode="after")
    def _production_guards(self) -> Settings:
        if self.environment == "production":
            secret = self.jwt_secret.get_secret_value()
            if secret == _INSECURE_DEFAULT_SECRET or len(secret) < 32:
                raise ValueError("JWT_SECRET must be set to a random value of at least 32 characters in production")
            if not self.redis_url:
                raise ValueError("REDIS_URL is required in production")
            if not self.encryption_key:
                raise ValueError("ENCRYPTION_KEY is required in production")
        return self

    # ------------------------------------------------------------- helpers
    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def secure_cookies(self) -> bool:
        return self.is_production if self.cookie_secure is None else self.cookie_secure

    @property
    def jwt_verification_secrets(self) -> list[str]:
        prev = [s.strip() for s in self.jwt_previous_secrets.split(",") if s.strip()]
        return [self.jwt_secret.get_secret_value(), *prev]

    @property
    def repo_root(self) -> Path:
        return _REPO_ROOT


@lru_cache
def get_settings() -> Settings:
    return Settings()
