import os
import time

import psutil
import requests

from detector import classify_attack, detect_suspicious, record_connection
from ai_detector import ai_detect
from firewall import block_ip
from logger import save_log
from email_alert import send_email

SERVER_URL = os.environ.get("DATASENTINEL_SERVER_URL", "http://127.0.0.1:5000")
INGEST_TOKEN = os.environ.get("DATASENTINEL_INGEST_TOKEN")

if not INGEST_TOKEN:
    print(
        "[SECURITY] DATASENTINEL_INGEST_TOKEN nao definida — os alertas nao "
        "serao enviados ao dashboard (apenas logados/bloqueados localmente). "
        "Defina a mesma variavel usada pelo server.py."
    )


def push_alert(payload):
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


local_ips = [
    "127.0.0.1",
    "0.0.0.0",
]

ATTACK_TYPE_LABELS = {
    "port_scan": "Port Scan",
    "brute_force": "Forca Bruta",
    "anomalia": "Anomalia comportamental",
}


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


while True:

    connections = psutil.net_connections()

    for conn in connections:

        try:

            if conn.raddr:

                ip = conn.raddr.ip

                if ip in local_ips:
                    continue

                local_port = conn.laddr.port if conn.laddr else None
                conn_count, distinct_ports = record_connection(ip, local_port)

                suspicious = detect_suspicious(ip)
                ai_result = ai_detect([conn_count, distinct_ports])

                if suspicious or ai_result:

                    geo = get_geo(ip)
                    attack_type = classify_attack(conn_count, distinct_ports)
                    type_label = ATTACK_TYPE_LABELS[attack_type]

                    message = (
                        f"ATAQUE detectado ({type_label}) de {ip} | "
                        f"Localizacao: {geo['location']}"
                    )

                    save_log(message)

                    block_ip(ip)

                    send_email(
                        "ALERTA DataSentinel",
                        message,
                    )

                    reasons = []
                    if suspicious:
                        reasons.append("threshold")
                    if ai_result:
                        reasons.append("ai_anomaly")

                    payload = {
                        "message": message,
                        "ip": ip,
                        "location": geo["location"],
                        "lat": geo["lat"],
                        "lon": geo["lon"],
                        "country": geo["country"],
                        "city": geo["city"],
                        "countryCode": geo["countryCode"],
                        "type": attack_type,
                        "reason": "+".join(reasons) if reasons else "unknown",
                        "timestamp": time.time(),
                    }

                    push_alert(payload)

        except Exception:
            pass

    time.sleep(3)
