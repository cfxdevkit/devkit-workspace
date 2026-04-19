# ── DevKit Local Build & Test ─────────────────────────────────────────────
#
# Mirrors the GitHub Actions CI pipeline locally so you can build, smoke-test,
# and validate images WITHOUT pushing to origin.
#
# Typical workflow:
#   make build            — prepare artifacts + build both Docker images
#   make test-smoke       — verify binaries exist in devcontainer image
#   make test-run         — start devcontainer, wait for backend /health
#   git push              — only after local validation succeeds
#
# Prerequisites: docker, node ≥ 22, pnpm (installed by prepare script).
# ---------------------------------------------------------------------------

DEFAULT_GOAL := build

# ── Image tags (local only, never pushed by this Makefile) ─────────────────
BASE_LOCAL          := devkit-base:local
DEVCONTAINER_LOCAL  := devkit-devcontainer:local
CODE_SERVER_LOCAL   := devkit-code-server:local

ARTIFACTS_DIR := packages/devkit-base/artifacts/generated

# ── Artifact preparation ────────────────────────────────────────────────────
.PHONY: artifacts
artifacts:
	@echo ">>> Preparing DevKit artifacts (tgz packages + vsix)…"
	node ./scripts/prepare-devkit-artifacts.mjs
	@echo "<<< Artifacts prepared."

# ── Base image ──────────────────────────────────────────────────────────────
.PHONY: build-base
build-base: artifacts
	@echo ">>> Building base image: $(BASE_LOCAL)"
	docker build \
		--file packages/devkit-base/Dockerfile \
		--tag  $(BASE_LOCAL) \
		.
	@echo "<<< Base image built: $(BASE_LOCAL)"

# ── Devcontainer image ──────────────────────────────────────────────────────
.PHONY: build-devcontainer
build-devcontainer: build-base
	@echo ">>> Building devcontainer image: $(DEVCONTAINER_LOCAL)"
	docker build \
		--file targets/devcontainer/Dockerfile \
		--build-arg BASE_IMAGE=$(BASE_LOCAL) \
		--tag  $(DEVCONTAINER_LOCAL) \
		.
	@echo "<<< Devcontainer image built: $(DEVCONTAINER_LOCAL)"

# ── Code-server image ───────────────────────────────────────────────────────
.PHONY: build-code-server
build-code-server: build-base
	@echo ">>> Building code-server image: $(CODE_SERVER_LOCAL)"
	docker build \
		--file targets/code-server/Dockerfile \
		--build-arg BASE_IMAGE=$(BASE_LOCAL) \
		--tag  $(CODE_SERVER_LOCAL) \
		.
	@echo "<<< Code-server image built: $(CODE_SERVER_LOCAL)"

# ── Default: base + devcontainer ────────────────────────────────────────────
.PHONY: build
build: build-devcontainer

# ── All images ──────────────────────────────────────────────────────────────
.PHONY: build-all
build-all: build-devcontainer build-code-server

# ── Smoke test (fast — binary presence check) ───────────────────────────────
# Verifies that all key binaries were installed correctly in the devcontainer.
.PHONY: test-smoke
test-smoke: build-devcontainer
	@echo ">>> Smoke test: checking DevKit binary presence…"
	docker run --rm --entrypoint sh $(DEVCONTAINER_LOCAL) -c '\
	    set -e; \
	    echo "  devkit-backend: $$(which devkit-backend)"; \
	    echo "  devkit-dex-ui:  $$(which devkit-dex-ui)"; \
	    echo "  devkit-mcp:     $$(which devkit-mcp)"; \
	    echo "  server.mjs:     $$(find /usr/local/lib/node_modules -name server.mjs 2>/dev/null | head -1)"; \
	    echo "  catalog:        $$(find /usr/local/lib/node_modules -name known-tokens.json 2>/dev/null | head -1)"; \
	    echo "All binaries present ✓" \
	  '
	@echo "<<< Smoke test passed."

# ── Backend health test (slower — starts the process) ───────────────────────
# Starts the devcontainer, waits for the backend /health endpoint.
.PHONY: test-run
test-run: build-devcontainer
	@echo ">>> Starting devcontainer for health check…"
	@docker rm -f devkit-test 2>/dev/null || true
	docker run --rm -d --name devkit-test \
	  -p 7748:7748 \
	  $(DEVCONTAINER_LOCAL)
	@echo "    Waiting for backend /health (up to 60s)…"
	@for i in $$(seq 1 30); do \
	  sleep 2; \
	  status=$$(docker exec devkit-test node -e \
	    "fetch('http://127.0.0.1:7748/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))" \
	    2>/dev/null; echo $$?); \
	  if [ "$$status" = "0" ]; then \
	    echo "    Backend healthy after $$((i*2))s ✓"; \
	    docker stop devkit-test; \
	    echo "<<< Health test passed."; \
	    exit 0; \
	  fi; \
	  echo "    Waiting… ($$((i*2))s)"; \
	done; \
	echo "Backend did not respond in 60s — see logs:"; \
	docker logs devkit-test; \
	docker stop devkit-test; \
	exit 1

# ── Interactive run ──────────────────────────────────────────────────────────
# Starts the devcontainer in the foreground with ports forwarded.
.PHONY: run
run: build-devcontainer
	@echo ">>> Starting devcontainer on localhost:7748 (backend), :8888 (DEX UI), :3000 (app)…"
	docker run --rm \
	  --name devkit-local \
	  -p 7748:7748 \
	  -p 8888:8888 \
	  -p 3000:3000 \
	  $(DEVCONTAINER_LOCAL)

# ── Clean ────────────────────────────────────────────────────────────────────
.PHONY: clean
clean:
	rm -rf $(ARTIFACTS_DIR)
	@echo "Cleaned $(ARTIFACTS_DIR)"

.PHONY: clean-images
clean-images:
	docker rmi $(BASE_LOCAL) $(DEVCONTAINER_LOCAL) $(CODE_SERVER_LOCAL) 2>/dev/null || true
	@echo "Removed local images."

# ── Help ─────────────────────────────────────────────────────────────────────
.PHONY: help
help:
	@echo ""
	@echo "DevKit local build targets:"
	@echo "  make build            — prepare artifacts + build base + devcontainer"
	@echo "  make build-all        — build base + devcontainer + code-server"
	@echo "  make test-smoke       — fast binary-presence check"
	@echo "  make test-run         — start container and check backend /health"
	@echo "  make run              — interactive devcontainer on localhost"
	@echo "  make clean            — remove generated artifact tarballs"
	@echo "  make clean-images     — remove local Docker images"
	@echo ""
	@echo "After local validation: git push  →  CI builds and publishes to GHCR."
	@echo ""
