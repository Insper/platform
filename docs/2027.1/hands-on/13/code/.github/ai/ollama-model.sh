#!/usr/bin/env bash
# Prepare the free local model of lab 13 (run it from the repository root):
#
#     bash .github/ai/ollama-model.sh
#
# Pulls qwen2.5-coder:7b (4.7 GB) and creates `qwen2.5-coder-16k`: the same weights with a
# 16,384-token context window. Ollama's default window is 4,096 tokens, and a longer prompt
# (conventions + a big diff, or an agent's growing conversation) is cut SILENTLY.
set -euo pipefail

BASE="${OLLAMA_BASE_MODEL:-qwen2.5-coder:7b}"
NAME="${OLLAMA_MODEL_NAME:-qwen2.5-coder-16k}"
CTX="${OLLAMA_NUM_CTX:-16384}"

ollama pull "$BASE"
modelfile="$(mktemp)"
printf 'FROM %s\nPARAMETER num_ctx %s\n' "$BASE" "$CTX" > "$modelfile"
ollama create "$NAME" -f "$modelfile"
rm -f "$modelfile"
echo "ready: LLM_PROVIDER=ollama LLM_MODEL=$NAME (context $CTX tokens)"
