"""Provider-neutral LLM client for the BoxOffice CI jobs.

LLM_PROVIDER=ollama     (default) a local model through Ollama's OpenAI-compatible API: free, no key
                        (LLM_BASE_URL defaults to http://localhost:11434/v1)
LLM_PROVIDER=anthropic  Claude Messages API through the official SDK (needs ANTHROPIC_API_KEY)
LLM_PROVIDER=openai     any other OpenAI-compatible endpoint, e.g. a LiteLLM proxy
                        (needs LLM_BASE_URL; LLM_API_KEY if the endpoint wants one)
LLM_MODEL               model id: qwen2.5-coder-16k (see ollama-model.sh), claude-opus-5-5, ...

Every call returns parsed JSON that validates against a JSON Schema, plus the token
usage, so each job can print what it cost.
"""
from __future__ import annotations

import json
import os
import sys
import time
from dataclasses import dataclass

import jsonschema

# US$ per million tokens: (input, output, cache read). List prices when this lab was
# written -- illustrative; check the provider's pricing page. Unknown models cost 0 here
# (a local Ollama model costs runner minutes, not tokens).
PRICES = {
    "claude-opus-5-5": (4.00, 20.00, 0.20),
    "claude-sonnet-5-5": (2.00, 10.00, 0.20),
    "claude-haiku-4-5": (1.00, 5.00, 0.10),
}
CACHE_WRITE = 1.25  # a 5-minute cache write costs 1.25x the input price
# Models that accept the server-side refusal fallback (beta); see the Claude docs.
FALLBACK_MODELS = {"claude-opus-5-5", "claude-sonnet-5-5"}


class LLMError(RuntimeError):
    """The model did not return a usable answer (refusal, truncation, invalid JSON)."""


@dataclass
class Usage:
    model: str
    input_tokens: int = 0        # uncached input
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    output_tokens: int = 0       # includes thinking tokens, billed as output
    calls: int = 0
    seconds: float = 0.0

    def add(self, other: "Usage") -> None:
        for f in ("input_tokens", "cache_read_tokens", "cache_write_tokens",
                  "output_tokens", "calls", "seconds"):
            setattr(self, f, getattr(self, f) + getattr(other, f))

    @property
    def usd(self) -> float:
        price = PRICES.get(self.model)
        if price is None:
            return 0.0
        p_in, p_out, p_read = price
        return (self.input_tokens * p_in + self.cache_write_tokens * p_in * CACHE_WRITE
                + self.cache_read_tokens * p_read + self.output_tokens * p_out) / 1e6

    def as_dict(self) -> dict:
        return {"model": self.model, "calls": self.calls, "in": self.input_tokens,
                "cache_read": self.cache_read_tokens, "cache_write": self.cache_write_tokens,
                "out": self.output_tokens, "seconds": round(self.seconds, 1),
                "usd": round(self.usd, 4)}

    def markdown(self) -> str:
        price = "n/a (local or unknown model)" if self.model not in PRICES else f"US$ {self.usd:.4f}"
        return ("| Model | Calls | Input | Cache read | Cache write | Output | Time | Cost |\n"
                "|---|---|---|---|---|---|---|---|\n"
                f"| `{self.model}` | {self.calls} | {self.input_tokens:,} | {self.cache_read_tokens:,}"
                f" | {self.cache_write_tokens:,} | {self.output_tokens:,} | {self.seconds:.1f} s"
                f" | {price} |\n")


def provider() -> str:
    return os.environ.get("LLM_PROVIDER") or "ollama"     # the free path is the default


def model() -> str:
    default = "qwen2.5-coder-16k" if provider() == "ollama" else "claude-opus-5-5"
    return os.environ.get("LLM_MODEL") or default


def base_url() -> str:
    """Endpoint of the OpenAI-compatible providers (ollama, openai)."""
    url = os.environ.get("LLM_BASE_URL") or (
        "http://localhost:11434/v1" if provider() == "ollama" else "")
    if not url:
        raise LLMError("LLM_PROVIDER=openai needs LLM_BASE_URL (e.g. http://localhost:4000/v1)")
    return url


def complete_json(system: str, user: str, schema: dict, *, max_tokens: int = 16000,
                  effort: str = "medium") -> tuple[dict, Usage]:
    """One model call that must answer with JSON valid against `schema`.

    `system` should be stable across runs (it is cached); `user` carries the data
    of this run (diff, logs, metrics), which is untrusted.
    """
    start = time.monotonic()
    try:
        if provider() == "anthropic":
            data, usage = _anthropic(system, user, schema, max_tokens, effort)
        else:
            data, usage = _openai_compatible(system, user, schema, max_tokens)
    except LLMError:
        raise
    except Exception as err:  # no key, connection refused, quota... -> the caller fails open
        raise LLMError(f"{type(err).__name__}: {str(err)[:300]}") from err
    usage.seconds = time.monotonic() - start
    return data, usage


def _anthropic(system, user, schema, max_tokens, effort):
    import anthropic

    client = anthropic.Anthropic()          # reads ANTHROPIC_API_KEY
    name = model()
    output_config = {"format": {"type": "json_schema", "schema": schema}}
    if "haiku" not in name:                 # the effort parameter is not available on Haiku 4.5
        output_config["effort"] = effort
    request = dict(
        model=name,
        max_tokens=max_tokens,
        # The system prompt (instructions + conventions) is the same on every run:
        # mark it for prompt caching so repeated runs pay the cheap cache-read price.
        system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": user}],
        output_config=output_config,
    )
    if name in FALLBACK_MODELS:
        # If a safety classifier declines the request, the API re-runs it on a fallback model.
        response = client.beta.messages.create(
            betas=["server-side-fallback-2026-07-01"], fallbacks="default", **request)
    else:
        response = client.messages.create(**request)

    if response.stop_reason == "refusal":
        raise LLMError("the model declined the request")
    if response.stop_reason == "max_tokens":
        raise LLMError("answer truncated: raise max_tokens or send less context")
    text = next((b.text for b in response.content if b.type == "text"), "")
    data = _parse(text, schema)
    u = response.usage
    usage = Usage(name, input_tokens=u.input_tokens,
                  cache_read_tokens=u.cache_read_input_tokens or 0,
                  cache_write_tokens=u.cache_creation_input_tokens or 0,
                  output_tokens=u.output_tokens, calls=1)
    return data, usage


def _openai_compatible(system, user, schema, max_tokens):
    from openai import OpenAI

    client = OpenAI(base_url=base_url(), api_key=os.environ.get("LLM_API_KEY") or "not-needed")
    name = model()
    # JSON mode is widely supported (LiteLLM, Ollama, vLLM); the schema goes in the
    # prompt and the answer is validated here, with one repair attempt.
    instructions = (system + "\n\nAnswer with ONE JSON object, and nothing else, that validates "
                    "against this JSON Schema:\n" + json.dumps(schema))
    messages = [{"role": "system", "content": instructions}, {"role": "user", "content": user}]
    usage = Usage(name)
    for attempt in range(2):
        response = client.chat.completions.create(
            model=name, max_tokens=max_tokens, temperature=0,
            response_format={"type": "json_object"}, messages=messages)
        usage.calls += 1
        if response.usage:
            usage.input_tokens += response.usage.prompt_tokens
            usage.output_tokens += response.usage.completion_tokens
        text = response.choices[0].message.content or ""
        try:
            return _parse(text, schema), usage
        except LLMError as err:
            if attempt == 1:
                raise
            messages += [{"role": "assistant", "content": text},
                         {"role": "user", "content": f"Invalid answer: {err}. Reply again with "
                                                     "only the JSON object."}]
    raise AssertionError("unreachable")


def _parse(text: str, schema: dict) -> dict:
    try:
        data = json.loads(text)
        jsonschema.validate(data, schema)  # defence in depth, even with structured outputs
    except (json.JSONDecodeError, jsonschema.ValidationError) as err:
        raise LLMError(f"answer is not valid JSON for the schema: {str(err)[:200]}") from err
    return data


def step_summary(markdown: str) -> None:
    """Append Markdown to the job summary page (or print it when running locally)."""
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.write(markdown + "\n")
    else:
        print(markdown, file=sys.stderr)


if __name__ == "__main__":
    # Smoke test of the setup:  python .github/ai/llm.py
    print(f"provider={provider()} model={model()}", file=sys.stderr)
    try:
        answer, cost = complete_json(
            "You answer with JSON only.", "Greet the BoxOffice team in at most eight words.",
            {"type": "object", "properties": {"greeting": {"type": "string"}},
             "required": ["greeting"], "additionalProperties": False}, max_tokens=200)
    except LLMError as err:
        sys.exit(f"LLM error: {err}")
    print(json.dumps(answer, ensure_ascii=False))
    print(cost.markdown())
