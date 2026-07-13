"""Monitora o eve.json do Suricata (formato EVE JSON; Snort3 com o plugin
alert_json produz um formato compativel o suficiente) em tempo real e
repassa alertas de IDS/IPS para o dashboard.

Ao contrario de monitor.py/web_log_monitor.py/auth_log_monitor.py, aqui quem
decide que algo e um ataque e' o proprio motor de regras do Suricata/Snort
(milhares de assinaturas, ex.: Emerging Threats) — este script so filtra
eventos do tipo "alert" por severidade minima, classifica o tipo (por texto
da assinatura/categoria) e repassa. Nao ha limiar proprio: a decisao de "e
suspeito" ja foi tomada rio acima, pela engine de deteccao.
"""

import json
import os
import re
import time

from alerting import LOCAL_IPS, get_geo, push_alert
from email_alert import send_email
from firewall import block_ip
from log_tail import follow
from logger import save_log

EVE_LOG_PATH = os.environ.get("DATASENTINEL_EVE_LOG_PATH")
POLL_INTERVAL = float(os.environ.get("DATASENTINEL_EVE_LOG_POLL", "2"))

# No Suricata, severidade e' numerica e invertida: 1 = mais grave, numeros
# maiores = menos grave. MIN_SEVERITY e' o piso de gravidade aceito (evita
# alertar por eventos informativos de baixa prioridade).
MIN_SEVERITY = int(os.environ.get("DATASENTINEL_EVE_MIN_SEVERITY", "3"))

_CLASSIFY_RULES = [
    ("sql_injection", re.compile(r"sql\s*injection|\bsqli\b", re.IGNORECASE)),
    ("xss", re.compile(r"\bxss\b|cross[- ]site script", re.IGNORECASE)),
    ("port_scan", re.compile(r"\bscan\b|nmap", re.IGNORECASE)),
    ("brute_force", re.compile(r"brute\s*force|login\s*attack|credential", re.IGNORECASE)),
    ("ddos", re.compile(r"\bdos\b|ddos|denial of service|flood", re.IGNORECASE)),
]


def classify_alert(signature, category):
    text = f"{signature} {category}"
    for attack_type, pattern in _CLASSIFY_RULES:
        if pattern.search(text):
            return attack_type
    return "anomalia"


def watch(path):
    print(f"[IDS] Monitorando {path} (Suricata EVE JSON)...")

    for line in follow(path, POLL_INTERVAL):
        line = line.strip()
        if not line:
            continue

        try:
            event = json.loads(line)
        except ValueError:
            continue

        if event.get("event_type") != "alert":
            continue  # eve.json tambem tem eventos http/dns/tls/flow etc.

        alert = event.get("alert") or {}
        severity = alert.get("severity")
        if isinstance(severity, int) and severity > MIN_SEVERITY:
            continue

        ip = event.get("src_ip") or event.get("srcip")
        if not ip or ip in LOCAL_IPS:
            continue

        signature = alert.get("signature") or "Alerta IDS"
        category = alert.get("category") or ""
        attack_type = classify_alert(signature, category)

        geo = get_geo(ip)
        message = (
            f"ATAQUE detectado (IDS: {signature}) de {ip} | "
            f"Localizacao: {geo['location']}"
        )

        save_log(message)
        block_ip(ip)
        send_email("ALERTA DataSentinel", message)

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
            "reason": f"ids_signature:{alert.get('signature_id', '?')}",
            "timestamp": time.time(),
        }
        push_alert(payload)


if __name__ == "__main__":
    if not EVE_LOG_PATH:
        raise SystemExit(
            "DATASENTINEL_EVE_LOG_PATH nao definida — informe o caminho do "
            "eve.json (Suricata) ou log JSON compativel do Snort3 a monitorar."
        )
    if not os.path.isfile(EVE_LOG_PATH):
        raise SystemExit(f"Arquivo de log nao encontrado: {EVE_LOG_PATH}")
    watch(EVE_LOG_PATH)
