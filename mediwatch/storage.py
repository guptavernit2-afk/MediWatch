"""Operator-only SQLite inspection, consistent backup, and safe restore.

Run ``python -m mediwatch.storage --help``. These commands operate on files;
they do not expose database downloads or restore operations through the API.
"""

import argparse
import contextlib
import hashlib
import json
import os
import sqlite3
import sys
import tempfile
import time
from pathlib import Path


class StorageError(Exception):
    """A storage operation could not finish without risking existing records."""


REQUIRED_COLUMNS = {
    "metadata": {"key", "value"},
    "patients": {
        "id", "name", "age", "sex", "ward", "bed", "condition", "admitted_at",
        "discharged_at", "simulated", "baseline",
    },
    "readings": {
        "id", "patient_id", "timestamp", "heart_rate", "blood_pressure_sys",
        "blood_pressure_dia", "oxygen", "temperature", "respiratory_rate",
    },
    "notes": {"id", "patient_id", "content", "author", "created_at"},
    "alerts": {
        "id", "patient_id", "vital", "label", "value", "severity", "message",
        "created_at", "acknowledged", "acknowledged_at", "acknowledged_by",
        "active", "resolved_at",
    },
    "sqlite_sequence": {"name", "seq"},
}
OPERATION_TIMEOUT = 30


def _path(value) -> Path:
    if str(value) == ":memory:":
        raise StorageError("Choose a database file; in-memory databases cannot be migrated.")
    return Path(value).expanduser().resolve()


def _family(path: Path) -> tuple[Path, ...]:
    return (path, *(Path(str(path) + suffix) for suffix in ("-wal", "-shm", "-journal")))


def _available_destination(path: Path):
    if any(item.exists() or item.is_symlink() for item in _family(path)):
        raise StorageError(
            "Destination already exists or has SQLite sidecar files. "
            "Stop the application and choose a new, unused database path."
        )


@contextlib.contextmanager
def _source_connection(path: Path):
    if not path.is_file():
        raise StorageError("Source database file does not exist or is not a regular file.")
    connection = None
    try:
        # mode=ro avoids accidentally creating a missing source database. A live
        # WAL is read through SQLite itself, not by copying only the .db file.
        connection = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=5)
        connection.execute("PRAGMA trusted_schema = OFF")
        deadline = time.monotonic() + OPERATION_TIMEOUT
        connection.set_progress_handler(lambda: int(time.monotonic() > deadline), 1000)
        connection.execute("BEGIN")
        yield connection
    finally:
        if connection is not None:
            connection.close()


def _inspect_connection(connection: sqlite3.Connection) -> dict:
    integrity = connection.execute("PRAGMA integrity_check").fetchall()
    if integrity != [("ok",)]:
        raise StorageError("SQLite integrity validation failed. The source has not been changed.")
    tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if not REQUIRED_COLUMNS.keys() <= tables:
        raise StorageError("This is not a complete, recognized MediWatch SQLite database.")
    for table, columns in REQUIRED_COLUMNS.items():
        actual = {row[1] for row in connection.execute(f'PRAGMA table_info("{table}")')}
        if not columns <= actual:
            raise StorageError("The database schema is not compatible with this MediWatch version.")
    metadata = dict(connection.execute("SELECT key,value FROM metadata"))
    if metadata.get("demo_mode") not in {"true", "false"}:
        raise StorageError("The database is missing a valid demo-mode marker.")
    demo_mode = metadata["demo_mode"] == "true"
    if demo_mode and metadata.get("seeded") != "true":
        raise StorageError("Demo initialization metadata is incomplete; restoring could reseed records.")
    if connection.execute("PRAGMA foreign_key_check").fetchone() is not None:
        raise StorageError("Database foreign-key validation failed. The source has not been changed.")
    counts = {
        table: connection.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
        for table in ("patients", "readings", "notes", "alerts")
    }
    counts["active_patients"] = connection.execute(
        "SELECT COUNT(*) FROM patients WHERE discharged_at IS NULL"
    ).fetchone()[0]
    return {
        "format": "mediwatch-sqlite-v1", "demo_mode": demo_mode,
        "integrity": "ok", "counts": counts,
    }


def inspect_database(path: str | Path) -> dict:
    """Validate a database and return counts, never patient names or row values."""
    try:
        source = _path(path)
        with _source_connection(source) as connection:
            report = _inspect_connection(connection)
        wal = Path(str(source) + "-wal")
        return {
            **report, "path": str(source), "size_bytes": source.stat().st_size,
            "wal_size_bytes": wal.stat().st_size if wal.is_file() else 0,
        }
    except StorageError:
        raise
    except (OSError, sqlite3.Error, ValueError) as error:
        raise StorageError("Unable to inspect a valid MediWatch SQLite database.") from error


def _copy_database(source_value, destination_value, *, expected_demo_mode=None, operation="backup"):
    temporary = None
    try:
        # Refuse a dangling destination symlink before resolve() follows it to
        # an apparently unused filename.
        _available_destination(Path(destination_value).expanduser().absolute())
        source, destination = _path(source_value), _path(destination_value)
        if destination in _family(source) or source in _family(destination):
            raise StorageError("Source and destination must be different database files and sidecar paths.")
        _available_destination(destination)
        with _source_connection(source) as source_connection:
            report = _inspect_connection(source_connection)
            if expected_demo_mode is not None and report["demo_mode"] != expected_demo_mode:
                raise StorageError("Database mode differs from DEMO_MODE. Choose a matching backup or environment.")
            destination.parent.mkdir(parents=True, exist_ok=True)
            descriptor, filename = tempfile.mkstemp(
                prefix=f".mediwatch-{destination.name}.", suffix=".partial", dir=destination.parent,
            )
            os.close(descriptor)
            temporary = Path(filename)
            deadline = time.monotonic() + OPERATION_TIMEOUT

            def check_deadline(_status, _remaining, _total):
                if time.monotonic() > deadline:
                    raise StorageError("Backup timed out. Existing databases have not been replaced.")

            with contextlib.closing(sqlite3.connect(temporary)) as target:
                source_connection.backup(target, pages=128, progress=check_deadline, sleep=.05)
                # Produce a self-contained file, independent of any WAL sidecar.
                target.execute("PRAGMA journal_mode = DELETE")

        # Validate the copied snapshot, rather than assuming validation of the
        # source also verifies that the finished backup is usable.
        verified = inspect_database(temporary)
        if verified["counts"] != report["counts"] or verified["demo_mode"] != report["demo_mode"]:
            raise StorageError("Backup verification failed. No destination database was installed.")
        # Windows requires a writable descriptor for fsync/_commit.
        with temporary.open("r+b") as stream:
            os.fsync(stream.fileno())
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        _available_destination(destination)
        # Windows rename refuses an existing destination. POSIX rename replaces
        # existing files, so use an atomic, non-replacing hard link there instead.
        # Both paths are on the same filesystem by construction.
        if os.name == "nt":
            os.rename(temporary, destination)
        else:
            os.link(temporary, destination)
        return {
            **report, "operation": operation, "path": str(destination),
            "size_bytes": destination.stat().st_size, "sha256": digest,
        }
    except StorageError:
        raise
    except FileExistsError as error:
        raise StorageError("Destination already exists. No existing database was replaced.") from error
    except (OSError, sqlite3.Error, ValueError) as error:
        raise StorageError(
            "The database operation could not complete. No existing database was replaced. "
            "Check source validity, destination permissions, and filesystem support."
        ) from error
    finally:
        if temporary is not None:
            for item in _family(temporary):
                with contextlib.suppress(OSError):
                    item.unlink(missing_ok=True)


def backup_database(source: str | Path, destination: str | Path) -> dict:
    """Create a complete consistent snapshot, including archived records and IDs."""
    return _copy_database(source, destination)


def restore_database(
    backup: str | Path, destination: str | Path, *, expected_demo_mode: bool | None = None,
) -> dict:
    """Restore only to a fresh path. Stop the app before selecting that path."""
    return _copy_database(
        backup, destination, expected_demo_mode=expected_demo_mode, operation="restore",
    )


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    inspect = commands.add_parser("inspect", help="Validate storage and print non-identifying row counts.")
    inspect.add_argument("--database", help="Database path; defaults to MEDIWATCH_DB_PATH.")
    backup = commands.add_parser("backup", help="Back up a live database using SQLite's snapshot API.")
    backup.add_argument("--database", help="Source path; defaults to MEDIWATCH_DB_PATH.")
    backup.add_argument("--output", required=True, help="New backup file; existing files are never overwritten.")
    restore = commands.add_parser("restore", help="Restore a validated backup to an unused database path.")
    restore.add_argument("--backup", required=True, help="A complete SQLite backup, not CSV or an API snapshot.")
    restore.add_argument("--database", help="Fresh destination path; defaults to MEDIWATCH_DB_PATH.")
    args = parser.parse_args(argv)
    try:
        from .config import Settings

        settings = Settings.from_env()
        database = args.database or settings.db_path
        if args.command == "inspect":
            report = inspect_database(database)
        elif args.command == "backup":
            report = backup_database(database, args.output)
        else:
            report = restore_database(args.backup, database, expected_demo_mode=settings.demo_mode)
        print(json.dumps(report))
        return 0
    except (StorageError, ValueError) as error:
        print(f"Storage error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
