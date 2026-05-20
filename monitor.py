import time

import psutil
import requests
import socketio

from detector import detect_suspicious
from ai_detector import ai_detect
from firewall import block_ip
from logger import save_log
from email_alert import send_email

sio = socketio.Client()

try:
    sio.connect("http://127.0.0.1:5000")
except Exception:
    print("Servidor Flask nao iniciado.")

local_ips = [
    "127.0.0.1",
    "0.0.0.0",
]


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

                suspicious = detect_suspicious(ip)
                ai_result = ai_detect(50)

                if suspicious or ai_result:

                    geo = get_geo(ip)

                    message = (
                        f"ATAQUE detectado de {ip} | "
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
                        "type": "intrusion",
                        "reason": "+".join(reasons) if reasons else "unknown",
                        "timestamp": time.time(),
                    }

                    try:
                        sio.emit("new_alert", payload)
                    except Exception:
                        pass

        except Exception:
            pass

    time.sleep(3)
