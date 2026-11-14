"""Provider requests are mocked: no network, real credentials, or patient data."""

import asyncio
import json

import httpx

from mediwatch.config import Settings
from mediwatch.summaries import SummaryService


def configured_service():
    return SummaryService(Settings(
        db_path=":memory:", demo_mode=True, api_token="",
        groq_key="fictional-provider-secret", groq_model="test-model",
    ))


def install_transport(monkeypatch, handler):
    actual_client = httpx.AsyncClient
    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        "mediwatch.summaries.httpx.AsyncClient",
        lambda **kwargs: actual_client(transport=transport, **kwargs),
    )


def test_provider_payload_excludes_identity_notes_and_free_text(client, monkeypatch):
    patient = client.get("/api/patients").json()[0]
    patient["notes"] = "Sensitive note must never go to the model."
    captured = []

    def respond(request):
        captured.append(json.loads(request.content))
        return httpx.Response(200, json={"choices": [{"message": {"content": "Fictional readings summarized for review."}}]})

    install_transport(monkeypatch, respond)
    service = configured_service()

    async def summarize_twice():
        first = await service.summarize(patient)
        second = await service.summarize(patient)
        return first, second

    first, second = asyncio.run(summarize_twice())
    assert first["source"] == "groq"
    assert second == first
    assert len(captured) == 1
    data = json.loads(captured[0]["messages"][1]["content"])
    serialized = json.dumps(data)
    assert patient["name"] not in serialized
    assert patient["patient_id"] not in serialized
    assert patient["notes"] not in serialized
    assert set(data["adult_vitals"]) == {
        "heart_rate", "blood_pressure_sys", "blood_pressure_dia", "oxygen",
        "temperature", "respiratory_rate",
    }


def test_provider_failure_uses_safe_local_fallback(client, monkeypatch):
    patient = client.get("/api/patients").json()[0]

    def unavailable(request):
        return httpx.Response(503, json={"error": "Provider diagnostic containing fictional-provider-secret"})

    install_transport(monkeypatch, unavailable)
    result = asyncio.run(configured_service().summarize(patient))
    assert result["source"] == "rules"
    assert result["summary"] == patient["recommendation"]
    assert "fictional-provider-secret" not in json.dumps(result)
