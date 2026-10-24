import ipaddress
import time

import psutil

from alerting import LOCAL_IPS, get_geo, push_alert, register_incident, suppressed_suffix
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

# Abaixo disso a IA so coleta amostras: com pouquissimas conexoes nao ha
# padrao de ataque, e o IsolationForest sempre marca uma fracao como outlier.
AI_MIN_CONNECTIONS = 5

_seen_connections = set()  # (porta_local, ip_remoto, porta_remota) ja contadas


def _is_local(ip):
    if ip in LOCAL_IPS:
        return True
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    if getattr(addr, "ipv4_mapped", None):
        addr = addr.ipv4_mapped
    return addr.is_loopback or addr.is_unspecified


while True:

    connections = psutil.net_connections()

    # So conexoes de ENTRADA (alguem conectando numa porta que esta maquina
    # escuta) podem ser ataque. Conexoes de saida (navegador, updates...) usam
    # uma porta local efemera diferente por conexao e geravam falso "port scan".
    listening_ports = {
        c.laddr.port for c in connections
        if c.status == psutil.CONN_LISTEN and c.laddr
    }
    active_connections = set()

    for conn in connections:

        try:

            if conn.raddr and conn.laddr and conn.laddr.port in listening_ports:

                ip = conn.raddr.ip

                if _is_local(ip):
                    continue

                # Cada conexao so conta uma vez, nao a cada ciclo em que
                # continua aberta.
                key = (conn.laddr.port, ip, conn.raddr.port)
                active_connections.add(key)
                if key in _seen_connections:
                    continue

                local_port = conn.laddr.port
                conn_count, distinct_ports = record_connection(ip, local_port)

                suspicious = detect_suspicious(ip)
                ai_result = (
                    ai_detect([conn_count, distinct_ports])
                    and conn_count >= AI_MIN_CONNECTIONS
                )

                if suspicious or ai_result:

                    attack_type = classify_attack(conn_count, distinct_ports)

                    block_ip(ip)  # bloqueio imediato, independente de dedup

                    should_alert, suppressed = register_incident(ip, attack_type)
                    if not should_alert:
                        continue

                    geo = get_geo(ip)
                    type_label = ATTACK_TYPE_LABELS[attack_type]

                    message = (
                        f"ATAQUE detectado ({type_label}) de {ip} | "
                        f"Localizacao: {geo['location']}"
                        f"{suppressed_suffix(suppressed)}"
                    )

                    save_log(message)

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

    _seen_connections = active_connections

    time.sleep(3)
