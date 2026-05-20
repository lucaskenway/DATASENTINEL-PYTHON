import os
import time

from flask import Flask, render_template, send_from_directory, jsonify, request
from flask_socketio import SocketIO, emit

import psutil

app = Flask(__name__)
app.config["SECRET_KEY"] = "secret!"
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

LOG_FILE = "ataques.log"

_state = {
    "threats_total": 0,
}

_last_net = None
_last_net_t = None


def _defender_coords():
    try:
        lat = float(os.environ.get("DATASENTINEL_DEF_LAT", "-23.55"))
        lon = float(os.environ.get("DATASENTINEL_DEF_LON", "-46.63"))
        return lat, lon
    except ValueError:
        return -23.55, -46.63


def _net_activity_percent():
    global _last_net, _last_net_t
    now = time.time()
    try:
        ctr = psutil.net_io_counters()
    except Exception:
        return 0.0

    pct = 0.0
    if _last_net is not None and _last_net_t is not None:
        dt = now - _last_net_t
        if dt > 0:
            delta = (ctr.bytes_sent + ctr.bytes_recv) - (
                _last_net.bytes_sent + _last_net.bytes_recv
            )
            mb_s = (delta / dt) / (1024 * 1024)
            pct = min(100.0, mb_s * 25.0)

    _last_net = ctr
    _last_net_t = now
    return pct


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/script.js")
def script():
    return send_from_directory("templates", "script.js")


@app.route("/style.css")
def style():
    return send_from_directory("templates", "style.css")


@app.route("/api/metrics")
def api_metrics():
    try:
        conns = psutil.net_connections()
        established = sum(
            1 for c in conns if c.status == psutil.CONN_ESTABLISHED
        )
    except Exception:
        established = 0

    defender_lat, defender_lon = _defender_coords()

    try:
        cpu = psutil.cpu_percent(interval=None)
        mem = psutil.virtual_memory().percent
    except Exception:
        cpu = 0.0
        mem = 0.0

    net_pct = _net_activity_percent()

    return jsonify(
        {
            "cpu": round(cpu, 1),
            "memory": round(mem, 1),
            "network_activity": round(net_pct, 1),
            "connections_active": established,
            "threats_total": _state["threats_total"],
            "defender": {"lat": defender_lat, "lon": defender_lon},
            "ts": time.time(),
        }
    )


@app.route("/api/logs")
def api_logs():
    n = request.args.get("n", default=60, type=int)
    n = max(10, min(n, 500))
    lines = []
    if os.path.isfile(LOG_FILE):
        try:
            with open(LOG_FILE, "r", encoding="utf-8", errors="ignore") as f:
                lines = f.readlines()[-n:]
        except Exception:
            lines = []
    return jsonify({"lines": [ln.rstrip("\n") for ln in lines]})


@app.route("/test_alert")
@app.route("/test_alert/<ip>")
def test_alert(ip=None):
    if ip:
        payload = {
            "ip": ip,
            "country": "Brasil",
            "region": "São Paulo",
            "city": "São Paulo",
            "location": "Brasil - São Paulo",
            "lat": -23.55,
            "lon": -46.63,
            "type": "port_scan",
            "reason": "test_endpoint",
            "timestamp": time.time(),
            "message": f"TESTE manual | IP {ip} | Localização: Brasil - São Paulo",
        }
    else:
        payload = {
            "ip": "8.8.8.8",
            "country": "Estados Unidos",
            "region": "California",
            "city": "Mountain View",
            "location": "Estados Unidos - Mountain View",
            "lat": 37.386,
            "lon": -122.0838,
            "type": "port_scan",
            "reason": "test_endpoint",
            "timestamp": time.time(),
            "message": "TESTE manual | IP 8.8.8.8 | Localização: Estados Unidos - Mountain View",
        }

    _state["threats_total"] += 1
    payload = dict(payload)
    payload["threats_total"] = _state["threats_total"]
    socketio.emit("new_alert", payload)
    return jsonify(success=True, payload=payload)


@socketio.on("connect")
def on_connect():
    emit("session_init", {"threats_total": _state["threats_total"]})


@socketio.on("new_alert")
def relay_new_alert(data):
    if not isinstance(data, dict):
        data = {}
    _state["threats_total"] += 1
    data_out = dict(data)
    data_out["threats_total"] = _state["threats_total"]
    socketio.emit("new_alert", data_out)


if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000)
