import time

import psutil

from alerting import LOCAL_IPS, get_geo, push_alert
from detector import classify_attack, detect_suspicious, record_connection
from ai_detector import ai_detect
from firewall import block_ip
from logger import save_log
from email_alert import send_email

ATTACK_TYPE_LABELS = {
    "port_scan": "Port Scan",
    "brute_force": "Forca Bruta",
    "anomalia": "Anomalia comportamental",
}


while True:

    connections = psutil.net_connections()

    for conn in connections:

        try:

            if conn.raddr:

                ip = conn.raddr.ip

                if ip in LOCAL_IPS:
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
