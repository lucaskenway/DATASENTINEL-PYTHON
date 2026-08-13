import os
import socket
import threading
import time

import pytest

from server import app, socketio


HOST = "127.0.0.1"
PORT = int(os.environ.get("DATASENTINEL_PORT", "5000"))


def _wait_for_port(host: str, port: int, timeout: float = 15.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection((host, port), timeout=0.5):
                return True
        except OSError:
            time.sleep(0.1)
    return False


@pytest.fixture(scope="session", autouse=True)
def start_test_server():
    try:
        with socket.create_connection((HOST, PORT), timeout=0.3):
            yield
            return
    except OSError:
        pass

    thread = threading.Thread(
        target=socketio.run,
        args=(app,),
        kwargs={
            "host": HOST,
            "port": PORT,
            "debug": False,
            "use_reloader": False,
            "allow_unsafe_werkzeug": True,
        },
        daemon=True,
    )
    thread.start()

    assert _wait_for_port(HOST, PORT), "Servidor de testes não subiu em localhost:5000"

    yield
