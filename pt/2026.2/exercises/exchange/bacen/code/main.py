"""Exchange service: currency rates from the Central Bank of Brazil (PTAX)."""

import asyncio
import os
import time
from collections import defaultdict
from contextlib import asynccontextmanager
from datetime import date, timedelta

import httpx
from fastapi import FastAPI, Header, HTTPException, Response

PTAX_URL = os.getenv("PTAX_URL", "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata")
PTAX_TIMEOUT = float(os.getenv("PTAX_TIMEOUT", "3"))  # seconds: never wait longer than the caller would
CACHE_SECONDS = float(os.getenv("CACHE_SECONDS", "300"))  # PTAX publishes a few bulletins a day
RETRY_SECONDS = float(os.getenv("RETRY_SECONDS", "30"))  # after a failed refresh, serve stale this long
# currency -> (valid until, quote, how a request served from it is labelled: "hit" or "stale")
_cache: dict[str, tuple[float, dict, str]] = {}
_locks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with httpx.AsyncClient(timeout=PTAX_TIMEOUT) as client:
        app.state.client = client
        yield


app = FastAPI(title="exchange", lifespan=lifespan)


async def brl_quote(currency: str) -> tuple[dict, str]:
    """Latest PTAX quote of a currency in BRL ({"buy", "sell", "date"}) and where it came from."""
    if currency == "BRL":
        return {"buy": 1.0, "sell": 1.0, "date": None}, "hit"
    cached = _cache.get(currency)
    if cached and time.monotonic() < cached[0]:
        return cached[1], cached[2]
    # one refresh per currency at a time: the requests that arrive meanwhile wait for it
    # instead of all calling PTAX together (a stampede on a provider we do not own)
    async with _locks[currency]:
        cached = _cache.get(currency)
        if cached and time.monotonic() < cached[0]:
            return cached[1], cached[2]
        return await _refresh(currency, cached)


async def _refresh(currency: str, cached: tuple[float, dict, str] | None) -> tuple[dict, str]:
    # a 7-day window always holds a business day (weekends and holidays have no PTAX)
    end = date.today()
    start = end - timedelta(days=7)
    url = (
        f"{PTAX_URL}/CotacaoMoedaPeriodo(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)"
        f"?@moeda='{currency}'&@dataInicial='{start:%m-%d-%Y}'&@dataFinalCotacao='{end:%m-%d-%Y}'"
        "&$format=json&$select=cotacaoCompra,cotacaoVenda,dataHoraCotacao"
    )
    try:
        response = await app.state.client.get(url)
        response.raise_for_status()
        rows = response.json()["value"]
    except (httpx.HTTPError, KeyError, ValueError) as e:
        if cached:  # BCB is slow, down or blocking us: an old rate beats an error
            _cache[currency] = (time.monotonic() + RETRY_SECONDS, cached[1], "stale")
            return cached[1], "stale"
        raise HTTPException(status_code=502, detail=f"PTAX unavailable: {e!r}") from e
    if not rows:
        raise HTTPException(status_code=404, detail=f"Unknown currency: {currency}")

    last = rows[-1]  # rows come in time order: the latest bulletin is the last one
    quote = {
        "buy": last["cotacaoCompra"],
        "sell": last["cotacaoVenda"],
        "date": last["dataHoraCotacao"][:19],
    }
    _cache[currency] = (time.monotonic() + CACHE_SECONDS, quote, "hit")
    return quote, "miss"


@app.get("/exchange/{source}/{target}")
@app.get("/exchanges/{source}/{target}", include_in_schema=False)
async def exchange(
    source: str,
    target: str,
    response: Response,
    id_account: str = Header(alias="id-account"),
):
    """Rate to convert 1 unit of `source` into `target` (e.g. USD → EUR)."""
    src, src_from = await brl_quote(source.upper())
    tgt, tgt_from = await brl_quote(target.upper())
    # X-Cache: miss if PTAX was called, stale if an expired rate was served, hit otherwise
    froms = {src_from, tgt_from}
    response.headers["X-Cache"] = "miss" if "miss" in froms else "stale" if "stale" in froms else "hit"
    # PTAX quotes every currency in BRL, so the cross rate goes through BRL:
    # buy  = what the market pays for 1 `source`, in `target` (it buys source, sells target)
    # sell = what the market charges for 1 `source`, in `target` (it sells source, buys target)
    return {
        "sell": round(src["sell"] / tgt["buy"], 6),
        "buy": round(src["buy"] / tgt["sell"], 6),
        "date": src["date"] or tgt["date"],
        "id-account": id_account,
    }


@app.get("/exchange/currencies")
async def currencies():
    """Currencies PTAX quotes (besides BRL)."""
    try:
        response = await app.state.client.get(f"{PTAX_URL}/Moedas?$format=json&$select=simbolo,nomeFormatado")
        response.raise_for_status()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"PTAX unavailable: {e!r}") from e
    return [{"symbol": m["simbolo"], "name": m["nomeFormatado"]} for m in response.json()["value"]]


@app.get("/health")
async def health():
    return {"status": "ok"}
