"""Monitora um access log de servidor web (Apache/nginx, formato "combined")
em tempo real e classifica requisicoes com assinaturas conhecidas de SQL
Injection ou XSS no path/query string. Processo independente de monitor.py
(que olha conexoes de rede, nao payload HTTP) — rode os dois em paralelo se
quiser cobrir ambas as fontes.
"""

import os
import re
import time
from urllib.parse import unquote

from alerting import LOCAL_IPS, get_geo, push_alert
from email_alert import send_email
from firewall import block_ip
from logger import save_log

WEB_LOG_PATH = os.environ.get("DATASENTINEL_WEB_LOG_PATH")
POLL_INTERVAL = float(os.environ.get("DATASENTINEL_WEB_LOG_POLL", "2"))

# Formato combined: %h %l %u %t "%r" %>s %b "referer" "user-agent"
LOG_LINE_RE = re.compile(
    r'^(?P<ip>\S+) \S+ \S+ \[[^\]]+\] '
    r'"(?P<method>[A-Z]+) (?P<path>\S+) [^"]*" '
    r'(?P<status>\d{3}) \S+'
)

SQLI_PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for p in [
        r"union(\s+all)?\s+select",
        r"select\s.+\sfrom\s",
        r"\bor\b\s+\d+\s*=\s*\d+",
        r"'\s*or\s*'?\d*'?\s*=\s*'?\d*",
        r"drop\s+table",
        r"insert\s+into.+values",
        r";\s*--",
        r"sleep\(\s*\d+\s*\)",
        r"benchmark\(",
        r"xp_cmdshell",
        r"information_schema",
    ]
]

XSS_PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for p in [
        r"<script[\s>]",
        r"onerror\s*=",
        r"onload\s*=",
        r"javascript:",
        r"<img[^>]+src\s*=",
        r"<svg[^>]+onload",
        r"document\.cookie",
    ]
]

ATTACK_TYPE_LABELS = {
    "sql_injection": "SQL Injection",
    "xss": "XSS",
}


def classify_payload(path):
    decoded = unquote(path)
    for pattern in SQLI_PATTERNS:
        if pattern.search(decoded):
            return "sql_injection"
    for pattern in XSS_PATTERNS:
        if pattern.search(decoded):
            return "xss"
    return None


def _open_at_end(path):
    f = open(path, "r", encoding="utf-8", errors="ignore")
    f.seek(0, os.SEEK_END)
    return f


def watch(path):
    print(f"[WEB-LOG] Monitorando {path} (formato combined) por SQLi/XSS...")
    f = _open_at_end(path)

    while True:
        line = f.readline()
        if not line:
            time.sleep(POLL_INTERVAL)
            try:
                if os.path.getsize(path) < f.tell():
                    # logrotate truncou/rotacionou o arquivo — reabre do zero
                    f.close()
                    f = _open_at_end(path)
            except OSError:
                pass
            continue

        match = LOG_LINE_RE.match(line)
        if not match:
            continue

        ip = match.group("ip")
        if ip in LOCAL_IPS:
            continue

        request_path = match.group("path")
        attack_type = classify_payload(request_path)
        if not attack_type:
            continue

        geo = get_geo(ip)
        label = ATTACK_TYPE_LABELS[attack_type]
        message = (
            f"ATAQUE detectado ({label}) de {ip} | "
            f"Requisicao: {match.group('method')} {request_path[:120]} | "
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
            "reason": "web_log_signature",
            "timestamp": time.time(),
        }
        push_alert(payload)


if __name__ == "__main__":
    if not WEB_LOG_PATH:
        raise SystemExit(
            "DATASENTINEL_WEB_LOG_PATH nao definida — informe o caminho do "
            "access log (Apache/nginx, formato combined) a monitorar."
        )
    if not os.path.isfile(WEB_LOG_PATH):
        raise SystemExit(f"Arquivo de log nao encontrado: {WEB_LOG_PATH}")
    watch(WEB_LOG_PATH)
