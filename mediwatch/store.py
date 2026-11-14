"""Small transactional SQLite repository.

A process-local lock protects the shared connection across FastAPI worker
threads. WAL and SQLite's own writer lock protect the file. Run one application
worker when demo simulation is enabled; every process otherwise owns a timer.
"""

import json
import math
import random
import re
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .monitoring import detect_anomalies, get_status, recommendation
from .seed import DEMO_PATIENTS

VITALS = ("heart_rate", "blood_pressure_sys", "blood_pressure_dia", "oxygen", "temperature", "respiratory_rate")
PATIENT_FIELDS = ("name", "age", "sex", "ward", "bed", "condition")
HISTORY_LIMIT = 720


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def identifier(prefix: str, number: int) -> str:
    return f"{prefix}{number:03d}"


def parse_identifier(value: str, prefix: str) -> int:
    if not re.fullmatch(rf"{prefix}\d{{3,12}}", value):
        raise MissingRecord("Record not found.")
    return int(value[1:])


class MissingRecord(Exception):
    pass


class RecordConflict(Exception):
    pass


class Store:
    def __init__(self, path: str, demo_mode: bool):
        self.path = path
        self.demo_mode = demo_mode
        self.lock = threading.RLock()
        self.connection: sqlite3.Connection | None = None

    def open(self):
        if self.path != ":memory:":
            Path(self.path).expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(self.path, timeout=20, check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA foreign_keys = ON")
        self.connection.execute("PRAGMA journal_mode = WAL")
        self.connection.executescript("""
            CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS patients (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL, age INTEGER NOT NULL, sex TEXT NOT NULL,
                ward TEXT NOT NULL, bed TEXT NOT NULL, condition TEXT NOT NULL,
                admitted_at TEXT NOT NULL, discharged_at TEXT,
                simulated INTEGER NOT NULL DEFAULT 0, baseline TEXT
            );
            CREATE UNIQUE INDEX IF NOT EXISTS active_bed
                ON patients (ward COLLATE NOCASE, bed COLLATE NOCASE) WHERE discharged_at IS NULL;
            CREATE TABLE IF NOT EXISTS readings (
                id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id INTEGER NOT NULL REFERENCES patients(id),
                timestamp TEXT NOT NULL, heart_rate INTEGER NOT NULL,
                blood_pressure_sys INTEGER NOT NULL, blood_pressure_dia INTEGER NOT NULL,
                oxygen REAL NOT NULL, temperature REAL NOT NULL, respiratory_rate INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS reading_patient ON readings(patient_id, id DESC);
            CREATE TABLE IF NOT EXISTS alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id INTEGER NOT NULL REFERENCES patients(id),
                vital TEXT NOT NULL, label TEXT NOT NULL, value REAL NOT NULL,
                severity TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL,
                acknowledged INTEGER NOT NULL DEFAULT 0, acknowledged_at TEXT, acknowledged_by TEXT,
                active INTEGER NOT NULL DEFAULT 1, resolved_at TEXT
            );
            CREATE INDEX IF NOT EXISTS alert_patient ON alerts(patient_id, active);
            CREATE TABLE IF NOT EXISTS notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id INTEGER NOT NULL REFERENCES patients(id),
                content TEXT NOT NULL, author TEXT NOT NULL, created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS note_patient ON notes(patient_id, id DESC);
        """)
        try:
            with self.lock, self.connection:
                mode = self.connection.execute("SELECT value FROM metadata WHERE key='demo_mode'").fetchone()
                expected = "true" if self.demo_mode else "false"
                if mode and mode["value"] != expected:
                    raise RuntimeError("Database mode differs from DEMO_MODE. Set MEDIWATCH_DB_PATH to a separate database when changing modes.")
                self.connection.execute("INSERT OR IGNORE INTO metadata(key,value) VALUES('demo_mode',?)", (expected,))
                seeded = self.connection.execute("SELECT value FROM metadata WHERE key='seeded'").fetchone()
                if self.demo_mode and not seeded:
                    self._seed()
                    self.connection.execute("INSERT INTO metadata(key,value) VALUES('seeded','true')")
        except Exception:
            self.close()
            raise

    def close(self):
        if self.connection is not None:
            self.connection.close()
            self.connection = None

    @property
    def db(self):
        if self.connection is None:
            raise RuntimeError("Database is not open. Use the application lifespan.")
        return self.connection

    def _seed(self):
        instant = datetime.now(timezone.utc)
        for index, data in enumerate(DEMO_PATIENTS):
            admitted = (instant - timedelta(hours=4 + index)).isoformat().replace("+00:00", "Z")
            values = [data[key] for key in PATIENT_FIELDS]
            cursor = self.db.execute(
                "INSERT INTO patients(name,age,sex,ward,bed,condition,admitted_at,simulated,baseline) VALUES(?,?,?,?,?,?,?,1,?)",
                (*values, admitted, json.dumps({key: data[key] for key in VITALS})),
            )
            patient_number = cursor.lastrowid
            for sample in range(24):
                reading = {key: data[key] for key in VITALS}
                if sample < 23:
                    wave = math.sin(sample * .65 + index)
                    reading["heart_rate"] += round(wave * 4)
                    reading["blood_pressure_sys"] += round(wave * 3)
                    reading["blood_pressure_dia"] += round(wave * 2)
                    reading["oxygen"] = min(100, round(reading["oxygen"] + wave * .5, 1))
                    reading["temperature"] = round(reading["temperature"] + wave * .1, 1)
                timestamp = (instant - timedelta(minutes=23 - sample)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
                self._insert_reading(patient_number, reading, timestamp, create_alerts=sample == 23)
            self.db.execute(
                "INSERT INTO notes(patient_id,content,author,created_at) VALUES(?,?,?,?)",
                (patient_number, "Fictional demo record. Initial observations recorded for the monitoring demonstration.", "Demo care team", admitted),
            )

    def _require_patient(self, patient_id: str):
        number = parse_identifier(patient_id, "P")
        row = self.db.execute("SELECT * FROM patients WHERE id=? AND discharged_at IS NULL", (number,)).fetchone()
        if row is None:
            raise MissingRecord("Patient not found.")
        return row

    def _patient(self, row: sqlite3.Row) -> dict:
        history = [dict(item) for item in self.db.execute(
            "SELECT timestamp,heart_rate,blood_pressure_sys,blood_pressure_dia,oxygen,temperature,respiratory_rate FROM readings WHERE patient_id=? ORDER BY id DESC LIMIT 60",
            (row["id"],),
        ).fetchall()][::-1]
        latest = history[-1]
        anomalies = detect_anomalies(latest)
        return {
            "patient_id": identifier("P", row["id"]),
            **{key: row[key] for key in PATIENT_FIELDS},
            "admitted_at": row["admitted_at"], "updated_at": latest["timestamp"],
            **{key: latest[key] for key in VITALS},
            "status": get_status(anomalies), "anomalies": anomalies,
            "hr_history": [item["heart_rate"] for item in history],
            "history": history, "recommendation": recommendation(latest),
        }

    def patients(self, q: str = "", status: str | None = None, ward: str | None = None) -> list[dict]:
        with self.lock:
            result = [self._patient(row) for row in self.db.execute("SELECT * FROM patients WHERE discharged_at IS NULL ORDER BY id").fetchall()]
        if q:
            query = q.casefold()
            result = [item for item in result if query in " ".join(str(item[key]) for key in ("name", "patient_id", "ward", "bed", "condition")).casefold()]
        if status:
            result = [item for item in result if item["status"] == status]
        if ward:
            result = [item for item in result if item["ward"].casefold() == ward.casefold()]
        return result

    def patient(self, patient_id: str) -> dict:
        with self.lock:
            return self._patient(self._require_patient(patient_id))

    def create_patient(self, data: dict) -> dict:
        with self.lock, self.db:
            try:
                cursor = self.db.execute(
                    "INSERT INTO patients(name,age,sex,ward,bed,condition,admitted_at) VALUES(?,?,?,?,?,?,?)",
                    (*[data[key] for key in PATIENT_FIELDS], now_iso()),
                )
            except sqlite3.IntegrityError as error:
                raise RecordConflict("That bed is occupied in this ward. Choose another bed.") from error
            number = cursor.lastrowid
            self._insert_reading(number, data, now_iso())
            return self.patient(identifier("P", number))

    def update_patient(self, patient_id: str, data: dict) -> dict:
        with self.lock, self.db:
            patient = self._require_patient(patient_id)
            if not data:
                return self._patient(patient)
            try:
                self.db.execute(
                    "UPDATE patients SET " + ",".join(f"{key}=?" for key in data) + " WHERE id=?",
                    (*data.values(), patient["id"]),
                )
            except sqlite3.IntegrityError as error:
                raise RecordConflict("That bed is occupied in this ward. Choose another bed.") from error
            return self.patient(patient_id)

    def _insert_reading(self, patient_number: int, data: dict, timestamp: str, create_alerts=True):
        self.db.execute(
            "INSERT INTO readings(patient_id,timestamp,heart_rate,blood_pressure_sys,blood_pressure_dia,oxygen,temperature,respiratory_rate) VALUES(?,?,?,?,?,?,?,?)",
            (patient_number, timestamp, *[data[key] for key in VITALS]),
        )
        self.db.execute(
            "DELETE FROM readings WHERE patient_id=? AND id NOT IN (SELECT id FROM readings WHERE patient_id=? ORDER BY id DESC LIMIT ?)",
            (patient_number, patient_number, HISTORY_LIMIT),
        )
        if not create_alerts:
            return
        anomalies = detect_anomalies(data)
        existing = self.db.execute("SELECT * FROM alerts WHERE patient_id=? AND active=1", (patient_number,)).fetchall()
        keys = {(item["vital"], item["severity"]) for item in anomalies}
        for alert in existing:
            if (alert["vital"], alert["severity"]) not in keys:
                self.db.execute("UPDATE alerts SET active=0,resolved_at=? WHERE id=?", (timestamp, alert["id"]))
        for anomaly in anomalies:
            message = f"{anomaly['label']} is outside the illustrative range ({anomaly['min']}–{anomaly['max']}). Verify the reading and review with the care team."
            current = next((item for item in existing if item["vital"] == anomaly["vital"] and item["severity"] == anomaly["severity"]), None)
            if current:
                self.db.execute("UPDATE alerts SET value=?,message=? WHERE id=?", (anomaly["value"], message, current["id"]))
            else:
                self.db.execute(
                    "INSERT INTO alerts(patient_id,vital,label,value,severity,message,created_at) VALUES(?,?,?,?,?,?,?)",
                    (patient_number, anomaly["vital"], anomaly["label"], anomaly["value"], anomaly["severity"], message, timestamp),
                )
        # Keep a bounded history while retaining every open alert.
        self.db.execute("DELETE FROM alerts WHERE active=0 AND id NOT IN (SELECT id FROM alerts ORDER BY id DESC LIMIT 2000)")

    def add_reading(self, patient_id: str, data: dict) -> dict:
        with self.lock, self.db:
            patient = self._require_patient(patient_id)
            self._insert_reading(patient["id"], data, now_iso())
            return self._patient(patient)

    def discharge(self, patient_id: str):
        with self.lock, self.db:
            patient = self._require_patient(patient_id)
            timestamp = now_iso()
            self.db.execute("UPDATE patients SET discharged_at=? WHERE id=?", (timestamp, patient["id"]))
            self.db.execute("UPDATE alerts SET active=0,resolved_at=? WHERE patient_id=? AND active=1", (timestamp, patient["id"]))

    @staticmethod
    def _alert(row) -> dict:
        result = dict(row)
        result["alert_id"] = identifier("A", result.pop("id"))
        result["patient_id"] = identifier("P", result["patient_id"])
        result["acknowledged"] = bool(result["acknowledged"])
        result["active"] = bool(result["active"])
        return result

    def alerts(self) -> list[dict]:
        with self.lock:
            return [self._alert(row) for row in self.db.execute(
                "SELECT alerts.*,patients.name AS patient_name FROM alerts JOIN patients ON patients.id=alerts.patient_id ORDER BY alerts.active DESC,alerts.acknowledged ASC,alerts.id DESC LIMIT 200"
            ).fetchall()]

    def acknowledge(self, alert_id: str, author: str) -> dict:
        with self.lock, self.db:
            number = parse_identifier(alert_id, "A")
            row = self.db.execute("SELECT * FROM alerts WHERE id=?", (number,)).fetchone()
            if row is None:
                raise MissingRecord("Alert not found.")
            if not row["acknowledged"]:
                self.db.execute("UPDATE alerts SET acknowledged=1,acknowledged_at=?,acknowledged_by=? WHERE id=?", (now_iso(), author, number))
            row = self.db.execute("SELECT alerts.*,patients.name AS patient_name FROM alerts JOIN patients ON patients.id=alerts.patient_id WHERE alerts.id=?", (number,)).fetchone()
            return self._alert(row)

    @staticmethod
    def _note(row) -> dict:
        result = dict(row)
        result["note_id"] = identifier("N", result.pop("id"))
        result.pop("patient_id", None)
        return result

    def notes(self, patient_id: str) -> list[dict]:
        with self.lock:
            patient = self._require_patient(patient_id)
            return [self._note(row) for row in self.db.execute("SELECT * FROM notes WHERE patient_id=? ORDER BY id DESC LIMIT 100", (patient["id"],)).fetchall()]

    def add_note(self, patient_id: str, content: str, author: str) -> dict:
        with self.lock, self.db:
            patient = self._require_patient(patient_id)
            cursor = self.db.execute("INSERT INTO notes(patient_id,content,author,created_at) VALUES(?,?,?,?)", (patient["id"], content, author, now_iso()))
            return self._note(self.db.execute("SELECT * FROM notes WHERE id=?", (cursor.lastrowid,)).fetchone())

    def tick(self) -> int:
        if not self.demo_mode:
            raise RecordConflict("Simulation is available only in demo mode.")
        with self.lock, self.db:
            rows = self.db.execute("SELECT * FROM patients WHERE simulated=1 AND discharged_at IS NULL").fetchall()
            for row in rows:
                base = json.loads(row["baseline"])
                base["heart_rate"] += random.randint(-2, 2)
                base["blood_pressure_sys"] += random.randint(-2, 2)
                base["blood_pressure_dia"] += random.randint(-1, 1)
                base["oxygen"] = min(100, round(base["oxygen"] + random.choice([-.2, 0, .2]), 1))
                base["temperature"] = round(base["temperature"] + random.choice([-.1, 0, .1]), 1)
                self._insert_reading(row["id"], base, now_iso())
            return len(rows)

    def summary(self) -> dict:
        with self.lock:
            patients = self.patients()
            count = self.db.execute("SELECT COUNT(*) FROM alerts WHERE active=1 AND acknowledged=0").fetchone()[0]
            return {
                "total": len(patients),
                **{status: sum(patient["status"] == status for patient in patients) for status in ("normal", "warning", "critical")},
                "active_alerts": count,
                "refreshed_at": now_iso(),
            }
