"""Illustrative adult thresholds. This is not a validated clinical scoring system.

Thresholds are intentionally visible and deterministic. A single severe value
raises a critical flag; counting anomalies alone must never hide that signal.
These demo ranges are unsuitable for children or patient-specific decisions.
"""

THRESHOLDS = {
    "heart_rate": {"label": "Heart rate", "min": 60, "max": 100, "critical_min": 45, "critical_max": 130},
    "blood_pressure_sys": {"label": "Systolic pressure", "min": 90, "max": 140, "critical_min": 80, "critical_max": 180},
    "blood_pressure_dia": {"label": "Diastolic pressure", "min": 60, "max": 90, "critical_min": 45, "critical_max": 120},
    "oxygen": {"label": "Oxygen saturation", "min": 95, "max": 100, "critical_min": 92, "critical_max": None},
    "temperature": {"label": "Temperature", "min": 36, "max": 37.8, "critical_min": 35, "critical_max": 39},
    "respiratory_rate": {"label": "Respiratory rate", "min": 12, "max": 20, "critical_min": 8, "critical_max": 30},
}


def detect_anomalies(reading: dict) -> list[dict]:
    anomalies = []
    for vital, limits in THRESHOLDS.items():
        value = reading.get(vital)
        if value is None or limits["min"] <= value <= limits["max"]:
            continue
        critical = (limits["critical_min"] is not None and value < limits["critical_min"]) or (
            limits["critical_max"] is not None and value >= limits["critical_max"]
        )
        anomalies.append({
            "vital": vital, "label": limits["label"], "value": value,
            "min": limits["min"], "max": limits["max"],
            "severity": "critical" if critical else "warning",
        })
    return anomalies


def get_status(anomalies: list[dict]) -> str:
    if any(item["severity"] == "critical" for item in anomalies):
        return "critical"
    return "warning" if anomalies else "normal"


def recommendation(reading: dict) -> str:
    anomalies = detect_anomalies(reading)
    if not anomalies:
        return "Recorded values are within this demo's illustrative adult ranges. Continue observation and review the trend with the care team."
    labels = ", ".join(item["label"].lower() for item in anomalies)
    prefix = "Prioritize review by a qualified clinician" if get_status(anomalies) == "critical" else "Arrange review by the care team"
    return f"{prefix}: {labels} fall outside the illustrative ranges. Verify the readings and assess them in the patient's clinical context."
