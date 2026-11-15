# Backups and persistent storage

MediWatch already stores records in SQLite. The database location is controlled by `MEDIWATCH_DB_PATH`, which defaults to `data/mediwatch.db`. Records survive application restarts when that file remains available. A hosting provider's ephemeral filesystem can still discard it during a restart or redeployment.

The storage tools below are ready to use without connecting a hosting account. They run from the project root with the same Python environment as the app. They do not provision a Render disk or change a running service.

## Inspect and back up a database

Inspect the current database:

```bash
python -m mediwatch.storage inspect --database data/mediwatch.db
```

The command validates the MediWatch schema, database integrity, foreign keys, and workspace mode. Its JSON output reports counts for patients, active patients, readings, notes, and alerts; it does not print patient record contents.

Create a complete backup at a new destination:

```bash
python -m mediwatch.storage backup --database data/mediwatch.db --output data/backups/mediwatch-before-move.sqlite3
python -m mediwatch.storage inspect --database data/backups/mediwatch-before-move.sqlite3
```

Backup uses [SQLite's online backup API through Python](https://docs.python.org/3/library/sqlite3.html#sqlite3.Connection.backup), so it can capture a consistent database while the app is running in WAL mode. It preserves all stored tables, including discharged patients, retained reading history, notes, alert acknowledgements, workspace metadata, and identifier sequences. The app retains at most 720 readings per patient; a backup cannot recover readings already removed by that retention policy.

A backup is a point-in-time snapshot. For a migration, plan a maintenance window and pause new readings and user writes before the final backup. Keep writes paused until the restored workspace is active; edits made after the snapshot are not transferred automatically.

Keep a private copy outside the service that hosts the app. A backup saved only to the same ephemeral filesystem will disappear with the database. Backups contain patient data: do not commit them, publish them, or place them in `web/`. The repository ignores `data/` and SQLite database files.

## Restore to a fresh location

Stop the app before restoring and switching its database path. Use a destination that does not exist:

```bash
python -m mediwatch.storage restore --backup data/backups/mediwatch-before-move.sqlite3 --database data/restored/mediwatch.db
python -m mediwatch.storage inspect --database data/restored/mediwatch.db
```

Then set the application's location in `.env` and restart:

```dotenv
MEDIWATCH_DB_PATH=data/restored/mediwatch.db
```

Restore validates the backup before installing it. It refuses to overwrite an existing database or a path with SQLite `-wal`, `-shm`, or `-journal` companions. There is no overwrite option; retain the existing database and choose another destination.

`DEMO_MODE` must match the backup's workspace mode. The default is `true`; restore a non-demo backup with `DEMO_MODE=false` configured. Changing the storage path does not convert fictional demo records into non-demo records.

For each command, omitting `--database` uses `MEDIWATCH_DB_PATH` or the default database location. `backup` still requires `--output`, and `restore` still requires `--backup`. Successful commands print JSON; failures report an error and exit with a nonzero status. These are operator commands, with no public HTTP backup or restore endpoint.

## Enable Render persistence later

Render requires a paid service for persistent disks. A suitable small-workspace configuration is a **1 GB disk mounted at `/var/data`**, with:

```dotenv
MEDIWATCH_DB_PATH=/var/data/mediwatch.db
```

Keep one Uvicorn worker. Only files written beneath the mount path survive redeployments. See [Render's persistent disk documentation](https://render.com/docs/disks).

For an existing service:

1. Before any plan change, disk attachment, or redeployment, back up the **current live database** and download it outside the service. Verify the backup with `inspect` and retain its reported counts. A partial snapshot from the application API is not a complete database backup: that API omits discharged patients and limits the history, notes, and alerts it returns.
2. Attach the persistent disk. Disk attachment triggers a deployment, so the original ephemeral database must already be secured. If the service is Free, Render does not provide shell or SSH access, and upgrading also requires a deployment; resolve how to preserve its current database before making either change. [Render Free service limitations](https://render.com/docs/free)
3. Upload the verified backup to the new running instance. From its runtime shell, restore it to the unused `/var/data/mediwatch.db` path. Do this before changing `MEDIWATCH_DB_PATH` to that destination. Persistent disks are unavailable to build and pre-deploy commands.
4. Set `MEDIWATCH_DB_PATH=/var/data/mediwatch.db`, redeploy, and compare the restored counts and observations with the backup.
5. Redeploy once more and verify the same patient records, identifiers, observations, and alert reviews remain. Continue keeping independent SQLite backups after migration.

These instructions prepare the feature for later activation. A repository change alone does not attach storage or verify a hosting account's disk configuration.
