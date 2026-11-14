"""Isolated API fixtures: tests never use the user's database or AI key."""

import pytest
from fastapi.testclient import TestClient

from app import create_app


@pytest.fixture(autouse=True)
def isolated_configuration(monkeypatch):
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.delenv("MEDIWATCH_API_TOKEN", raising=False)


@pytest.fixture
def database_path(tmp_path):
    return tmp_path / "test-mediwatch.sqlite3"


@pytest.fixture
def client(database_path):
    application = create_app(
        db_path=database_path, demo_mode=True, start_simulator=False
    )
    with TestClient(application) as session:
        yield session


@pytest.fixture
def patient_payload():
    return {
        "name": "Test Person",
        "age": 35,
        "sex": "Female",
        "ward": "General",
        "bed": "TEST-01",
        "condition": "Observation",
        "heart_rate": 76,
        "blood_pressure_sys": 118,
        "blood_pressure_dia": 76,
        "oxygen": 98,
        "temperature": 36.7,
        "respiratory_rate": 16,
    }
