import argparse
import os
import random
import sys
import threading
import time

import requests
from dotenv import load_dotenv

load_dotenv()

SERVER_URL = os.environ.get("DATASENTINEL_SERVER_URL", "http://127.0.0.1:5000")
INGEST_TOKEN = os.environ.get("DATASENTINEL_INGEST_TOKEN")

# Lista de cidades/paises usada para variar a origem dos alertas simulados.
LOCATIONS = [
    {"country": "Estados Unidos", "region": "California", "city": "Mountain View", "lat": 37.386, "lon": -122.0838},
    {"country": "Estados Unidos", "region": "Virginia", "city": "Ashburn", "lat": 39.0438, "lon": -77.4874},
    {"country": "Brasil", "region": "São Paulo", "city": "São Paulo", "lat": -23.55, "lon": -46.63},
    {"country": "Brasil", "region": "Rio de Janeiro", "city": "Rio de Janeiro", "lat": -22.9068, "lon": -43.1729},
    {"country": "Alemanha", "region": "Baviera", "city": "Munique", "lat": 48.1351, "lon": 11.5820},
    {"country": "Alemanha", "region": "Hesse", "city": "Frankfurt", "lat": 50.1109, "lon": 8.6821},
    {"country": "Japão", "region": "Tóquio", "city": "Tóquio", "lat": 35.6828, "lon": 139.7595},
    {"country": "Canadá", "region": "Ontário", "city": "Toronto", "lat": 43.6532, "lon": -79.3832},
    {"country": "Rússia", "region": "Moscou", "city": "Moscou", "lat": 55.7558, "lon": 37.6173},
    {"country": "China", "region": "Xangai", "city": "Xangai", "lat": 31.2304, "lon": 121.4737},
    {"country": "Índia", "region": "Maharashtra", "city": "Mumbai", "lat": 19.0760, "lon": 72.8777},
    {"country": "França", "region": "Île-de-France", "city": "Paris", "lat": 48.8566, "lon": 2.3522},
    {"country": "Reino Unido", "region": "Inglaterra", "city": "Londres", "lat": 51.5074, "lon": -0.1278},
    {"country": "Holanda", "region": "Holanda do Norte", "city": "Amsterdã", "lat": 52.3676, "lon": 4.9041},
    {"country": "Austrália", "region": "Nova Gales do Sul", "city": "Sydney", "lat": -33.8688, "lon": 151.2093},
    {"country": "Coreia do Sul", "region": "Seul", "city": "Seul", "lat": 37.5665, "lon": 126.9780},
    {"country": "México", "region": "Cidade do México", "city": "Cidade do México", "lat": 19.4326, "lon": -99.1332},
    {"country": "África do Sul", "region": "Gauteng", "city": "Joanesburgo", "lat": -26.2041, "lon": 28.0473},
    {"country": "Argentina", "region": "Buenos Aires", "city": "Buenos Aires", "lat": -34.6037, "lon": -58.3816},
    {"country": "Ucrânia", "region": "Kiev", "city": "Kiev", "lat": 50.4501, "lon": 30.5234},
]

for _loc in LOCATIONS:
    _loc["location"] = f"{_loc['country']} - {_loc['city']}"

SEVERITY_MAP = {
    "high": {"type": "port_scan", "reason": "threshold"},
    "medium": {"type": "intrusion", "reason": "ai_anomaly"},
    "low": {"type": "test_event", "reason": "manual_test"},
}


def random_ip():
    return ".".join(str(random.randint(1, 254)) for _ in range(4))


def build_payload(severity):
    loc, target = random.sample(LOCATIONS, 2)
    ip = random_ip()
    target_ip = random_ip()
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
        "target_ip": target_ip,
        "target_city": target["city"],
        "target_location": target["location"],
        "target_lat": target["lat"],
        "target_lon": target["lon"],
        "message": (
            f"SIMULATED {severity.upper()} attack from {ip} ({loc['location']}) "
            f"-> {target_ip} ({target['location']})"
        ),
    }


def send_alert(session, severity):
    payload = build_payload(severity)
    try:
        resp = session.post(
            f"{SERVER_URL}/api/ingest_alert",
            json=payload,
            headers={"Authorization": f"Bearer {INGEST_TOKEN}"},
            timeout=4,
        )
        status = "OK" if resp.ok else f"HTTP {resp.status_code}"
    except requests.RequestException as exc:
        status = f"ERRO ({exc})"
    print(
        f"[{status}] {severity.upper()} {payload['ip']} @ {payload['location']} "
        f"-> {payload['target_ip']} @ {payload['target_location']}"
    )


def sequential_mode(session):
    print("Modo sequencial: enviando 6 ataques com intervalos crescentes...")
    for i, sev in enumerate(["low", "medium", "high", "medium", "high", "low"]):
        send_alert(session, sev)
        time.sleep(2 + i * 0.5)
    print("Modo sequencial finalizado.")


def parallel_worker(session):
    for _ in range(6):
        severity = random.choice(["low", "medium", "high"])
        send_alert(session, severity)
        time.sleep(random.uniform(0.8, 1.6))


def parallel_mode(session):
    print("Modo paralelo: gerando 3 fluxos de ataque simultâneos...")
    threads = []
    for _ in range(3):
        thread = threading.Thread(target=parallel_worker, args=(session,), daemon=True)
        thread.start()
        threads.append(thread)
    for thread in threads:
        thread.join()
    print("Modo paralelo finalizado.")


def continuous_mode(session, interval):
    print(
        f"Modo contínuo: enviando alertas a cada ~{interval:.0f}s "
        "enquanto não interrompido (CTRL+C)..."
    )
    try:
        while True:
            severity = random.choices(["high", "medium", "low"], [0.35, 0.35, 0.3])[0]
            send_alert(session, severity)
            time.sleep(random.uniform(interval * 0.8, interval * 1.2))
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
    parser.add_argument(
        "--token",
        help="Token de ingestao (equivale a DATASENTINEL_INGEST_TOKEN). "
        "Sobrepoe a variavel de ambiente, se informado.",
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=8.0,
        help="Intervalo medio em segundos entre alertas no modo continuo "
        "(padrao: 8s, com variacao de +/-20%%).",
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
    global INGEST_TOKEN
    args = parse_args()
    if args.token:
        INGEST_TOKEN = args.token

    print("DataSentinel Real-Time Alert Simulator")
    print(f"Servidor: {SERVER_URL}")

    if not INGEST_TOKEN:
        print(
            "Erro: DATASENTINEL_INGEST_TOKEN nao definida.\n"
            "Use a mesma variavel de ambiente configurada no server.py "
            "(ela e impressa no console dele ao iniciar, se nao tiver sido "
            "definida manualmente) ou passe --token <valor>."
        )
        sys.exit(1)

    session = requests.Session()
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
        sequential_mode(session)
    elif selected_mode == "2":
        parallel_mode(session)
    elif selected_mode == "3":
        continuous_mode(session, args.interval)
    else:
        print("Modo inválido. Enviando um único alerta de teste.")
        send_alert(session, "low")

    print("Simulação encerrada.")


if __name__ == "__main__":
    main()
