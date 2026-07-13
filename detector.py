import time

WINDOW_SECONDS = 10
PORT_WINDOW_SECONDS = 60
THRESHOLD = 20
PORT_SCAN_THRESHOLD = 8  # portas distintas na janela para classificar como port scan

_connections = {}  # ip -> lista de timestamps das conexoes recentes
_ports = {}        # ip -> {porta_local: ultimo_timestamp_visto}


def record_connection(ip, port=None):
    """Registra uma conexao real observada agora para esse IP e devolve as
    features atuais (usadas tanto pelo limiar quanto pelo detector de IA)."""
    now = time.time()

    timestamps = _connections.setdefault(ip, [])
    timestamps.append(now)
    timestamps[:] = [t for t in timestamps if now - t <= WINDOW_SECONDS]

    if port is not None:
        ports = _ports.setdefault(ip, {})
        ports[port] = now
        for stale_port, seen_at in list(ports.items()):
            if now - seen_at > PORT_WINDOW_SECONDS:
                del ports[stale_port]

    conn_count = len(timestamps)
    distinct_ports = len(_ports.get(ip, {}))
    return conn_count, distinct_ports


def detect_suspicious(ip):
    """Assume que record_connection(ip, ...) ja foi chamado neste ciclo."""
    return len(_connections.get(ip, [])) >= THRESHOLD


def classify_attack(conn_count, distinct_ports):
    """Classifica o padrao observado com base nas features reais da conexao.
    Port scan = muitas portas locais distintas tocadas pelo mesmo IP; brute
    force = muitas conexoes concentradas (tipicamente na mesma porta, ex. SSH/
    RDP); qualquer outra coisa que so a IA tenha sinalizado fica como
    anomalia genérica, ja que o monitor nao inspeciona payload (nao da pra
    distinguir SQLi/XSS so pela conexao de rede)."""
    if distinct_ports >= PORT_SCAN_THRESHOLD:
        return "port_scan"
    if conn_count >= THRESHOLD:
        return "brute_force"
    return "anomalia"
