"""FastAPI service: accounts, tasks, submissions, reviews and points (ADR D7).

Run with: uvicorn mt_api.main:app --app-dir src
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from mt_sim import SIM_VERSION, load_templates

from .config import Settings, load_settings
from .db import Database, migrate, sync_templates
from .replay_queue import RedisReplayQueue, ReplayQueue
from .routes import admin, annotator, auth, reviews


def create_app(settings: Settings | None = None, queue: ReplayQueue | None = None) -> FastAPI:
    settings = settings or load_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.settings = settings
        app.state.db = Database(settings.database_url)
        app.state.queue = queue or RedisReplayQueue(settings.redis_url)
        with app.state.db.transaction() as conn:
            migrate(conn)
            sync_templates(conn)
        yield
        app.state.db.close()

    app = FastAPI(title="Maneuver Trainer API", version="0.2.0", lifespan=lifespan)

    @app.get("/api/health")
    def health() -> dict:
        return {"status": "ok", "simVersion": SIM_VERSION}

    @app.get("/api/scenarios/templates")
    def list_templates() -> list[dict]:
        return [
            {
                "templateId": t["templateId"],
                "title": t["title"],
                "family": t["family"],
                "difficultyTier": t["difficultyTier"],
            }
            for t in load_templates().values()
        ]

    for module in (auth, annotator, reviews, admin):
        app.include_router(module.router)
    return app


app = create_app()
