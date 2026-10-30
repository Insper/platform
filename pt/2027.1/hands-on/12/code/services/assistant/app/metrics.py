"""LLM metrics with OpenTelemetry, pushed by OTLP to otel-lgtm (lab 8).

In Prometheus they appear as assistant_llm_tokens_total, assistant_llm_cost_usd_total,
assistant_ttft_seconds_bucket, assistant_duration_seconds_bucket, assistant_tool_calls_total,
assistant_guardrail_blocks_total and assistant_requests_total.
"""
import os

from opentelemetry import metrics
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.metrics.view import ExplicitBucketHistogramAggregation, View
from opentelemetry.sdk.resources import Resource

# LLM latencies are seconds, not milliseconds: the default buckets (0, 5, 10, 25 ...) would be useless
SECONDS = ExplicitBucketHistogramAggregation([0.1, 0.25, 0.5, 1, 2, 4, 8, 16, 32, 64])

readers = []
if os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT"):  # no backend configured: metrics stay in memory
    from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter

    readers.append(PeriodicExportingMetricReader(OTLPMetricExporter()))

provider = MeterProvider(
    resource=Resource.create(),  # reads OTEL_SERVICE_NAME and OTEL_RESOURCE_ATTRIBUTES
    metric_readers=readers,
    views=[View(instrument_name="assistant.ttft", aggregation=SECONDS),
           View(instrument_name="assistant.duration", aggregation=SECONDS)],
)
metrics.set_meter_provider(provider)
meter = metrics.get_meter("boxoffice.assistant")

requests = meter.create_counter("assistant.requests", description="questions answered, by outcome")
tokens = meter.create_counter("assistant.llm.tokens", description="LLM tokens, by model and type")
cost = meter.create_counter("assistant.llm.cost_usd", description="estimated LLM cost in US dollars")
ttft = meter.create_histogram("assistant.ttft", unit="s", description="time to first answer token")
duration = meter.create_histogram("assistant.duration", unit="s", description="time to the complete answer")
tool_calls = meter.create_counter("assistant.tool.calls", description="tool calls, by tool and outcome")
guardrail_blocks = meter.create_counter("assistant.guardrail.blocks", description="inputs or outputs blocked")

# US dollars per million tokens (input, output). Local models cost electricity, not tokens.
PRICES = {
    "anthropic/claude-opus-5-5": (4.00, 20.00),
    "anthropic/claude-sonnet-5-5": (2.00, 10.00),
    "anthropic/claude-haiku-4-5": (1.00, 5.00),
}


def price(model: str, prompt_tokens: int, completion_tokens: int) -> float:
    per_in, per_out = PRICES.get(model, (0.0, 0.0))
    return (prompt_tokens * per_in + completion_tokens * per_out) / 1_000_000
