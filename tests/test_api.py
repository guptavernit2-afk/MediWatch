"""Regression checks for persistence, validation, alerts, and API boundaries."""

import csv
from io import StringIO

import pytest
from fastapi.testclient import TestClient

from app import create_app


def create_patient(client, payload):
    response = client.post("/api/patients", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def test_dashboard_and_configuration_work_without_ai_credentials(client):
    assert client.get("/").status_code == 200
    assert client.get("/static/styles.css").status_code == 200
    assert client.get("/api/health").json()["status"] == "ok"
    configuration = client.get("/api/config").json()
    assert configuration["demo_mode"] is True
    assert configuration["ai_configured"] is False
    assert configuration["version"] == "2.0.0"


def test_reading_patients_never_changes_measurements_or_history(client):
    before = client.get("/api/patients").json()
    assert len(before) >= 5
    after = client.get("/api/patients").json()
    assert before == after
    for patient in before:
        assert len(patient["history"]) > 1
        assert patient["history"][-1]["heart_rate"] == patient["heart_rate"]


def test_patient_search_and_status_filters(client):
    patients = client.get("/api/patients").json()
    selected = patients[0]
    search = client.get("/api/patients", params={"q": selected["name"]}).json()
    assert selected["patient_id"] in {item["patient_id"] for item in search}
    filtered = client.get(
        "/api/patients", params={"status": selected["status"]}
    ).json()
    assert filtered
    assert all(item["status"] == selected["status"] for item in filtered)
    assert client.get("/api/patients", params={"q": "absent-person-xyz"}).json() == []


def test_patient_record_and_notes_survive_restart(client, database_path, patient_payload):
    patient = create_patient(client, patient_payload)
    patient_id = patient["patient_id"]
    note = client.post(
        f"/api/patients/{patient_id}/notes",
        json={"content": "Fictional observation for the regression test.", "author": "Tester"},
    )
    assert note.status_code == 201, note.text
    with TestClient(create_app(db_path=database_path, demo_mode=True)) as restarted:
        restored = restarted.get(f"/api/patients/{patient_id}").json()
        assert restored["name"] == patient_payload["name"]
        notes = restarted.get(f"/api/patients/{patient_id}/notes").json()
        assert any(item["content"] == note.json()["content"] for item in notes)
        assert len(restarted.get("/api/patients").json()) == len(
            client.get("/api/patients").json()
        )


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("name", "   "),
        ("age", -1),
        ("age", 151),
        ("heart_rate", -4),
        ("oxygen", 101),
        ("temperature", 100),
        ("respiratory_rate", -1),
    ],
)
def test_invalid_patient_values_are_rejected(client, patient_payload, field, value):
    patient_payload[field] = value
    response = client.post("/api/patients", json=patient_payload)
    assert response.status_code == 422, response.text


def test_systolic_must_exceed_diastolic(client, patient_payload):
    patient_payload.update(blood_pressure_sys=70, blood_pressure_dia=100)
    assert client.post("/api/patients", json=patient_payload).status_code == 422


def test_active_bed_conflict_and_discharge_free_the_bed(client, patient_payload):
    patient = create_patient(client, patient_payload)
    duplicate = client.post("/api/patients", json=patient_payload)
    assert duplicate.status_code == 409, duplicate.text
    discharge = client.post(f"/api/patients/{patient['patient_id']}/discharge")
    assert discharge.status_code == 200, discharge.text
    active_ids = {item["patient_id"] for item in client.get("/api/patients").json()}
    assert patient["patient_id"] not in active_ids
    replacement = create_patient(client, patient_payload)
    assert replacement["patient_id"] != patient["patient_id"]


def test_active_bed_conflicts_ignore_case(client, patient_payload):
    create_patient(client, patient_payload)
    patient_payload["ward"] = patient_payload["ward"].swapcase()
    patient_payload["bed"] = patient_payload["bed"].swapcase()
    assert client.post("/api/patients", json=patient_payload).status_code == 409


def test_one_severe_measurement_is_critical_and_creates_alert(client, patient_payload):
    patient = create_patient(client, patient_payload)
    readings = {
        key: patient_payload[key]
        for key in (
            "heart_rate", "blood_pressure_sys", "blood_pressure_dia", "oxygen",
            "temperature", "respiratory_rate",
        )
    }
    readings["oxygen"] = 82
    response = client.post(
        f"/api/patients/{patient['patient_id']}/readings", json=readings
    )
    assert response.status_code == 201, response.text
    updated = client.get(f"/api/patients/{patient['patient_id']}").json()
    assert updated["status"] == "critical"
    assert updated["oxygen"] == 82
    assert len(updated["history"]) == len(patient["history"]) + 1
    alerts = client.get("/api/alerts").json()
    matches = [item for item in alerts if item["patient_id"] == patient["patient_id"]]
    assert any(item["severity"] == "critical" for item in matches)


def test_alert_acknowledgement_is_idempotent_and_persistent(client, database_path):
    alerts = client.get("/api/alerts").json()
    pending = next(item for item in alerts if not item["acknowledged"])
    endpoint = f"/api/alerts/{pending['alert_id']}/acknowledge"
    response = client.post(endpoint, json={"acknowledged_by": "Test reviewer"})
    assert response.status_code == 200, response.text
    acknowledged_at = response.json()["acknowledged_at"]
    assert acknowledged_at
    repeated = client.post(endpoint, json={"acknowledged_by": "Another reviewer"})
    assert repeated.status_code == 200
    assert repeated.json()["acknowledged_at"] == acknowledged_at
    with TestClient(create_app(db_path=database_path, demo_mode=True)) as restarted:
        restored = next(
            item for item in restarted.get("/api/alerts").json()
            if item["alert_id"] == pending["alert_id"]
        )
        assert restored["acknowledged"] is True
        assert restored["acknowledged_at"] == acknowledged_at


def test_normalized_reading_resolves_flag_but_keeps_alert_history(client, patient_payload):
    patient_payload["oxygen"] = 82
    patient = create_patient(client, patient_payload)
    alert = next(
        item for item in client.get("/api/alerts").json()
        if item["patient_id"] == patient["patient_id"] and item["vital"] == "oxygen"
    )
    reading = {
        key: patient_payload[key] for key in (
            "heart_rate", "blood_pressure_sys", "blood_pressure_dia", "oxygen",
            "temperature", "respiratory_rate",
        )
    }
    reading["oxygen"] = 98
    assert client.post(
        f"/api/patients/{patient['patient_id']}/readings", json=reading
    ).status_code == 201
    current = client.get(f"/api/patients/{patient['patient_id']}").json()
    assert current["status"] == "normal"
    restored = next(
        item for item in client.get("/api/alerts").json()
        if item["alert_id"] == alert["alert_id"]
    )
    assert restored["active"] is False
    assert restored["resolved_at"]


def test_summary_falls_back_to_rules_without_an_ai_key(client):
    patient = client.get("/api/patients").json()[0]
    response = client.post(f"/api/patients/{patient['patient_id']}/summary")
    assert response.status_code == 200, response.text
    assert response.json()["source"] == "rules"
    assert response.json()["summary"]


def test_csv_export_neutralizes_spreadsheet_formulas(client, patient_payload):
    patient_payload["name"] = "=HYPERLINK(\"https://example.invalid\")"
    create_patient(client, patient_payload)
    response = client.get("/api/export")
    assert response.status_code == 200
    assert "text/csv" in response.headers["content-type"]
    rows = list(csv.DictReader(StringIO(response.text)))
    assert rows
    assert any(row["name"].startswith("'=") for row in rows)


def test_missing_patient_and_alert_return_404(client):
    assert client.get("/api/patients/not-present").status_code == 404
    assert client.get("/api/patients/not-present/notes").status_code == 404
    assert client.post(
        "/api/alerts/not-present/acknowledge", json={"acknowledged_by": "Tester"}
    ).status_code == 404


def test_empty_notes_and_unknown_payload_properties_are_rejected(client, patient_payload):
    patient = create_patient(client, patient_payload)
    assert client.post(
        f"/api/patients/{patient['patient_id']}/notes", json={"content": "   "}
    ).status_code == 422
    patient_payload["unexpected_field"] = "do not silently accept input mistakes"
    assert client.post("/api/patients", json=patient_payload).status_code == 422


def test_non_demo_mode_starts_empty_and_requires_a_token(database_path, monkeypatch):
    monkeypatch.setenv("MEDIWATCH_API_TOKEN", "local-regression-token")
    application = create_app(db_path=database_path, demo_mode=False)
    with TestClient(application) as secure:
        assert secure.get("/api/health").status_code == 200
        assert secure.get("/api/config").json()["auth_required"] is True
        assert secure.get("/api/patients").status_code == 401
        assert secure.get(
            "/api/patients", headers={"Authorization": "Bearer wrong-token"}
        ).status_code == 401
        response = secure.get(
            "/api/patients", headers={"Authorization": "Bearer local-regression-token"}
        )
        assert response.status_code == 200, response.text
        assert response.json() == []


def test_non_demo_mode_fails_closed_without_a_configured_token(database_path):
    application = create_app(db_path=database_path, demo_mode=False)
    with pytest.raises(RuntimeError, match="MEDIWATCH_API_TOKEN"):
        with TestClient(application):
            pass


def test_changing_demo_mode_requires_a_separate_database(client, database_path, monkeypatch):
    assert client.get("/api/patients").json()
    monkeypatch.setenv("MEDIWATCH_API_TOKEN", "local-regression-token")
    application = create_app(db_path=database_path, demo_mode=False)
    with pytest.raises(RuntimeError, match="Database mode differs"):
        with TestClient(application):
            pass
