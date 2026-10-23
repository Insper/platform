"""Retrieval-augmented generation: catalog events -> text -> embeddings -> pgvector -> top-k."""
import asyncio
from dataclasses import dataclass

import httpx
import numpy as np

from .config import settings
from .db import pool
from .llm import embed

# nomic-embed-text was trained with task prefixes: documents and queries are embedded differently
DOC_PREFIX, QUERY_PREFIX = "search_document: ", "search_query: "


@dataclass
class Hit:
    id: str
    title: str
    content: str
    score: float  # cosine similarity, 1 = same direction


def event_text(e: dict) -> str:
    """The text a fan would search for: what, where, when, how much."""
    v = e["venue"]
    return (f"{e['title']} ({e['category'].lower()}) at {v['name']}, {v['city']} "
            f"(capacity {v['capacity']}), on {e['startsAt']}. Tickets from R$ {e['priceFrom']}.")


async def fetch_events(limit: int) -> list[dict]:
    """Events 1..limit from the catalog API (8 requests in parallel)."""
    sem = asyncio.Semaphore(8)
    async with httpx.AsyncClient(base_url=settings.catalog_url, timeout=10) as http:
        async def one(event_id: int) -> dict | None:
            async with sem:
                r = await http.get(f"/catalog/events/{event_id}")
                return r.json() if r.status_code == 200 else None
        found = await asyncio.gather(*(one(i) for i in range(1, limit + 1)))
    return [e for e in found if e]


async def ingest(limit: int, batch: int = 32) -> int:
    events = await fetch_events(limit)
    for start in range(0, len(events), batch):
        chunk = events[start:start + batch]
        texts = [event_text(e) for e in chunk]
        vectors = await embed([DOC_PREFIX + t for t in texts])
        async with pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.executemany(
                    """
                    INSERT INTO assistant.documents (id, kind, title, content, embedding)
                    VALUES (%s, 'event', %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE
                    SET title = EXCLUDED.title, content = EXCLUDED.content,
                        embedding = EXCLUDED.embedding, updated_at = now()
                    """,
                    [(f"event:{e['id']}", e["title"], t, np.array(v, dtype=np.float32))
                     for e, t, v in zip(chunk, texts, vectors)],
                )
    return len(events)


async def search(query: str, k: int) -> list[Hit]:
    [vector] = await embed([QUERY_PREFIX + query])
    async with pool.connection() as conn:
        rows = await (await conn.execute(
            """
            SELECT id, title, content, 1 - (embedding <=> %s) AS score
            FROM assistant.documents
            ORDER BY embedding <=> %s
            LIMIT %s
            """,
            (np.array(vector, dtype=np.float32), np.array(vector, dtype=np.float32), k),
        )).fetchall()
    return [Hit(id=r[0], title=r[1], content=r[2], score=float(r[3])) for r in rows]
