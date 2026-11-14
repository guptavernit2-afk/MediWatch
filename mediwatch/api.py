"""Application factory and HTTP routes."""

import asyncio
import contextlib
import csv
import hmac
import io
import logging
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from . import __version__
from .config import ROOT, Settings
from .middleware import HTTPBoundaryMiddleware
from .models import AcknowledgeCreate, NoteCreate, PatientCreate, PatientUpdate, ReadingCreate
from .monitoring import THRESHOLDS
from .store import MissingRecord, RecordConflict, Store
from .summaries import SummaryService

logger = logging.getLogger(__name__)


def csv_safe(value):
    """Prevent spreadsheet formula interpretation in exported free text."""
    if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@", "\t", "\r", "\n")):
        return "'" + value
    return value


def create_app(db_path=None, demo_mode=None, start_simulator=False) -> FastAPI:
    settings = Settings.from_env(db_path=db_path, demo_mode=demo_mode)
    store = Store(settings.db_path, settings.demo_mode)
    summaries = SummaryService(settings)

    async def simulate():
        while True:
            await asyncio.sleep(settings.refresh_interval)
            try:
                await run_in_threadpool(store.tick)
            except Exception:
                logger.exception("Demo simulation tick failed.")

    @asynccontextmanager
    async def lifespan(application):
        if not settings.demo_mode and not settings.api_token:
            raise RuntimeError("Set MEDIWATCH_API_TOKEN before disabling DEMO_MODE. Use a separate database for non-demo data.")
        store.open()
        task = asyncio.create_task(simulate()) if settings.demo_mode and start_simulator else None
        try:
            yield
        finally:
            if task is not None:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task
            store.close()

    application = FastAPI(
        title="MediWatch API", version=__version__, lifespan=lifespan,
        description="An educational monitoring workspace. Illustrative adult thresholds, not a medical device.",
        docs_url="/docs" if settings.demo_mode else None,
        redoc_url=None, openapi_url="/openapi.json" if settings.demo_mode else None,
    )
    application.state.store = store
    application.state.settings = settings
    application.state.summaries = summaries

    application.add_middleware(HTTPBoundaryMiddleware)

    @application.exception_handler(MissingRecord)
    async def missing_record(_request, error):
        return JSONResponse(status_code=404, content={"detail": str(error)})

    @application.exception_handler(RecordConflict)
    async def record_conflict(_request, error):
        return JSONResponse(status_code=409, content={"detail": str(error)})

    def require_auth(request: Request):
        if settings.demo_mode:
            return
        authorization = request.headers.get("authorization", "")
        scheme, _, credential = authorization.partition(" ")
        if scheme.lower() != "bearer" or not credential or not hmac.compare_digest(credential.encode("utf-8"), settings.api_token.encode("utf-8")):
            raise HTTPException(status_code=401, detail="A valid API access token is required.", headers={"WWW-Authenticate": "Bearer"})

    @application.get("/api/health", tags=["System"])
    def health():
        return {"status": "ok", "version": __version__, "demo_mode": settings.demo_mode}

    @application.get("/api/config", tags=["System"])
    def config():
        return {
            "demo_mode": settings.demo_mode, "ai_configured": bool(settings.groq_key),
            "refresh_interval": settings.refresh_interval, "version": __version__,
            "auth_required": not settings.demo_mode,
        }

    router = APIRouter(prefix="/api", dependencies=[Depends(require_auth)])

    @router.get("/patients", tags=["Patients"])
    def patients(q: str = "", status: Literal["normal", "warning", "critical"] | None = None, ward: str | None = None):
        return store.patients(q=q[:200], status=status, ward=ward)

    @router.post("/patients", status_code=201, tags=["Patients"])
    def create_patient(patient: PatientCreate):
        return store.create_patient(patient.model_dump())

    @router.get("/patients/{patient_id}", tags=["Patients"])
    def patient(patient_id: str):
        return store.patient(patient_id)

    @router.patch("/patients/{patient_id}", tags=["Patients"])
    def update_patient(patient_id: str, patient: PatientUpdate):
        return store.update_patient(patient_id, patient.model_dump(exclude_unset=True))

    @router.post("/patients/{patient_id}/readings", status_code=201, tags=["Readings"])
    def add_reading(patient_id: str, reading: ReadingCreate):
        return store.add_reading(patient_id, reading.model_dump())

    @router.post("/patients/{patient_id}/discharge", tags=["Patients"])
    def discharge(patient_id: str):
        store.discharge(patient_id)
        return {"status": "discharged"}

    @router.get("/patients/{patient_id}/notes", tags=["Notes"])
    def notes(patient_id: str):
        return store.notes(patient_id)

    @router.post("/patients/{patient_id}/notes", status_code=201, tags=["Notes"])
    def add_note(patient_id: str, note: NoteCreate):
        return store.add_note(patient_id, note.content, note.author)

    @router.post("/patients/{patient_id}/summary", tags=["Summaries"])
    async def summary(patient_id: str):
        patient_data = await run_in_threadpool(store.patient, patient_id)
        return await summaries.summarize(patient_data)

    @router.get("/alerts", tags=["Alerts"])
    def alerts():
        return store.alerts()

    @router.post("/alerts/{alert_id}/acknowledge", tags=["Alerts"])
    def acknowledge(alert_id: str, data: AcknowledgeCreate = AcknowledgeCreate()):
        return store.acknowledge(alert_id, data.acknowledged_by)

    @router.get("/summary", tags=["Monitoring"])
    def overview():
        return {**store.summary(), "demo_mode": settings.demo_mode, "ai_configured": bool(settings.groq_key)}

    @router.get("/thresholds", tags=["Monitoring"])
    def thresholds():
        return {"disclaimer": "Illustrative adult ranges only; not a validated clinical score.", "thresholds": THRESHOLDS}

    @router.get("/export", tags=["Patients"])
    def export():
        fields = ["patient_id", "name", "age", "sex", "ward", "bed", "condition", "status", "heart_rate", "blood_pressure_sys", "blood_pressure_dia", "oxygen", "temperature", "respiratory_rate", "updated_at"]
        output = io.StringIO(newline="")
        writer = csv.writer(output)
        writer.writerow(fields)
        for patient_data in store.patients():
            writer.writerow(csv_safe(patient_data[field]) for field in fields)
        return Response(
            content=output.getvalue(), media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="mediwatch-patients.csv"'},
        )

    @router.post("/demo/tick", tags=["Demo"])
    def tick():
        if not settings.demo_mode:
            raise HTTPException(status_code=404, detail="Not found.")
        return {"updated": store.tick()}

    application.include_router(router)
    web_directory = ROOT / "web"
    if web_directory.is_dir():
        application.mount("/static", StaticFiles(directory=web_directory), name="static")

    @application.get("/", include_in_schema=False)
    def dashboard():
        index = web_directory / "index.html"
        if not index.is_file():
            index = ROOT / "index.html"
        return FileResponse(index, media_type="text/html")

    return application
