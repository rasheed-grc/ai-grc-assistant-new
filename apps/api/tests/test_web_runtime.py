"""Tests for the shared web_runtime.py wiring against apps/web's live Postgres (Policies,
Knowledge Worker, Regulation Review).

Integration tests need a real database (same convention as packages/persistence-web):
point TEST_DATABASE_URL/DATABASE_URL at one with apps/web's migrations applied, or they skip.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from grc_api.app import create_app
from grc_api.settings import Settings
from grc_api.web_runtime import (
    WebRuntimeNotConfiguredError,
    close_web_database,
    get_policy_mission_store,
    get_policy_repository,
    get_web_database,
)

_REPO_ROOT = Path(__file__).resolve().parents[3]


def _database_url() -> str | None:
    url = os.environ.get("TEST_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if url:
        return url
    env_file = _REPO_ROOT / ".env"
    if not env_file.exists():
        return None
    for line in env_file.read_text().splitlines():
        if line.startswith("DATABASE_URL="):
            return line.split("=", 1)[1].strip().strip('"')
    return None


async def test_get_web_database_raises_when_database_url_unset() -> None:
    app = create_app(Settings(app_env="testing", database_url=""))
    with pytest.raises(WebRuntimeNotConfiguredError):
        await get_web_database(app, "")


async def test_get_web_database_is_memoized_on_app_state() -> None:
    url = _database_url()
    if not url:
        pytest.skip("no TEST_DATABASE_URL/DATABASE_URL configured")
    app = create_app(Settings(app_env="testing", database_url=url))
    try:
        first = await get_web_database(app, url)
        second = await get_web_database(app, url)
        assert first is second
        async with first.pool.acquire() as connection:
            assert await connection.fetchval("SELECT 1") == 1
    finally:
        await close_web_database(app)


async def test_repositories_share_the_same_database() -> None:
    url = _database_url()
    if not url:
        pytest.skip("no TEST_DATABASE_URL/DATABASE_URL configured")
    app = create_app(Settings(app_env="testing", database_url=url))
    try:
        policy_repository = await get_policy_repository(app, url)
        mission_store = await get_policy_mission_store(app, url)
        assert policy_repository is not None
        assert mission_store is not None
    finally:
        await close_web_database(app)


async def test_close_web_database_is_a_no_op_when_never_created() -> None:
    app = create_app(Settings(app_env="testing", database_url=""))
    await close_web_database(app)  # must not raise
