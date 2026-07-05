import argparse
import random
import sys
import threading
import time

import socketio

SERVER_URL = "http://127.0.0.1:5000"

LOCATIONS = [
    {
        "country": "Estados Unidos",
        "region": "California",
        "city": "Mountain View",
        "location": "Estados Unidos - Mountain View",
        "lat": 37.386,
        "lon": -122.0838,
    },
    {
        "country": "Brasil",
        "region": "São Paulo",
        "city": "São Paulo",
        "location": "Brasil - São Paulo",
        "lat": -23.55,
        "lon": -46.63,
    },
    {
        "country": "Alemanha",
        "region": "Baviera",
        "city": "Munique",
        "location": "Alemanha - Munique",
        "lat": 48.1351,
        "lon": 11.5820,
    },
    {
        "country": "Japão",
        "region": "Tóquio",
        "city": "Tóquio",
        "location": "Japão - Tóquio",
        "lat": 35.6828,
        "lon": 139.7595,
    },
    {
        "country": "Canadá",
        "region": "Ontário",
        "city": "Toronto",
        "location": "Canadá - Toronto",
        "lat": 43.6532,
        "lon": -79.3832,
    },
]

SEVERITY_MAP = {
    "high": {"type": "port_scan", "reason": "threshold"},
    "medium": {"type": "intrusion", "reason": "ai_anomaly"},
    "low": {"type": "test_event", "reason": "manual_test"},
}


def random_ip():
    return ".".join(str(random.randint(1, 254)) for _ in range(4))


def build_payload(severity):
    loc = random.choice(LOCATIONS)
    ip = random_ip()
    details = SEVERITY_MAP[severity]
    return {
        "ip": ip,
        "country": loc["country"],
        "region": loc["region"],
        "city": loc["city"],
        "location": loc["location"],
        "lat": loc["lat"],
        "lon": loc["lon"],
        "type": details["type"],
        "reason": details["reason"],
        "timestamp": time.time(),
        "message": f"SIMULATED {severity.upper()} alert from {ip} ({loc['location']})",
    }


def emit_alert(client, severity):
    payload = build_payload(severity)
    client.emit("new_alert", payload)
    print(f"[emit] {severity.upper()} -> {payload['ip']} @ {payload['location']}")


def sequential_mode(client):
    print("Modo sequencial: enviando 6 ataques com intervalos crescentes...")
    for i, sev in enumerate(["low", "medium", "high", "medium", "high", "low"]):
        emit_alert(client, sev)
        time.sleep(2 + i * 0.5)
    print("Modo sequencial finalizado.")


def parallel_mode(client):
    print("Modo paralelo: gerando 3 fluxos de ataque simultâneos...")
    threads = []
    for idx in range(3):
        thread = threading.Thread(
            target=lambda: [emit_alert(client, random.choice(["low", "medium", "high"])) or time.sleep(random.uniform(0.8, 1.6)) for _ in range(6)],
            daemon=True,
        )
        thread.start()
        threads.append(thread)
    for thread in threads:
        thread.join()
    print("Modo paralelo finalizado.")


def continuous_mode(client):
    print("Modo contínuo: enviando alertas enquanto não interrompido (CTRL+C)...")
    try:
        while True:
            severity = random.choices(["high", "medium", "low"], [0.35, 0.35, 0.3])[0]
            emit_alert(client, severity)
            time.sleep(random.uniform(1.4, 2.7))
    except KeyboardInterrupt:
        print("Interrompido pelo usuário.")


def parse_args():
    parser = argparse.ArgumentParser(
        description="DataSentinel Real-Time Alert Simulator"
    )
    parser.add_argument(
        "--mode",
        choices=["1", "2", "3", "sequential", "parallel", "continuous"],
        help="Modo de teste: 1/sequential, 2/parallel, 3/continuous",
    )
    return parser.parse_args()


def normalize_mode(choice):
    if not choice:
        return None
    value = choice.strip().lower()
    if value in ("1", "sequential"):
        return "1"
    if value in ("2", "parallel"):
        return "2"
    if value in ("3", "continuous"):
        return "3"
    return None


def main():
    args = parse_args()
    print("DataSentinel Real-Time Alert Simulator")
    print(f"Conectando em {SERVER_URL}")
    client = socketio.Client(logger=False, reconnection=True)

    try:
        client.connect(SERVER_URL, transports=["websocket", "polling"])
    except Exception as exc:
        print(f"Erro ao conectar ao servidor: {exc}")
        sys.exit(1)

    print("Conexão estabelecida.")
    selected_mode = normalize_mode(args.mode)

    if selected_mode is None and sys.stdin.isatty():
        try:
            print("Escolha um modo de teste:")
            print("1 - Ataques sequenciais")
            print("2 - Ataques paralelos")
            print("3 - Ataque contínuo")
            selected_mode = normalize_mode(input("Modo [1-3]: "))
        except KeyboardInterrupt:
            print("\nInterrompido durante a seleção. Usando modo sequencial.")
            selected_mode = "1"

    if selected_mode is None:
        print("Modo padrão selecionado: 1 (sequencial).")
        selected_mode = "1"

    if selected_mode == "1":
        sequential_mode(client)
    elif selected_mode == "2":
        parallel_mode(client)
    elif selected_mode == "3":
        continuous_mode(client)
    else:
        print("Modo inválido. Enviando um único alerta de teste.")
        emit_alert(client, "low")

    client.disconnect()
    print("Simulação encerrada.")


if __name__ == "__main__":
    main()
