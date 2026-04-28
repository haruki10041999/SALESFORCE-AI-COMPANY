#!/bin/sh
set -eu

INIT_MODELS="${OLLAMA_INIT_MODELS:-qwen2.5:3b nomic-embed-text:latest}"

echo "[ollama-init] waiting for ollama API..."
until ollama list >/dev/null 2>&1; do
  sleep 2
done

for model in ${INIT_MODELS}; do
  echo "[ollama-init] pulling ${model}"
  ollama pull "${model}"
done

echo "[ollama-init] done"
ollama list
