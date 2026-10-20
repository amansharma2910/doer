"""Application settings, loaded from the environment."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://doer:doer@db:5432/doer"

    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:8787/auth/google/callback"
    google_scopes: str = "openid email profile https://www.googleapis.com/auth/calendar.freebusy"

    anthropic_api_key: str = ""
    estimation_model: str = "claude-haiku-4-5"
    chat_model: str = "claude-opus-5"

    fernet_key: str = ""
    session_ttl_days: int = 30
    cookie_secure: bool = False

    frontend_origin: str = "http://localhost:5173"

    # Estimation sweeper
    sweeper_enabled: bool = True
    # Fire-and-forget estimation on task creation. Disabled in tests so a detached
    # task cannot outlive the fixtures that own its database rows.
    background_estimation_enabled: bool = True
    sweeper_interval_seconds: int = 60
    estimation_max_attempts: int = 3

    @property
    def scope_list(self) -> list[str]:
        return self.google_scopes.split()


@lru_cache
def get_settings() -> Settings:
    return Settings()
