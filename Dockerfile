# AgentOS production image — multi-stage: build in one layer, run a pruned runtime.
# Portable for Cloudflare Containers, Cloud Run, ECS, EKS.
# Do NOT bake Cloudflare/Wrangler tooling into this image.
#
# Build (pick --platform for the target cloud CPU):
#   docker build --platform linux/amd64 -t agentos:local .
#   docker build --platform linux/arm64 -t agentos:local .
#
# Retarget the consumer later (FDEs):
#   docker build --build-arg CONSUMER_PATH=path/to/app -t agentos:local .
#
# Run (secrets via env file — never bake .env into the image):
#   docker run --rm -p 8080:8080 --env-file .env.docker agentos:local
#   curl -sS http://127.0.0.1:8080/healthz
#
# Minimal production env (see .project/docs/builtins.md; full checklist in deploy/README.md):
#   AGENT_OS_EXT_AUTH_SECRET (>=32 chars, not the local dev secret)
#   AGENT_OS_GLOBAL_APP_ORIGIN / AGENT_OS_EXT_AUTH_BASE_URL

# ---------------------------------------------------------------------------
# builder — full toolchain, install, agentos build, then prune
# ---------------------------------------------------------------------------
FROM oven/bun:1.4 AS builder

ARG CONSUMER_PATH=examples/client-app

# Do not set NODE_ENV=production here — pnpm would skip turbo/typescript needed to build.
ENV CONSUMER_PATH=${CONSUMER_PATH} \
    PNPM_HOME=/root/.local/share/pnpm \
    PATH="/root/.local/share/pnpm:/root/.local/bin:${PATH}" \
    UV_PYTHON_DOWNLOADS=automatic \
    UV_PYTHON=3.12 \
    DEBIAN_FRONTEND=noninteractive

WORKDIR /app

# pnpm (oven/bun has no npm) + uv (postinstall Python sync)
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && curl -fsSL https://get.pnpm.io/install.sh | SHELL=bash PNPM_VERSION=9.15.4 bash - \
  && curl -LsSf https://astral.sh/uv/install.sh | sh

COPY . .

RUN pnpm install --frozen-lockfile \
  && bun packages/core/bin/agentos build --cwd "${CONSUMER_PATH}" \
  # Drop Python test extras from the SDK venv (postinstall uses --extra dev).
  && uv sync --directory packages/python \
  # Remove build-only JS deps (turbo, vite, tsc, eslint, …).
  && pnpm prune --prod \
  && rm -rf \
       /root/.local/share/pnpm/store \
       /root/.cache \
       /tmp/* \
       .turbo \
       "**/.turbo" \
       packages/core/dist/.tsbuildinfo \
  && find /app -type d -name 'tests' -prune -exec rm -rf {} + \
  && find /app -type d \( -name '__pycache__' -o -name '.pytest_cache' -o -name '.ruff_cache' -o -name '.mypy_cache' \) -prune -exec rm -rf {} + \
  && find /app -type f \( -name '*.tsbuildinfo' -o -name '*.map' -o -name '.DS_Store' \) -delete

# ---------------------------------------------------------------------------
# runtime — Bun + pruned monorepo + CPython for service .venvs
# ---------------------------------------------------------------------------
FROM oven/bun:1.4 AS runtime

ARG CONSUMER_PATH=examples/client-app

ENV CONSUMER_PATH=${CONSUMER_PATH} \
    PORT=8080 \
    NODE_ENV=production \
    AGENT_OS_GLOBAL_NODE_ENV=production \
    # Keep uv-managed CPython resolvable for service .venv shebangs/symlinks.
    PATH="/root/.local/share/uv/python/cpython-3.12-linux-aarch64-gnu/bin:/root/.local/share/uv/python/cpython-3.12-linux-x86_64-gnu/bin:${PATH}"

WORKDIR /app

# CPython used by services/*/.venv (symlinks into this tree).
COPY --from=builder /root/.local/share/uv/python /root/.local/share/uv/python

# Pruned monorepo: prod node_modules, dist/, builtins source, service .venvs.
COPY --from=builder /app /app

RUN printf '%s\n' \
      '#!/bin/sh' \
      'set -eu' \
      'exec bun /app/packages/core/bin/agentos start --cwd "$CONSUMER_PATH"' \
      > /app/docker-entrypoint.sh \
  && chmod +x /app/docker-entrypoint.sh \
  # Drop paths not needed to serve the reference consumer.
  && rm -rf \
       /app/templates \
       /app/tooling \
       /app/.project \
       /app/.github \
       /app/Dockerfile \
       /app/.dockerignore \
       /app/AGENTS.md \
       /app/eslint.config.js \
       /app/.prettierrc \
       /app/.prettierignore \
       /app/bunfig.toml

EXPOSE 8080

CMD ["/app/docker-entrypoint.sh"]
