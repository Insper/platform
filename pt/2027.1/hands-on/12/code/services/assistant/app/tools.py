"""The tool registry: what the model may call, with a JSON schema and validated arguments.

The same shape (name, description, input schema, handler) is what an MCP server exposes; here the
tools run in-process. Every tool is READ-ONLY: the assistant can look things up, never buy or cancel.
"""
import json
from dataclasses import dataclass, field
from typing import Awaitable, Callable

import httpx
from pydantic import BaseModel, Field, ValidationError

from . import metrics, rag
from .config import settings


@dataclass
class Context:
    """Per-request facts the tools may use (identity comes from the gateway, never from the model)."""
    user_email: str | None
    evidence: set[str] = field(default_factory=set)  # ids of the documents the model has seen


class SearchEventsArgs(BaseModel):
    query: str = Field(description="what the fan is looking for, e.g. 'rock concert in Recife in May'")
    k: int = Field(default=5, ge=1, le=10, description="how many results")


class GetEventArgs(BaseModel):
    event_id: int = Field(ge=1, description="the numeric id of the event")


class GetOrderStatusArgs(BaseModel):
    order_id: str = Field(min_length=36, max_length=36, description="the order id (a UUID)")


async def search_events(args: SearchEventsArgs, ctx: Context) -> dict:
    hits = await rag.search(args.query, args.k)
    ctx.evidence.update(h.id for h in hits)
    return {"results": [{"id": h.id, "text": h.content, "score": round(h.score, 3)} for h in hits]}


async def get_event(args: GetEventArgs, ctx: Context) -> dict:
    async with httpx.AsyncClient(base_url=settings.catalog_url, timeout=5) as http:
        r = await http.get(f"/catalog/events/{args.event_id}")
    if r.status_code == 404:
        return {"error": f"event {args.event_id} does not exist"}
    r.raise_for_status()
    ctx.evidence.add(f"event:{args.event_id}")
    return {"id": f"event:{args.event_id}", "event": r.json()}


async def get_order_status(args: GetOrderStatusArgs, ctx: Context) -> dict:
    if not ctx.user_email:
        return {"error": "the user is not logged in: ask them to log in to see their orders"}
    async with httpx.AsyncClient(base_url=settings.order_url, timeout=5) as http:
        r = await http.get(f"/orders/{args.order_id}")
    if r.status_code == 404:
        return {"error": "order not found"}
    r.raise_for_status()
    order = r.json()
    if order.get("customerEmail", "").lower() != ctx.user_email.lower():
        return {"error": "order not found"}  # same answer as 404: do not reveal that it exists
    return {"id": order["id"], "status": order["status"], "showId": order["showId"], "amount": order["amount"]}


@dataclass
class Tool:
    name: str
    description: str
    args: type[BaseModel]
    handler: Callable[[BaseModel, Context], Awaitable[dict]]

    def spec(self) -> dict:
        """OpenAI-style function schema; LiteLLM translates it for every provider."""
        return {"type": "function", "function": {
            "name": self.name, "description": self.description,
            "parameters": self.args.model_json_schema()}}


REGISTRY = {t.name: t for t in [
    Tool("search_events", "Search the BoxOffice catalog for events (concerts, matches, festivals, plays).",
         SearchEventsArgs, search_events),
    Tool("get_event", "Get the details of one event by its numeric id.", GetEventArgs, get_event),
    Tool("get_order_status", "Get the status of one of the logged-in user's orders.",
         GetOrderStatusArgs, get_order_status),
]}


async def call(name: str, raw_args: str, ctx: Context) -> str:
    """Validate the model's arguments, run the tool, and return JSON for the model. Never raises."""
    tool = REGISTRY.get(name)
    if tool is None:
        outcome, result = "unknown_tool", {"error": f"no tool named {name}"}
    else:
        try:
            args = tool.args.model_validate(json.loads(raw_args or "{}"))
            result, outcome = await tool.handler(args, ctx), "ok"
        except (json.JSONDecodeError, ValidationError) as e:
            outcome, result = "invalid_args", {"error": f"invalid arguments: {e}"}
        except httpx.HTTPError as e:
            outcome, result = "error", {"error": f"{name} is unavailable: {type(e).__name__}"}
    metrics.tool_calls.add(1, {"tool": name, "outcome": outcome})
    return json.dumps(result, ensure_ascii=False, default=str)
