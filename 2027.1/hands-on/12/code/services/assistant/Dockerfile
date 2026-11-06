# syntax=docker/dockerfile:1
FROM python:3.12-slim

# uv: the project's package and environment manager (lab 0); one static binary
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy

# dependencies first (cached layer): exactly the versions of uv.lock, without dev tools
COPY pyproject.toml uv.lock .python-version ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-install-project

COPY app ./app
RUN useradd --system --uid 10001 app
USER app
EXPOSE 8088
CMD ["/app/.venv/bin/uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8088"]
