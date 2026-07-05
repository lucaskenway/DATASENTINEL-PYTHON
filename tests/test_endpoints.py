import os
import re
import requests


BASE = os.environ.get("DATASENTINEL_URL", "http://127.0.0.1:5000")


def get_csrf_from_html(text):
    m = re.search(r'name="csrf_token" value="([^"]+)"', text)
    return m.group(1) if m else None


def test_login_rejects_external_next_url():
    s = requests.Session()
    r = s.get(f"{BASE}/login?next=https://example.com")
    assert r.status_code == 200

    token = get_csrf_from_html(r.text)
    assert token

    r2 = s.post(
        f"{BASE}/login?next=https://example.com",
        data={
            "username": os.environ.get("DATASENTINEL_ADMIN_USER", "admin"),
            "password": os.environ.get("DATASENTINEL_ADMIN_PASSWORD", "admin1234"),
            "csrf_token": token,
        },
        allow_redirects=False,
    )
    assert r2.status_code in (302, 303)
    assert r2.headers.get("Location") == "/"


def test_endpoints_flow():
    s = requests.Session()
    r = s.get(f"{BASE}/login")
    assert r.status_code == 200

    token = get_csrf_from_html(r.text)
    assert token

    r2 = s.post(f"{BASE}/login", data={
        "username": os.environ.get("DATASENTINEL_ADMIN_USER", "admin"),
        "password": os.environ.get("DATASENTINEL_ADMIN_PASSWORD", "admin1234"),
        "csrf_token": token,
    }, allow_redirects=False)
    assert r2.status_code in (302, 303)

    # metrics
    rm = s.get(f"{BASE}/api/metrics")
    assert rm.status_code == 200
    j = rm.json()
    assert "cpu" in j and "memory" in j

    # logs
    rl = s.get(f"{BASE}/api/logs?n=5")
    assert rl.status_code == 200

    # test_alert using index CSRF
    rh = s.get(f"{BASE}/")
    home_token = re.search(r'<meta name="csrf-token" content="([^"]+)">', rh.text)
    assert home_token
    token2 = home_token.group(1)
    rta = s.post(f"{BASE}/test_alert", headers={"X-CSRF-Token": token2})
    assert rta.status_code == 200

    # ingest_alert without token should be 401
    ri = requests.post(f"{BASE}/api/ingest_alert", json={"ip": "1.2.3.4"})
    assert ri.status_code == 401

    # ingest with token from .env (if present)
    ingest_token = None
    try:
        with open('.env', 'r', encoding='utf-8') as f:
            for ln in f:
                if ln.startswith('DATASENTINEL_INGEST_TOKEN='):
                    ingest_token = ln.strip().split('=', 1)[1]
                    break
    except Exception:
        ingest_token = None

    if ingest_token:
        riti = requests.post(f"{BASE}/api/ingest_alert", json={"ip": "5.6.7.8"}, headers={"Authorization": f"Bearer {ingest_token}"})
        assert riti.status_code == 200
