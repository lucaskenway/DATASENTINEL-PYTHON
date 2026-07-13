import os

import requests

SERVER_URL = os.environ.get("DATASENTINEL_SERVER_URL", "http://127.0.0.1:5000")
INGEST_TOKEN = os.environ.get("DATASENTINEL_INGEST_TOKEN")

if not INGEST_TOKEN:
    print(
        "[SECURITY] DATASENTINEL_INGEST_TOKEN nao definida — os alertas nao "
        "serao enviados ao dashboard (apenas logados/bloqueados localmente). "
        "Defina a mesma variavel usada pelo server.py."
    )

LOCAL_IPS = {"127.0.0.1", "0.0.0.0", "::1"}


def push_alert(payload):
    """Envia o alerta para o dashboard via POST /api/ingest_alert."""
    if not INGEST_TOKEN:
        return
    try:
        requests.post(
            f"{SERVER_URL}/api/ingest_alert",
            json=payload,
            headers={"Authorization": f"Bearer {INGEST_TOKEN}"},
            timeout=4,
        )
    except Exception:
        pass


def get_geo(ip):
    try:
        response = requests.get(
            f"http://ip-api.com/json/{ip}",
            timeout=4,
        )
        data = response.json()
        if data.get("status") == "fail":
            return {
                "location": "Desconhecido",
                "lat": None,
                "lon": None,
                "country": None,
                "city": None,
                "countryCode": None,
            }
        loc = f"{data.get('country') or '?'} - {data.get('city') or '?'}"
        return {
            "location": loc,
            "lat": data.get("lat"),
            "lon": data.get("lon"),
            "country": data.get("country"),
            "city": data.get("city"),
            "countryCode": data.get("countryCode"),
        }
    except Exception:
        return {
            "location": "Desconhecido",
            "lat": None,
            "lon": None,
            "country": None,
            "city": None,
            "countryCode": None,
        }
