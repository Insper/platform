"""All settings come from environment variables (the same names in Compose and in Kubernetes)."""
import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    db_dsn: str
    ollama_url: str
    local_model: str        # LiteLLM model name of the local chat model
    embed_model: str        # LiteLLM model name of the embedding model
    embed_dim: int          # dimension of the embedding vectors (nomic-embed-text: 768)
    claude_model: str | None  # set only when ANTHROPIC_API_KEY exists
    default_route: str      # "local" or "claude"
    catalog_url: str
    order_url: str
    max_steps: int          # agent loop: maximum LLM calls per question
    max_input_chars: int
    retrieve_k: int


def load() -> Settings:
    env = os.environ.get
    has_key = bool(env("ANTHROPIC_API_KEY"))
    return Settings(
        db_dsn=(
            f"host={env('DB_HOST', 'db')} port={env('DB_PORT', '5432')} "
            f"dbname={env('DB_NAME', 'boxoffice')} user={env('DB_USER', 'boxoffice')} "
            f"password={env('DB_PASSWORD', 'boxoffice')}"
        ),
        ollama_url=env("OLLAMA_URL", "http://ollama:11434"),
        local_model=env("LOCAL_MODEL", "ollama_chat/qwen2.5:1.5b"),
        embed_model=env("EMBED_MODEL", "ollama/nomic-embed-text"),
        embed_dim=int(env("EMBED_DIM", "768")),
        claude_model=env("CLAUDE_MODEL", "anthropic/claude-opus-5-5") if has_key else None,
        default_route=env("ASSISTANT_ROUTE", "claude" if has_key else "local"),
        catalog_url=env("CATALOG_URL", "http://gateway:8080"),
        order_url=env("ORDER_URL", "http://order:8084"),
        max_steps=int(env("MAX_STEPS", "4")),
        max_input_chars=int(env("MAX_INPUT_CHARS", "2000")),
        retrieve_k=int(env("RETRIEVE_K", "5")),
    )


settings = load()
