"""The LLM gateway: one place that knows models, routes, fallbacks, timeouts and costs."""
import litellm
from litellm import Router

from .config import settings

litellm.drop_params = True  # drop parameters a provider does not support instead of failing

model_list = [{
    "model_name": "local",
    "litellm_params": {"model": settings.local_model, "api_base": settings.ollama_url},
}]
fallbacks = []
if settings.claude_model:  # optional: only when ANTHROPIC_API_KEY is set
    model_list.append({"model_name": "claude", "litellm_params": {"model": settings.claude_model}})
    fallbacks = [{"claude": ["local"]}]  # provider down or out of quota: answer with the local model

router = Router(model_list=model_list, fallbacks=fallbacks, num_retries=1, timeout=120)


def real_model(route: str) -> str:
    """The provider model behind a route name (for metrics and costs)."""
    return settings.claude_model if route == "claude" and settings.claude_model else settings.local_model


async def embed(texts: list[str]) -> list[list[float]]:
    response = await litellm.aembedding(model=settings.embed_model, input=texts, api_base=settings.ollama_url)
    return [item["embedding"] for item in response.data]
