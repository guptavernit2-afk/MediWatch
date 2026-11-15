"""Full database snapshots must preserve records beyond the public API window."""

import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys

import pytest

import mediwatch.storage as storage_module
from mediwatch.storage import (
    StorageError,
    backup_database,
    inspect_database,
    restore_database,
)
from mediwatch.store import Store


ROOT = Path(__file__).resolve().parent.parent
TABLES = ("metadata", "patients", "readings", "notes", "alerts", "sqlite_sequence")


def table_contents(path):
    with sqlite3.connect(path) as connection:
        return {
            table: connection.execute(f'SELECT * FROM "{table}" ORDER BY rowid').fetchall()
            for table in TABLES
        }


def run_cli(*arguments, demo_mode="true", database=None):
    environment = dict(os.environ, DEMO_MODE=demo_mode, GROQ_API_KEY="", MEDIWATCH_API_TOKEN="")
    if database is not None:
        environment["MEDIWATCH_DB_PATH"] = str(database)
    return subprocess.run(
        [sys.executable, "-m", "mediwatch.storage", *map(str, arguments)],
        capture_output=True,
        text=True,
        cwd=ROOT,
        env=environment,
        timeout=20,
    )


@pytest.fixture
def live_database(tmp_path, patient_payload):
    # Reserved URI characters and spaces catch accidental URI construction bugs.
    path = tmp_path / "source # fictional workspace.sqlite3"
    store = Store(str(path), demo_mode=True)
    store.open()
    try:
        payload = {**patient_payload, "name": "PRIVATE_STORAGE_SENTINEL"}
        patient = store.create_patient(payload)
        for sample in range(65):
            store.add_reading(patient["patient_id"], {**payload, "heart_rate": 72 + sample % 10})
        for number in range(105):
            store.add_note(patient["patient_id"], f"PRIVATE_OBSERVATION_{number}", "Private author")
        alert = store.alerts()[0]
        store.acknowledge(alert["alert_id"], "Private reviewer")
        store.discharge(patient["patient_id"])
        # Advance a sequence beyond the largest remaining ID, which a row-only
        # reconstruction would lose. This simulates a previous record removal.
        retired = store.create_patient({**payload, "bed": "TEMP-REMOVED"})
        retired_number = int(retired["patient_id"][1:])
        with store.db:
            store.db.execute("DELETE FROM readings WHERE patient_id=?", (retired_number,))
            store.db.execute("DELETE FROM patients WHERE id=?", (retired_number,))
        yield path, store
    finally:
        store.close()


def test_inspection_checks_full_data_without_revealing_rows(live_database):
    path, _store = live_database
    inspection = inspect_database(path)
    assert inspection["format"] == "mediwatch-sqlite-v1"
    assert inspection["integrity"] == "ok"
    assert inspection["demo_mode"] is True
    assert inspection["size_bytes"] > 0
    assert inspection["counts"]["patients"] == 9
    assert inspection["counts"]["active_patients"] == 8
    assert inspection["counts"]["readings"] == 24 * 8 + 66
    assert inspection["counts"]["notes"] == 8 + 105
    rendered = json.dumps(inspection)
    assert "PRIVATE_STORAGE_SENTINEL" not in rendered
    assert "PRIVATE_OBSERVATION" not in rendered
    assert "Private reviewer" not in rendered


def test_backup_includes_committed_wal_data_archives_and_all_history(live_database, tmp_path):
    source, store = live_database
    assert Path(str(source) + "-wal").exists()
    assert len(store.patient("P001")["history"]) <= 60
    destination = tmp_path / "backups" / "nested" / "full.db"
    before = table_contents(source)
    result = backup_database(source, destination)
    assert isinstance(result, dict)
    assert destination.is_file()
    assert result["sha256"] == hashlib.sha256(destination.read_bytes()).hexdigest()
    assert result["size_bytes"] == destination.stat().st_size
    assert table_contents(destination) == before
    assert table_contents(source) == before
    assert inspect_database(destination)["integrity"] == "ok"


def test_restored_workspace_preserves_identifiers_notes_and_sequence(live_database, tmp_path, patient_payload):
    source, _store = live_database
    backup = tmp_path / "archive.db"
    destination = tmp_path / "mounted disk" / "mediwatch.db"
    backup_database(source, backup)
    result = restore_database(backup, destination, expected_demo_mode=True)
    assert isinstance(result, dict)
    assert table_contents(destination) == table_contents(backup)
    restored = Store(str(destination), demo_mode=True)
    restored.open()
    try:
        assert len(restored.patients()) == 8
        assert restored.db.execute("SELECT COUNT(*) FROM patients WHERE discharged_at IS NOT NULL").fetchone()[0] == 1
        assert restored.db.execute("SELECT COUNT(*) FROM notes WHERE content LIKE 'PRIVATE_OBSERVATION_%'").fetchone()[0] == 105
        added = restored.create_patient({**patient_payload, "bed": "AFTER-RESTORE"})
        assert added["patient_id"] == "P011"
    finally:
        restored.close()


@pytest.mark.parametrize("operation", [backup_database, restore_database])
def test_existing_destination_is_never_replaced(operation, live_database, tmp_path):
    source, _store = live_database
    destination = tmp_path / "existing.db"
    destination.write_bytes(b"Existing data must survive")
    before = table_contents(source)
    with pytest.raises(StorageError):
        operation(source, destination)
    assert destination.read_bytes() == b"Existing data must survive"
    assert table_contents(source) == before


@pytest.mark.parametrize("suffix", ["-wal", "-shm", "-journal"])
@pytest.mark.parametrize("operation", [backup_database, restore_database])
def test_destination_with_existing_sqlite_sidecars_is_refused(operation, suffix, live_database, tmp_path):
    source, _store = live_database
    destination = tmp_path / "occupied.db"
    sidecar = Path(str(destination) + suffix)
    sidecar.write_bytes(b"An existing SQLite process may own this file")
    with pytest.raises(StorageError):
        operation(source, destination)
    assert not destination.exists()
    assert sidecar.read_bytes() == b"An existing SQLite process may own this file"


@pytest.mark.parametrize("operation", [backup_database, restore_database])
def test_source_cannot_also_be_the_destination(operation, live_database):
    source, _store = live_database
    before = table_contents(source)
    with pytest.raises(StorageError):
        operation(source, source)
    assert table_contents(source) == before


def test_missing_sources_are_not_silently_created(tmp_path):
    missing = tmp_path / "missing.db"
    destination = tmp_path / "result.db"
    for operation in (inspect_database,):
        with pytest.raises(StorageError):
            operation(missing)
    for operation in (backup_database, restore_database):
        with pytest.raises(StorageError):
            operation(missing, destination)
    assert not missing.exists()
    assert not destination.exists()


@pytest.mark.parametrize("kind", ["text", "json", "unrelated_sqlite", "partial_schema"])
def test_unrecognized_and_partial_databases_are_refused(kind, tmp_path):
    source = tmp_path / "unrecognized.db"
    if kind == "text":
        source.write_bytes(b"This is not SQLite")
    elif kind == "json":
        source.write_text('{"format":"mediwatch-visible-api-snapshot-v1","patients":[]}', encoding="utf-8")
    else:
        with sqlite3.connect(source) as connection:
            connection.execute("CREATE TABLE patients(id INTEGER PRIMARY KEY)")
            if kind == "partial_schema":
                connection.execute("CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT)")
                connection.execute("INSERT INTO metadata VALUES('demo_mode', 'true')")
    destination = tmp_path / "must-not-install.db"
    with pytest.raises(StorageError):
        inspect_database(source)
    with pytest.raises(StorageError):
        restore_database(source, destination)
    assert not destination.exists()


def test_foreign_key_violations_block_backup_and_restore(live_database, tmp_path):
    source, _store = live_database
    broken = tmp_path / "broken.db"
    backup_database(source, broken)
    with sqlite3.connect(broken) as connection:
        connection.execute("PRAGMA foreign_keys=OFF")
        connection.execute("UPDATE notes SET patient_id=999999 WHERE id=(SELECT MIN(id) FROM notes)")
    destination = tmp_path / "rejected.db"
    with pytest.raises(StorageError):
        inspect_database(broken)
    with pytest.raises(StorageError):
        backup_database(broken, destination)
    with pytest.raises(StorageError):
        restore_database(broken, destination)
    assert not destination.exists()


def test_restore_rejects_mode_mismatch_before_creating_target(live_database, tmp_path):
    source, _store = live_database
    destination = tmp_path / "protected" / "real.db"
    with pytest.raises(StorageError):
        restore_database(source, destination, expected_demo_mode=False)
    assert not destination.exists()


def test_cli_inspect_and_backup_use_configured_database_without_exposing_records(live_database, tmp_path):
    source, _store = live_database
    inspected = run_cli("inspect", database=source)
    assert inspected.returncode == 0, inspected.stderr
    result = json.loads(inspected.stdout)
    assert result["counts"]["patients"] == 9
    assert "PRIVATE_STORAGE_SENTINEL" not in inspected.stdout
    assert "PRIVATE_OBSERVATION" not in inspected.stdout
    destination = tmp_path / "cli-backup.db"
    backed_up = run_cli("backup", "--output", destination, database=source)
    assert backed_up.returncode == 0, backed_up.stderr
    assert isinstance(json.loads(backed_up.stdout), dict)
    assert table_contents(destination) == table_contents(source)


def test_cli_restore_uses_environment_mode_and_reports_failures_without_tracebacks(live_database, tmp_path):
    source, _store = live_database
    destination = tmp_path / "cli-restored.db"
    failed = run_cli("restore", "--backup", source, "--database", destination, demo_mode="false")
    assert failed.returncode == 1
    assert not destination.exists()
    assert failed.stderr.strip()
    assert "Traceback" not in failed.stderr
    assert "PRIVATE_STORAGE_SENTINEL" not in failed.stderr
    restored = run_cli("restore", "--backup", source, "--database", destination)
    assert restored.returncode == 0, restored.stderr
    assert isinstance(json.loads(restored.stdout), dict)
    assert table_contents(destination) == table_contents(source)


def test_failed_atomic_install_leaves_no_partial_backup(live_database, tmp_path, monkeypatch):
    source, _store = live_database
    directory = tmp_path / "failed-install"
    destination = directory / "backup.db"
    before = table_contents(source)

    def unavailable_link(_source, _destination):
        raise OSError("Simulated unsupported atomic install")

    monkeypatch.setattr(storage_module.os, "rename" if os.name == "nt" else "link", unavailable_link)
    with pytest.raises(StorageError):
        backup_database(source, destination)
    assert not destination.exists()
    assert list(directory.iterdir()) == []
    assert table_contents(source) == before


def test_destination_created_during_install_is_never_overwritten(live_database, tmp_path, monkeypatch):
    source, _store = live_database
    directory = tmp_path / "install-race"
    destination = directory / "backup.db"
    install_function = "rename" if os.name == "nt" else "link"
    original_install = getattr(storage_module.os, install_function)

    def another_process_wins(temporary, target):
        Path(target).write_bytes(b"Concurrent process owns this destination")
        return original_install(temporary, target)

    monkeypatch.setattr(storage_module.os, install_function, another_process_wins)
    with pytest.raises(StorageError):
        backup_database(source, destination)
    assert destination.read_bytes() == b"Concurrent process owns this destination"
    assert list(directory.iterdir()) == [destination]


def test_commits_during_backup_do_not_mix_snapshot_versions(live_database, tmp_path, monkeypatch):
    source, store = live_database
    destination = tmp_path / "snapshot-before-later-write.db"
    before = inspect_database(source)
    original_inspect = storage_module._inspect_connection
    inserted = False

    def write_after_snapshot_started(connection):
        nonlocal inserted
        report = original_inspect(connection)
        if not inserted:
            inserted = True
            store.add_note("P001", "A write committed after the backup snapshot started", "Concurrent writer")
        return report

    monkeypatch.setattr(storage_module, "_inspect_connection", write_after_snapshot_started)
    result = backup_database(source, destination)
    assert inserted
    assert result["counts"] == before["counts"]
    assert inspect_database(destination)["counts"] == before["counts"]
    assert inspect_database(source)["counts"]["notes"] == before["counts"]["notes"] + 1


@pytest.mark.parametrize("key,value", [("demo_mode", "unknown"), ("seeded", "false")])
def test_unsafe_initialization_metadata_is_rejected(key, value, live_database, tmp_path):
    source, _store = live_database
    invalid = tmp_path / "invalid-metadata.db"
    backup_database(source, invalid)
    with sqlite3.connect(invalid) as connection:
        connection.execute("UPDATE metadata SET value=? WHERE key=?", (value, key))
    with pytest.raises(StorageError):
        inspect_database(invalid)
    destination = tmp_path / "unsafe-restore.db"
    with pytest.raises(StorageError):
        restore_database(invalid, destination)
    assert not destination.exists()


def test_a_truncated_database_is_not_installed(live_database, tmp_path):
    source, _store = live_database
    valid = tmp_path / "valid.db"
    backup_database(source, valid)
    truncated = tmp_path / "truncated.db"
    truncated.write_bytes(valid.read_bytes()[:100])
    destination = tmp_path / "not-restored.db"
    with pytest.raises(StorageError):
        restore_database(truncated, destination)
    assert not destination.exists()


def test_dangling_destination_symlink_is_not_followed(live_database, tmp_path):
    source, _store = live_database
    destination = tmp_path / "destination-link.db"
    unexpected_target = tmp_path / "must-not-create.db"
    try:
        destination.symlink_to(unexpected_target)
    except OSError:
        pytest.skip("Creating symlinks is unavailable in this environment")
    with pytest.raises(StorageError):
        backup_database(source, destination)
    assert destination.is_symlink()
    assert not unexpected_target.exists()


def test_empty_protected_database_can_be_restored_without_seeding_demo_records(tmp_path):
    source = tmp_path / "protected-source.db"
    destination = tmp_path / "protected-restored.db"
    original = Store(str(source), demo_mode=False)
    original.open()
    try:
        report = restore_database(source, destination, expected_demo_mode=False)
        assert report["demo_mode"] is False
        assert all(count == 0 for count in report["counts"].values())
    finally:
        original.close()
    restored = Store(str(destination), demo_mode=False)
    restored.open()
    try:
        assert restored.patients() == []
        assert restored.db.execute("SELECT value FROM metadata WHERE key='demo_mode'").fetchone()[0] == "false"
        assert restored.db.execute("SELECT value FROM metadata WHERE key='seeded'").fetchone() is None
    finally:
        restored.close()
