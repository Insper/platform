"""PostgreSQL + pgvector: the vector store of the assistant (schema "assistant")."""
import psycopg
from pgvector.psycopg import register_vector_async
from psycopg_pool import AsyncConnectionPool

from .config import settings

SCHEMA = f"""
CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA IF NOT EXISTS assistant;
CREATE TABLE IF NOT EXISTS assistant.documents (
    id          TEXT PRIMARY KEY,                       -- e.g. "event:123"
    kind        TEXT NOT NULL,                          -- "event" (add "faq", "policy" ... later)
    title       TEXT NOT NULL,
    content     TEXT NOT NULL,                          -- the text that was embedded
    embedding   vector({settings.embed_dim}) NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- approximate nearest neighbours (HNSW) on cosine distance, the metric of the embedding model
CREATE INDEX IF NOT EXISTS documents_embedding_hnsw
    ON assistant.documents USING hnsw (embedding vector_cosine_ops);
"""


async def migrate() -> None:
    """Create the extension and the table before the pool registers the vector type."""
    async with await psycopg.AsyncConnection.connect(settings.db_dsn, autocommit=True) as conn:
        await conn.execute(SCHEMA)


pool = AsyncConnectionPool(settings.db_dsn, configure=register_vector_async, min_size=1, max_size=10, open=False)
