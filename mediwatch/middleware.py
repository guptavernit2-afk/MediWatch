"""ASGI boundaries: bounded request streaming and consistent response headers."""

import asyncio

from starlette.datastructures import Headers, MutableHeaders
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send


class HTTPBoundaryMiddleware:
    """Read at most 32 KiB before handing a mutation body to FastAPI.

    Content-Length is an early rejection only: chunked requests and clients that
    understate the length receive the same limit while their chunks arrive.
    A total receive deadline also prevents an unfinished body holding a task.
    """

    def __init__(self, app: ASGIApp, max_body_bytes: int = 32_768, body_timeout: float = 10.0):
        self.app = app
        self.max_body_bytes = max_body_bytes
        self.body_timeout = body_timeout

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        async def secured_send(message: Message):
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers["X-Content-Type-Options"] = "nosniff"
                headers["Referrer-Policy"] = "same-origin"
                headers["X-Frame-Options"] = "DENY"
                headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
                # The optional demo API explorer has its own CDN dependencies.
                # The monitoring app, including fonts and icons, is local only.
                if scope["path"] not in {"/docs", "/openapi.json"}:
                    headers["Content-Security-Policy"] = (
                        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
                        "font-src 'self'; img-src 'self' data:; connect-src 'self'; "
                        "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
                    )
                if scope["path"].startswith("/api/"):
                    headers["Cache-Control"] = "no-store"
            await send(message)

        async def reject(status: int, detail: str):
            await JSONResponse({"detail": detail}, status_code=status)(scope, receive, secured_send)

        if scope["method"] not in {"POST", "PUT", "PATCH"}:
            return await self.app(scope, receive, secured_send)

        try:
            length = int(Headers(scope=scope).get("content-length", "0"))
            if length < 0:
                raise ValueError
        except ValueError:
            return await reject(400, "Invalid content length.")
        if length > self.max_body_bytes:
            return await reject(413, "Request body exceeds 32 KiB.")

        payload = bytearray()
        try:
            async with asyncio.timeout(self.body_timeout):
                while True:
                    message = await receive()
                    if message["type"] == "http.disconnect":
                        return
                    chunk = message.get("body", b"")
                    if len(payload) + len(chunk) > self.max_body_bytes:
                        return await reject(413, "Request body exceeds 32 KiB.")
                    payload.extend(chunk)
                    if not message.get("more_body", False):
                        break
        except TimeoutError:
            return await reject(408, "Request body was not completed in time.")

        replayed = False

        async def replay_body():
            nonlocal replayed
            if not replayed:
                replayed = True
                return {"type": "http.request", "body": bytes(payload), "more_body": False}
            return await receive()

        await self.app(scope, replay_body, secured_send)
