"""On-demand, deidentified, bounded AI summaries with an offline fallback."""

import asyncio
import json
import logging
import time

import httpx

from .config import Settings
from .store import now_iso

logger = logging.getLogger(__name__)


class SummaryService:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.lock = asyncio.Lock()
        self.cache: dict[str, tuple[float, str, dict]] = {}
        self.last_request = 0.0

    async def summarize(self, patient: dict) -> dict:
        fallback = {
            "summary": patient["recommendation"], "source": "rules", "generated_at": now_iso(),
            "reading_at": patient["updated_at"],
        }
        if not self.settings.groq_key:
            return fallback
        async with self.lock:
            cached = self.cache.get(patient["patient_id"])
            if cached and cached[1] == patient["updated_at"] and time.monotonic() - cached[0] < 60:
                return cached[2]
            # One provider request every 10 seconds globally, independently of polling.
            if time.monotonic() - self.last_request < 10:
                return fallback
            self.last_request = time.monotonic()
            # Deliberately omit names, identifiers, bed, ward, notes, and free text.
            payload = {
                "adult_vitals": {key: patient[key] for key in (
                    "heart_rate", "blood_pressure_sys", "blood_pressure_dia", "oxygen", "temperature", "respiratory_rate"
                )},
                "illustrative_flags": [{"vital": flag["vital"], "severity": flag["severity"]} for flag in patient["anomalies"]],
                "heart_rate_samples": patient["hr_history"][-12:],
            }
            try:
                async with httpx.AsyncClient(timeout=httpx.Timeout(8.0, connect=3.0)) as client:
                    response = await client.post(
                        "https://api.groq.com/openai/v1/chat/completions",
                        headers={"Authorization": f"Bearer {self.settings.groq_key}"},
                        json={
                            "model": self.settings.groq_model,
                            "messages": [
                                {"role": "system", "content": "Summarize fictional adult monitoring data in at most three short sentences. Describe readings and trends only. Do not diagnose, recommend treatment, medication, dosage, or assert future outcomes. State that a qualified clinician must verify abnormal readings in context. Threshold labels are illustrative and unvalidated. No markdown."},
                                {"role": "user", "content": json.dumps(payload)},
                            ],
                            "max_tokens": 180, "temperature": 0.2,
                        },
                    )
                    response.raise_for_status()
                    content = response.json()["choices"][0]["message"]["content"].strip()
                    if not content or len(content) > 3000:
                        return fallback
                    result = {"summary": content, "source": "groq", "generated_at": now_iso(), "reading_at": patient["updated_at"]}
                    # Bound memory even if a large number of patients are registered.
                    if len(self.cache) >= 200:
                        self.cache.pop(next(iter(self.cache)))
                    self.cache[patient["patient_id"]] = (time.monotonic(), patient["updated_at"], result)
                    return result
            except (httpx.HTTPError, ValueError, KeyError, IndexError, AttributeError, TypeError):
                # Provider errors can contain credentials or request data; never return them.
                logger.warning("Optional summary provider unavailable; using local monitoring summary.")
                return fallback
