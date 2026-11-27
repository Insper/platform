#!/usr/bin/env bash
# BoxOffice labs: checks that every tool is installed and prints its version.
# Usage: bash scripts/check-env.sh
set -u
missing=0

check() {            # check <label> <command line>
  local label="$1" cmd="$2" out
  if ! command -v "${cmd%% *}" >/dev/null 2>&1; then
    printf '  MISS  %-9s not found\n' "$label"; missing=$((missing + 1))
  elif out=$(eval "$cmd" 2>&1); then
    printf '  ok    %-9s %s\n' "$label" "$(echo "$out" | head -n 1)"
  else
    printf '  FAIL  %-9s %s\n' "$label" "$(echo "$out" | head -n 1)"; missing=$((missing + 1))
  fi
}

echo "Tools"
check git      "git --version"
check docker   "docker --version"
check compose  "docker compose version"
check java     "java -version"
check maven    "mvn -v"
check uv       "uv --version"
check k6       "k6 version"
check kubectl  "kubectl version --client"
check jq       "jq --version"
check curl     "curl --version"

echo "Kubernetes (lab 10): kind OR minikube is enough"
if command -v kind >/dev/null 2>&1 || command -v minikube >/dev/null 2>&1; then
  command -v kind >/dev/null 2>&1 && echo "  ok    kind      $(kind version 2>&1 | head -n 1)"
  command -v minikube >/dev/null 2>&1 && echo "  ok    minikube  $(minikube version --short 2>&1 | head -n 1)"
else
  echo "  MISS  kind / minikube"; missing=$((missing + 1))
fi

echo "Checks"
java_major=$(java -version 2>&1 | head -n 1 | sed -E 's/[^"]*"([0-9]+).*/\1/')
if [ "${java_major:-0}" -ge 21 ] 2>/dev/null; then
  echo "  ok    JDK $java_major (21 or newer)"
else
  echo "  MISS  JDK 21 or newer (found: ${java_major:-none})"; missing=$((missing + 1))
fi
# Python is installed and managed by uv (uv python install 3.12)
if py=$(uv python find '>=3.12' 2>/dev/null); then
  echo "  ok    Python $("$py" -c 'import platform; print(platform.python_version())') (via uv)"
else
  echo "  MISS  Python 3.12 or newer: run  uv python install 3.12"; missing=$((missing + 1))
fi
if docker info >/dev/null 2>&1; then
  echo "  ok    Docker daemon: $(docker info --format '{{.NCPU}} CPUs, {{.MemTotal}} bytes of memory')"
else
  echo "  MISS  Docker daemon is not running"; missing=$((missing + 1))
fi

echo
if [ "$missing" -eq 0 ]; then echo "All set."; else echo "$missing item(s) missing: fix them before lab 1."; fi
