"""HTTP body limits apply before JSON parsing, including streamed requests."""


def assert_protected_error(response, status):
    assert response.status_code == status, response.text
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"


def test_declared_oversized_body_is_rejected_before_payload_parsing(client):
    response = client.post(
        "/api/patients", content=b"{}",
        headers={"Content-Type": "application/json", "Content-Length": "32769"},
    )
    assert_protected_error(response, 413)


def test_chunked_body_without_content_length_still_has_a_size_limit(client):
    before = len(client.get("/api/patients").json())

    def chunks():
        yield b'{"name":"'
        yield b"x" * 20_000
        yield b"x" * 20_000
        yield b'"}'

    response = client.post(
        "/api/patients", content=chunks(), headers={"Content-Type": "application/json"},
    )
    assert "content-length" not in response.request.headers
    assert_protected_error(response, 413)
    assert len(client.get("/api/patients").json()) == before


def test_negative_content_length_is_rejected(client):
    response = client.post(
        "/api/patients", content=b"{}",
        headers={"Content-Type": "application/json", "Content-Length": "-1"},
    )
    assert_protected_error(response, 400)


def test_malformed_content_length_is_rejected(client):
    response = client.post(
        "/api/patients", content=b"{}",
        headers={"Content-Type": "application/json", "Content-Length": "not-a-length"},
    )
    assert_protected_error(response, 400)
