# API guide

The API and dashboard share the same origin. JSON request bodies use `Content-Type: application/json`. Public demo mode is intended only for fictional data.

When `DEMO_MODE=false`, protected API requests require:

```http
Authorization: Bearer <MEDIWATCH_API_TOKEN>
```

`GET /api/health` and `GET /api/config` are available without the token. Non-demo startup requires a configured token and a database separate from any existing demo database.

## Endpoints

| Method | Path                                   | Result                                                                    |
| ------ | -------------------------------------- | ------------------------------------------------------------------------- |
| GET    | `/api/health`                          | Process health, version, and mode                                         |
| GET    | `/api/config`                          | Demo mode, AI availability, refresh interval, version, auth requirement   |
| GET    | `/api/summary`                         | Active patient counts by status and outstanding alert count               |
| GET    | `/api/thresholds`                      | Transparent illustrative adult thresholds and disclaimer                  |
| GET    | `/api/patients`                        | Active patients with current vitals and recent reading history            |
| POST   | `/api/patients`                        | Create a patient and initial reading; returns `201`                       |
| GET    | `/api/patients/{patient_id}`           | One active patient                                                        |
| PATCH  | `/api/patients/{patient_id}`           | Update demographic or placement fields                                    |
| POST   | `/api/patients/{patient_id}/readings`  | Persist a timestamped vital reading; returns `201`                        |
| POST   | `/api/patients/{patient_id}/discharge` | Discharge a patient and free the active bed                               |
| GET    | `/api/patients/{patient_id}/notes`     | Recent notes, newest first                                                |
| POST   | `/api/patients/{patient_id}/notes`     | Add a note; returns `201`                                                 |
| POST   | `/api/patients/{patient_id}/summary`   | Generate an on-demand local or provider summary                           |
| GET    | `/api/alerts`                          | Persistent alert review queue and recent history                          |
| POST   | `/api/alerts/{alert_id}/acknowledge`   | Record acknowledgement; repeated calls preserve the first acknowledgement |
| GET    | `/api/export`                          | Active patient CSV snapshot                                               |
| POST   | `/api/demo/tick`                       | Advance fictional seeded records once; demo mode only                     |

Patient listing accepts optional `q`, `status`, and `ward` query parameters. Status values are `normal`, `warning`, and `critical`. For example:

```http
GET /api/patients?q=sharma&status=normal
```

## Create a fictional patient

```bash
curl -X POST http://localhost:8000/api/patients \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Demo Person",
    "age": 42,
    "sex": "Female",
    "ward": "General",
    "bed": "G-101",
    "condition": "Observation",
    "heart_rate": 76,
    "blood_pressure_sys": 118,
    "blood_pressure_dia": 76,
    "oxygen": 98,
    "temperature": 36.7,
    "respiratory_rate": 16
  }'
```

The response contains the created record, including its `patient_id`, current status, anomalies, and initial history. Use the returned ID for subsequent calls; IDs are not reused after discharge.

Active ward-and-bed combinations are unique, compared without case sensitivity. A conflicting assignment returns `409`. Supported `sex` values are `Male`, `Female`, `Other`, and `Not specified`; the field defaults to `Not specified`.

This demonstration uses adult-oriented illustrative ranges and accepts ages **18–120**. It is not designed for pediatric monitoring.

## Submit a sensor reading

Create the patient once, then send subsequent measurements to the reading endpoint rather than creating another patient:

```bash
curl -X POST http://localhost:8000/api/patients/P001/readings \
  -H "Content-Type: application/json" \
  -d '{
    "heart_rate": 82,
    "blood_pressure_sys": 122,
    "blood_pressure_dia": 78,
    "oxygen": 97,
    "temperature": 36.8,
    "respiratory_rate": 17
  }'
```

The server assigns the ingestion timestamp. A successful request returns the updated patient snapshot. The request updates monitoring flags and persistent alerts in the same workflow. Fetching the patient does not generate additional measurements.

### Input validation

| Field                | Accepted input                                            |
| -------------------- | --------------------------------------------------------- |
| `name`               | Trimmed text, 2–100 characters                            |
| `age`                | Integer, 18–120                                           |
| `heart_rate`         | Integer, 20–250 bpm                                       |
| `blood_pressure_sys` | Integer, 40–300 mmHg                                      |
| `blood_pressure_dia` | Integer, 20–200 mmHg, below systolic                      |
| `oxygen`             | Number, 50–100 percent                                    |
| `temperature`        | Number, 30–43 °C; defaults to 36.8                        |
| `respiratory_rate`   | Integer, 4–70 breaths/min; defaults to 16                 |
| `ward`               | Trimmed text, 1–80 characters; defaults to `General`      |
| `bed`                | Trimmed text, 1–20 characters                             |
| `condition`          | Trimmed text, 1–180 characters; defaults to `Observation` |

These broad bounds reject implausible input. They are separate from the narrower illustrative monitoring thresholds. Unknown JSON properties and non-finite numbers are rejected.

Patient responses include `history` as timestamped readings in chronological order, `hr_history` for compatibility, `anomalies` with the threshold and severity for each flag, and a deterministic `recommendation` for monitoring review. The current API returns the most recent 60 readings per patient and bounds stored reading history to 720 entries.

## Notes and alert review

```bash
curl -X POST http://localhost:8000/api/patients/P001/notes \
  -H "Content-Type: application/json" \
  -d '{"content":"Fictional follow-up observation recorded.","author":"Demo operator"}'

curl -X POST http://localhost:8000/api/alerts/A001/acknowledge \
  -H "Content-Type: application/json" \
  -d '{"acknowledged_by":"Demo operator"}'
```

Notes accept 1–3,000 trimmed characters. Author labels accept 1–80 characters and default to `Demo operator`. Labels are user-entered attribution, not verified identities.

Alerts include `alert_id`, `patient_id`, `patient_name`, `vital`, `label`, `value`, `severity`, `message`, `created_at`, `active`, `acknowledged`, `acknowledged_at`, and `acknowledged_by`. An active flag represents an ongoing illustrative anomaly. Acknowledging it records review without clearing the underlying reading. A normalized later reading can resolve the active flag while leaving history available.

## On-demand summaries

```bash
curl -X POST http://localhost:8000/api/patients/P001/summary
```

Response fields are `summary`, `source` (`rules` or `groq`), `generated_at`, and `reading_at` identifying the reading snapshot summarized. With no provider key, the request uses local rules. Configured provider access is invoked only by this explicit endpoint, uses a minimal vitals payload without direct identifiers, and falls back locally if unavailable. Summaries are unvalidated demonstration text.

## Errors and exports

- `401`: missing or incorrect Bearer token for a protected endpoint.
- `404`: missing or discharged patient, missing alert, or an unavailable demo operation.
- `409`: occupied bed or another state conflict.
- `422`: input validation failed; `detail` explains the field errors.

CSV exports represent the current active patient snapshot. Text fields that could start spreadsheet formulas are neutralized with a leading apostrophe. They do not export the full longitudinal reading history.
