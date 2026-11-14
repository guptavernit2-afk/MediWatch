"""Uvicorn entry point. Run ``uvicorn app:app --reload`` from the project root."""

from mediwatch.api import create_app

app = create_app(start_simulator=True)

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="0.0.0.0", port=8000)
