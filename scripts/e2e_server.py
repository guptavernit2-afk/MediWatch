"""Run an isolated, deterministic demo server for headless browser regression tests."""

import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ["DEMO_MODE"] = "true"
os.environ["GROQ_API_KEY"] = ""
os.environ["MEDIWATCH_API_TOKEN"] = ""

import uvicorn  # noqa: E402

from mediwatch.api import create_app  # noqa: E402

if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="mediwatch-e2e-") as directory:
        application = create_app(db_path=str(Path(directory) / "test.db"), demo_mode=True, start_simulator=False)
        uvicorn.run(application, host="127.0.0.1", port=8765, log_level="warning")
