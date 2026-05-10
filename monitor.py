import psutil
import requests
import socketio
import time

from detector import detect_suspicious
from ai_detector import ai_detect
from firewall import block_ip
from logger import save_log
from email_alert import send_email

sio = socketio.Client()

try:
    sio.connect("http://127.0.0.1:5000")
except:
    print("Servidor Flask nao iniciado.")

local_ips = [
    "127.0.0.1",
    "0.0.0.0"
]

def get_location(ip):

    try:
        response = requests.get(
            f"http://ip-api.com/json/{ip}"
        )

        data = response.json()

        return f"{data.get('country')} - {data.get('city')}"

    except:
        return "Desconhecido"

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

                    location = get_location(ip)

                    message = (
                        f"ATAQUE detectado de {ip} | "
                        f"Localizacao: {location}"
                    )

                    save_log(message)

                    block_ip(ip)

                    send_email(
                        "ALERTA DataSentinel",
                        message
                    )

                    try:
                        sio.emit(
                            "new_alert",
                            {"message": message}
                        )
                    except:
                        pass

        except:
            pass

    time.sleep(3)
