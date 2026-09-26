#!/usr/bin/env bash
# Runs mypy once per Python workspace member instead of one flat `mypy .` over the whole
# repo. Many packages/apps reuse the same test basenames (test_tools.py, test_worker.py,
# tests/__init__.py, etc.) and several apps use a src/ layout; checking everything in a
# single mypy invocation makes mypy's module table collide across unrelated packages
# ("Duplicate module named ..." / "Source file found twice ..."). Scoping one mypy run per
# member keeps each package's module table self-contained, so those collisions can't occur,
# while still running full strict-mode checking (see [tool.mypy] in pyproject.toml) on
# every line of source.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONFIG="$REPO_ROOT/pyproject.toml"

members=(
  apps/api
  apps/orchestrator
  apps/workflow
  apps/worker
  packages/agents
  packages/tools
  packages/rag
  packages/framework-engine
  packages/llm
  packages/services
  packages/domain
  packages/extraction
  packages/extraction-adapters
  packages/knowledge-graph
  packages/persistence
  packages/persistence-web
  packages/regulatory-intelligence
  packages/regulatory-intelligence-adapters
  packages/regulatory-crawlers
  packages/policy-builder
  packages/knowledge-intelligence
  packages/knowledge-intelligence-adapters
  packages/knowledge-research
  packages/knowledge-research-adapters
  packages/knowledge-ontology
  packages/knowledge-worker
  packages/regulation-ingestion
  packages/regulation-ingestion-adapters
  packages/events
  packages/plugins
  packages/observability
  packages/security
  packages/config
)

# packages/regulatory-crawlers/tests/conftest.py deliberately inserts its own directory onto
# sys.path (documented there) so its test modules can import siblings (e.g. `_fakes.py`) with
# bare imports, sidestepping the cross-package "tests" collision pytest would otherwise hit.
# mypy has no equivalent of that sys.path trick, so bare imports like `from _fakes import ...`
# only resolve when mypy's own cwd is that tests/ directory — check it separately from the
# package's source. Mapped via a case statement (not an associative array) so this script
# also runs under macOS's bundled bash 3.2, which has no associative-array support.
bare_sibling_import_src_dir() {
  case "$1" in
    packages/regulatory-crawlers) echo "grc_regulatory_crawlers" ;;
    *) echo "" ;;
  esac
}

status=0
for member in "${members[@]}"; do
  dir="$REPO_ROOT/$member"
  src_dir="$(bare_sibling_import_src_dir "$member")"

  if [ -n "$src_dir" ]; then
    echo "== mypy: $member (source) =="
    (cd "$dir" && uv run mypy --config-file="$CONFIG" "$src_dir") || status=1
    echo "== mypy: $member/tests (bare sibling imports) =="
    (cd "$dir/tests" && uv run mypy --config-file="$CONFIG" .) || status=1
  elif [ -d "$dir/src" ]; then
    # src-layout (apps/*): check from inside src/ so the package's own module name matches
    # its cwd-relative name — checking from the app root instead double-counts every file
    # under both "grc_x.module" and "src.grc_x.module". Sibling top-level dirs (tests/,
    # openapi/, ...) are outside src/, so they're added as extra targets when non-empty.
    targets=(".")
    for sibling in "$dir"/*/; do
      name="$(basename "$sibling")"
      [ "$name" = "src" ] && continue
      [ "$name" = ".mypy_cache" ] && continue
      if find "$sibling" -name "*.py" -print -quit | grep -q .; then
        targets+=("../$name")
      fi
    done
    echo "== mypy: $member (src-layout) =="
    (cd "$dir/src" && uv run mypy --config-file="$CONFIG" "${targets[@]}") || status=1
  else
    echo "== mypy: $member =="
    (cd "$dir" && uv run mypy --config-file="$CONFIG" .) || status=1
  fi
done

exit $status
