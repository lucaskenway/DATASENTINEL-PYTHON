"""Monitora logs de autenticacao SSH em tempo real para detectar forca bruta
contra o proprio host, por duas fontes independentes (configure uma ou ambas):

- auth.log/secure (mensagens de sshd via syslog): conta tentativas falhas por
  IP numa janela deslizante e alerta ao cruzar um limiar.
- fail2ban.log: fail2ban ja faz sua propria contagem/decisao, entao qualquer
  linha "Ban" e repassada direto como alerta, sem limiar adicional.

Processo independente de monitor.py (conexoes de rede) e web_log_monitor.py
(requisicoes HTTP) — rode em paralelo aos outros se quiser cobrir as tres
fontes.
"""

import os
import re
import threading
import time

from alerting import LOCAL_IPS, get_geo, push_alert, register_incident, suppressed_suffix
from email_alert import send_email
from firewall import block_ip
from log_tail import follow
from logger import save_log

AUTH_LOG_PATH = os.environ.get("DATASENTINEL_AUTH_LOG_PATH")
FAIL2BAN_LOG_PATH = os.environ.get("DATASENTINEL_FAIL2BAN_LOG_PATH")
POLL_INTERVAL = float(os.environ.get("DATASENTINEL_AUTH_LOG_POLL", "2"))

SSH_WINDOW_SECONDS = float(os.environ.get("DATASENTINEL_SSH_WINDOW", "60"))
SSH_THRESHOLD = int(os.environ.get("DATASENTINEL_SSH_THRESHOLD", "5"))

# Cobre as duas mensagens mais comuns de falha de login do sshd via syslog.
# Variantes menos comuns (ex.: "Connection closed ... [preauth]") nao tem o
# IP no mesmo formato e ficam de fora por enquanto.
SSH_FAILURE_RE = re.compile(
    r"sshd\[\d+\]:\s+(?:Failed password for (?:invalid user )?\S+"
    r"|Invalid user \S+) from (?P<ip>[0-9a-fA-F:.]+)"
)

# Formato padrao do fail2ban.log: "... fail2ban.actions [PID]: NOTICE [jail] Ban <ip>"
FAIL2BAN_RE = re.compile(
    r"fail2ban\.actions\s*\[\d+\]:\s*NOTICE\s*\[(?P<jail>[^\]]+)\]\s*"
    r"(?P<action>Ban|Unban)\s+(?P<ip>[0-9a-fA-F:.]+)"
)

_ssh_attempts = {}  # ip -> lista de timestamps das falhas recentes


def _record_ssh_failure(ip):
    now = time.time()
    attempts = _ssh_attempts.setdefault(ip, [])
    attempts.append(now)
    attempts[:] = [t for t in attempts if now - t <= SSH_WINDOW_SECONDS]
    return len(attempts)


def _alert(ip, attack_type, label, detail):
    if ip in LOCAL_IPS:
        return

    block_ip(ip)  # bloqueio imediato, independente de dedup

    should_alert, suppressed = register_incident(ip, attack_type)
    if not should_alert:
        return

    geo = get_geo(ip)
    message = (
        f"ATAQUE detectado ({label}) de {ip} | {detail} | "
        f"Localizacao: {geo['location']}"
        f"{suppressed_suffix(suppressed)}"
    )

    save_log(message)
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
        "reason": detail,
        "timestamp": time.time(),
    }
    push_alert(payload)


def watch_auth_log(path):
    print(f"[AUTH-LOG] Monitorando {path} por forca bruta SSH...")
    for line in follow(path, POLL_INTERVAL):
        match = SSH_FAILURE_RE.search(line)
        if not match:
            continue

        ip = match.group("ip")
        if ip in LOCAL_IPS:
            continue

        count = _record_ssh_failure(ip)
        if count >= SSH_THRESHOLD:
            _alert(
                ip,
                "brute_force",
                "Forca Bruta SSH",
                f"{count} tentativas falhas em {int(SSH_WINDOW_SECONDS)}s",
            )
            _ssh_attempts[ip] = []  # suprime alerta repetido linha-a-linha


def watch_fail2ban_log(path):
    print(f"[FAIL2BAN] Monitorando {path}...")
    for line in follow(path, POLL_INTERVAL):
        match = FAIL2BAN_RE.search(line)
        if not match or match.group("action") != "Ban":
            continue

        ip = match.group("ip")
        _alert(
            ip,
            "brute_force",
            "Forca Bruta (fail2ban)",
            f"jail={match.group('jail')}",
        )


if __name__ == "__main__":
    threads = []

    if AUTH_LOG_PATH:
        if not os.path.isfile(AUTH_LOG_PATH):
            raise SystemExit(f"Arquivo de log nao encontrado: {AUTH_LOG_PATH}")
        threads.append(threading.Thread(target=watch_auth_log, args=(AUTH_LOG_PATH,), daemon=True))

    if FAIL2BAN_LOG_PATH:
        if not os.path.isfile(FAIL2BAN_LOG_PATH):
            raise SystemExit(f"Arquivo de log nao encontrado: {FAIL2BAN_LOG_PATH}")
        threads.append(threading.Thread(target=watch_fail2ban_log, args=(FAIL2BAN_LOG_PATH,), daemon=True))

    if not threads:
        raise SystemExit(
            "Defina DATASENTINEL_AUTH_LOG_PATH e/ou DATASENTINEL_FAIL2BAN_LOG_PATH "
            "com o caminho de pelo menos um log para monitorar."
        )

    for t in threads:
        t.start()
    for t in threads:
        t.join()
