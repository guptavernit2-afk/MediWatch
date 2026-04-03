import os
import random
import csv
from io import StringIO
from datetime import datetime
from pydantic import BaseModel
from groq import Groq
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.responses import HTMLResponse, StreamingResponse
import uvicorn

load_dotenv()

client = Groq(api_key=os.getenv("GROQ_API_KEY"))
app = FastAPI()

THRESHOLDS = {
    "heart_rate": {"min": 60, "max": 100},
    "blood_pressure_sys": {"min": 90, "max": 140},
    "blood_pressure_dia": {"min": 60, "max": 90},
    "oxygen": {"min": 95, "max": 100},
}

PATIENTS_DATA = [
    {"patient_id": "P001", "name": "Raj Sharma",   "age": 45, "heart_rate": 72,  "blood_pressure_sys": 120, "blood_pressure_dia": 80,  "oxygen": 98},
    {"patient_id": "P002", "name": "Priya Patel",  "age": 32, "heart_rate": 65,  "blood_pressure_sys": 115, "blood_pressure_dia": 75,  "oxygen": 99},
    {"patient_id": "P003", "name": "Amit Verma",   "age": 60, "heart_rate": 105, "blood_pressure_sys": 160, "blood_pressure_dia": 100, "oxygen": 91},
    {"patient_id": "P004", "name": "Sunita Rao",   "age": 28, "heart_rate": 88,  "blood_pressure_sys": 118, "blood_pressure_dia": 76,  "oxygen": 97},
    {"patient_id": "P005", "name": "Vikram Singh", "age": 55, "heart_rate": 48,  "blood_pressure_sys": 85,  "blood_pressure_dia": 55,  "oxygen": 93},
]

HR_HISTORY = {p["patient_id"]: [p["heart_rate"]] * 6 for p in PATIENTS_DATA}

def detect_anomalies(entry: dict) -> list:
    anomalies = []
    for vital, limits in THRESHOLDS.items():
        val = entry.get(vital)
        if val is not None and (val < limits["min"] or val > limits["max"]):
            anomalies.append({"vital": vital, "value": val, "min": limits["min"], "max": limits["max"]})
    return anomalies

def get_status(anomalies):
    if not anomalies: return "normal"
    elif len(anomalies) >= 3: return "critical"
    else: return "warning"

def get_ai_recommendation(patient: dict, anomalies: list, hr_history: list) -> str:
    if not anomalies:
        return "All vitals stable. Continue routine monitoring."
    anomaly_text = ", ".join([f"{a['vital']}={a['value']} (normal {a['min']}-{a['max']})" for a in anomalies])
    trend = " -> ".join([str(h) for h in hr_history])
    prompt = f"Patient {patient['name']} (Age {patient['age']}). HR Trend: {trend}. Anomalies: {anomaly_text}. Give a 2-sentence medical recommendation."
    try:
        response = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {"role": "system", "content": "You are a concise clinical AI. Give actionable medical recommendations."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=100
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        return f"AI unavailable: {str(e)}"

class PatientCreate(BaseModel):
    name: str
    age: int
    heart_rate: int
    blood_pressure_sys: int
    blood_pressure_dia: int
    oxygen: int

@app.post("/api/patients")
def add_patient(patient: PatientCreate):
    new_id = f"P{len(PATIENTS_DATA) + 1:03d}"
    new_patient = {
        "patient_id": new_id,
        "name": patient.name,
        "age": patient.age,
        "heart_rate": patient.heart_rate,
        "blood_pressure_sys": patient.blood_pressure_sys,
        "blood_pressure_dia": patient.blood_pressure_dia,
        "oxygen": patient.oxygen,
    }
    PATIENTS_DATA.append(new_patient)
    HR_HISTORY[new_id] = [patient.heart_rate] * 6
    return {"status": "success", "patient_id": new_id}

@app.get("/api/patients")
def get_patients():
    results = []
    for p in PATIENTS_DATA:
        pid = p["patient_id"]
        new_hr  = p["heart_rate"] + random.randint(-3, 3)
        new_sys = p["blood_pressure_sys"] + random.randint(-2, 2)
        new_dia = p["blood_pressure_dia"] + random.randint(-1, 1)
        new_o2  = min(100, p["oxygen"] + random.randint(-1, 1))

        HR_HISTORY[pid].append(new_hr)
        HR_HISTORY[pid] = HR_HISTORY[pid][-6:]

        entry = {
            "patient_id": pid,
            "name": p["name"],
            "age": p["age"],
            "timestamp": datetime.now().strftime("%H:%M:%S"),
            "heart_rate": new_hr,
            "blood_pressure_sys": new_sys,
            "blood_pressure_dia": new_dia,
            "oxygen": new_o2,
            "hr_history": HR_HISTORY[pid],
        }
        anomalies = detect_anomalies(entry)
        entry["anomalies"] = anomalies
        entry["status"] = get_status(anomalies)
        entry["recommendation"] = get_ai_recommendation(entry, anomalies, HR_HISTORY[pid])
        results.append(entry)
    return results

@app.get("/api/export")
def export_csv():
    output = StringIO()
    writer = csv.writer(output)
    writer.writerow(["patient_id", "name", "age", "heart_rate", "blood_pressure_sys", "blood_pressure_dia", "oxygen"])
    for p in PATIENTS_DATA:
        writer.writerow([p["patient_id"], p["name"], p["age"], p["heart_rate"], p["blood_pressure_sys"], p["blood_pressure_dia"], p["oxygen"]])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=patients.csv"}
    )

@app.get("/", response_class=HTMLResponse)
def dashboard():
    with open("index.html", "r", encoding="utf-8") as f:
        return f.read()

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)