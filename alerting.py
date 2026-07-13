import os
import time

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

DEDUP_WINDOW_SECONDS = float(os.environ.get("DATASENTINEL_DEDUP_WINDOW", "60"))

_incidents = {}  # (ip, attack_type) -> {"window_start": ts, "count": int}


def register_incident(ip, attack_type):
    """Agrupa eventos repetidos do mesmo IP+tipo numa janela de tempo, para
    que um unico ataque continuo (ex.: brute force rodando por minutos) gere
    um alerta a cada janela, com contador, em vez de um log/e-mail/push por
    evento individual. O bloqueio de IP (firewall.block_ip) deve continuar
    acontecendo sempre, independente do resultado daqui — so a notificacao
    (log/e-mail/dashboard) e' throttled.

    Retorna (deve_alertar, suprimidos_desde_o_ultimo_alerta)."""
    key = (ip, attack_type)
    now = time.time()
    state = _incidents.get(key)

    if state is None or now - state["window_start"] >= DEDUP_WINDOW_SECONDS:
        suppressed = state["count"] - 1 if state else 0
        _incidents[key] = {"window_start": now, "count": 1}
        return True, suppressed

    state["count"] += 1
    return False, 0


def suppressed_suffix(suppressed):
    if not suppressed:
        return ""
    return f" | +{suppressed} ocorrencias nos ultimos {int(DEDUP_WINDOW_SECONDS)}s"


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
