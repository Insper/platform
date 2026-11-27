"""HTTP API of the assistant. Every route is under /assistant (lab 0 convention)."""
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from . import agent, guardrails, metrics, rag
from .config import settings
from .db import migrate, pool


@asynccontextmanager
async def lifespan(app: FastAPI):
    await migrate()
    await pool.open()
    yield
    await pool.close()


app = FastAPI(title="BoxOffice assistant", lifespan=lifespan)


class Question(BaseModel):
    message: str
    route: str | None = Field(default=None, pattern="^(local|claude)$", description="override the default model route")


class SearchIn(BaseModel):
    query: str
    k: int = Field(default=5, ge=1, le=20)


class IngestIn(BaseModel):
    limit: int = Field(default=500, ge=1, le=5000)


def guarded(q: Question) -> str:
    try:
        return guardrails.check_input(q.message, settings.max_input_chars)
    except guardrails.Blocked as b:
        metrics.guardrail_blocks.add(1, {"kind": b.kind})
        metrics.requests.add(1, {"outcome": "blocked"})
        raise HTTPException(status_code=422, detail={"blocked": b.kind, "message": str(b)})


@app.get("/assistant/health")
async def health():
    async with pool.connection() as conn:
        docs = (await (await conn.execute("SELECT count(*) FROM assistant.documents")).fetchone())[0]
    return {"status": "UP", "documents": docs, "route": settings.default_route}


@app.post("/assistant/ingest")
async def ingest(body: IngestIn):
    return {"ingested": await rag.ingest(body.limit)}


@app.post("/assistant/search")
async def search(body: SearchIn):
    return [hit.__dict__ for hit in await rag.search(body.query, body.k)]


@app.post("/assistant/chat")
async def chat(q: Question, x_user_email: str | None = Header(default=None)):
    question = guarded(q)
    async for kind, data in agent.run(question, x_user_email, q.route):
        if kind == "done":
            return data


@app.post("/assistant/chat/stream")
async def chat_stream(q: Question, x_user_email: str | None = Header(default=None)):
    question = guarded(q)

    async def events():
        async for kind, data in agent.run(question, x_user_email, q.route):
            yield agent.sse(kind, {"text": data} if kind == "token" else data)

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})
