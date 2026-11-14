FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MEDIWATCH_DB_PATH=/data/mediwatch.db \
    DEMO_MODE=true \
    PORT=8000

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && groupadd --gid 10001 mediwatch \
    && useradd --uid 10001 --gid mediwatch --create-home mediwatch \
    && mkdir -p /data \
    && chown mediwatch:mediwatch /data

COPY --chown=mediwatch:mediwatch app.py ./
COPY --chown=mediwatch:mediwatch mediwatch ./mediwatch
COPY --chown=mediwatch:mediwatch web ./web

USER mediwatch
VOLUME ["/data"]
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.getenv('PORT', '8000') + '/api/health', timeout=3)"

CMD ["sh", "-c", "exec python -m uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
