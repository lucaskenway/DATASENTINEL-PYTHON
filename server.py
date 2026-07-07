import ipaddress
import os
import re
import secrets
import time
from functools import wraps
from urllib.parse import urlparse

from dotenv import load_dotenv
from flask import (
    Flask,
    abort,
    jsonify,
    redirect,
    render_template,
    request,
    send_from_directory,
    session,
    url_for,
)
from flask_socketio import SocketIO, emit
from werkzeug.security import check_password_hash, generate_password_hash

import psutil

load_dotenv()

app = Flask(__name__)

LOG_FILE = "ataques.log"


# ---------------------------------------------------------------------------
# Configuracao de seguranca (SECRET_KEY, cookies, CORS)
# ---------------------------------------------------------------------------

def _load_secret_key():
    key = os.environ.get("DATASENTINEL_SECRET_KEY")
    if key:
        return key
    print(
        "[SECURITY] DATASENTINEL_SECRET_KEY nao definida — usando chave "
        "temporaria valida so para esta execucao (sessoes serao invalidadas "
        "a cada restart). Defina a variavel de ambiente para uso continuo."
    )
    return secrets.token_hex(32)


app.config["SECRET_KEY"] = _load_secret_key()
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_SECURE"] = os.environ.get("DATASENTINEL_FORCE_SECURE_COOKIE") == "1"


def _allowed_origins():
    raw = os.environ.get("DATASENTINEL_ALLOWED_ORIGINS", "")
    origins = [o.strip() for o in raw.split(",") if o.strip()]
    return origins or None  # None -> flask-socketio so aceita same-origin


socketio = SocketIO(app, cors_allowed_origins=_allowed_origins(), async_mode="threading")


# ---------------------------------------------------------------------------
# Autenticacao (usuario unico, credenciais via variavel de ambiente)
# ---------------------------------------------------------------------------

def _load_admin_credentials():
    user = os.environ.get("DATASENTINEL_ADMIN_USER", "admin")
    password = os.environ.get("DATASENTINEL_ADMIN_PASSWORD")
    if not password:
        password = secrets.token_urlsafe(12)
        print("[SECURITY] DATASENTINEL_ADMIN_PASSWORD nao definida.")
        print(f"[SECURITY] Usuario: {user}")
        print(f"[SECURITY] Senha temporaria gerada para esta execucao: {password}")
        print(
            "[SECURITY] Defina DATASENTINEL_ADMIN_USER e DATASENTINEL_ADMIN_PASSWORD "
            "como variaveis de ambiente para um login estavel."
        )
    return user, generate_password_hash(password)


ADMIN_USER, ADMIN_PASSWORD_HASH = _load_admin_credentials()


def _load_ingest_token():
    token = os.environ.get("DATASENTINEL_INGEST_TOKEN")
    if not token:
        token = secrets.token_urlsafe(24)
        print(
            "[SECURITY] DATASENTINEL_INGEST_TOKEN nao definida — gerando "
            "token temporario para esta execucao."
        )
        print(f"[SECURITY] Token de ingestao: {token}")
        print(
            "[SECURITY] Configure monitor.py (ou outra integracao externa) "
            "com o mesmo valor via DATASENTINEL_INGEST_TOKEN."
        )
    return token


INGEST_TOKEN = _load_ingest_token()

_login_attempts = {}
LOGIN_MAX_ATTEMPTS = 5
LOGIN_WINDOW_SECONDS = 300


def _login_rate_limited(ip):
    now = time.time()
    attempts = [t for t in _login_attempts.get(ip, []) if now - t < LOGIN_WINDOW_SECONDS]
    _login_attempts[ip] = attempts
    return len(attempts) >= LOGIN_MAX_ATTEMPTS


def _record_login_failure(ip):
    _login_attempts.setdefault(ip, []).append(time.time())


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not session.get("logged_in"):
            if request.path.startswith("/api/"):
                abort(401)
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)
    return wrapped


def _valid_csrf(token):
    expected = session.get("csrf_token")
    return bool(token) and bool(expected) and secrets.compare_digest(token, expected)


def _is_safe_redirect_target(target):
    return isinstance(target, str) and target.startswith("/") and not target.startswith("//")


def _safe_next_url(target):
    return target if _is_safe_redirect_target(target) else "/"


def csrf_protect(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        token = request.headers.get("X-CSRF-Token") or request.form.get("csrf_token") or ""
        if not _valid_csrf(token):
            abort(403, description="Token CSRF invalido ou ausente")
        return view(*args, **kwargs)
    return wrapped


@app.after_request
def set_security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Cache-Control"] = "no-store"
    return response


@app.errorhandler(400)
def handle_bad_request(_):
    return jsonify(error="Requisicao invalida"), 400


@app.errorhandler(401)
def handle_unauthorized(_):
    return jsonify(error="Nao autorizado"), 401


@app.errorhandler(403)
def handle_forbidden(_):
    return jsonify(error="Acesso proibido"), 403


@app.errorhandler(404)
def handle_not_found(_):
    return jsonify(error="Recurso nao encontrado"), 404


@app.route("/login", methods=["GET", "POST"])
def login():
    error = None
    requested_next = request.args.get("next") or request.form.get("next") or "/"
    safe_next = requested_next if _is_safe_redirect_target(requested_next) else "/"

    if request.method == "POST":
        client_ip = request.remote_addr or "unknown"
        if _login_rate_limited(client_ip):
            error = "Muitas tentativas. Tente novamente em alguns minutos."
        elif not _valid_csrf(request.form.get("csrf_token") or ""):
            session.clear()
            session["csrf_token"] = secrets.token_hex(16)
            error = "Token CSRF inválido. Atualize a página e tente novamente."
        else:
            username = (request.form.get("username", "") or "").strip()
            password = request.form.get("password", "") or ""
            if username == ADMIN_USER and check_password_hash(ADMIN_PASSWORD_HASH, password):
                session.clear()
                session["logged_in"] = True
                session["user"] = username
                session["csrf_token"] = secrets.token_hex(16)
                return redirect(_safe_next_url(safe_next) or url_for("index"))
            _record_login_failure(client_ip)
            error = "Usuario ou senha invalidos."

    session["csrf_token"] = session.get("csrf_token") or secrets.token_hex(16)
    return render_template(
        "login.html",
        error=error,
        csrf_token=session["csrf_token"],
        next_path=safe_next,
    )


@app.route("/logout", methods=["POST"])
@csrf_protect
def logout():
    session.clear()
    return redirect(url_for("login"))


# ---------------------------------------------------------------------------
# Estado / metricas
# ---------------------------------------------------------------------------

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


def _net_stats():
    global _last_net, _last_net_t
    now = time.time()
    try:
        ctr = psutil.net_io_counters()
    except Exception:
        return 0.0, 0.0, 0.0

    pct, tx, rx = 0.0, 0.0, 0.0
    if _last_net is not None and _last_net_t is not None:
        dt = now - _last_net_t
        if dt > 0:
            tx = round((ctr.bytes_sent - _last_net.bytes_sent) / dt / (1024 * 1024), 2)
            rx = round((ctr.bytes_recv - _last_net.bytes_recv) / dt / (1024 * 1024), 2)
            pct = min(100.0, (tx + rx) * 25.0)

    _last_net = ctr
    _last_net_t = now
    return pct, tx, rx


# ---------------------------------------------------------------------------
# Sanitizacao de payload de alerta (defesa em profundidade contra XSS/log forging)
# ---------------------------------------------------------------------------

_ALLOWED_ALERT_FIELDS = {
    "ip", "country", "region", "city", "location", "type",
    "reason", "message", "countryCode",
}
_MAX_STR_LEN = 200
_CONTROL_CHARS = re.compile(r"[\r\n\x00-\x1f]")


def _sanitize_alert(data):
    if not isinstance(data, dict):
        data = {}
    clean = {}

    for key in _ALLOWED_ALERT_FIELDS:
        value = data.get(key)
        if isinstance(value, str):
            clean[key] = _CONTROL_CHARS.sub(" ", value)[:_MAX_STR_LEN]

    for key in ("lat", "lon"):
        try:
            clean[key] = float(data.get(key))
        except (TypeError, ValueError):
            clean[key] = None

    try:
        clean["timestamp"] = float(data.get("timestamp"))
    except (TypeError, ValueError):
        clean["timestamp"] = time.time()

    return clean


def _append_alert_log(payload):
    """Grava o alerta em ataques.log para que /api/logs (pagina de Logs e
    terminal) reflita os eventos assim que a proxima leitura acontecer."""
    ts = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(payload.get("timestamp") or time.time()))
    message = payload.get("message") or f"{payload.get('type', 'desconhecido')} | IP {payload.get('ip', '-')}"
    line = f"[{ts}] BLOCK | {message}"
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass


# ---------------------------------------------------------------------------
# Rotas
# ---------------------------------------------------------------------------

@app.route("/")
@login_required
def index():
    session.setdefault("csrf_token", secrets.token_hex(16))
    return render_template("index.html", csrf_token=session["csrf_token"])


@app.route("/script.js")
def script():
    response = send_from_directory("templates", "script.js")
    response.headers["Cache-Control"] = "no-store"
    return response


@app.route("/style.css")
def style():
    response = send_from_directory("templates", "style.css")
    response.headers["Cache-Control"] = "no-store"
    return response


@app.route("/imagens/<path:filename>")
@login_required
def image(filename):
    image_dir = os.path.join(app.root_path, "templates", "imagens")
    return send_from_directory(image_dir, filename)


@app.route("/api/metrics")
@login_required
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

    try:
        disk = psutil.disk_usage("/").percent
    except Exception:
        disk = 0.0

    net_pct, net_tx, net_rx = _net_stats()

    return jsonify(
        {
            "cpu": round(cpu, 1),
            "memory": round(mem, 1),
            "disk": round(disk, 1),
            "network_activity": round(net_pct, 1),
            "net_tx_mbps": net_tx,
            "net_rx_mbps": net_rx,
            "connections_active": established,
            "threats_total": _state["threats_total"],
            "defender": {"lat": defender_lat, "lon": defender_lon},
            "ts": time.time(),
        }
    )


@app.route("/api/logs")
@login_required
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


@app.route("/test_alert", methods=["POST"])
@app.route("/test_alert/<ip>", methods=["POST"])
@login_required
@csrf_protect
def test_alert(ip=None):
    if ip:
        try:
            ipaddress.ip_address(ip)
        except ValueError:
            abort(400, description="IP invalido")
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

    payload = _sanitize_alert(payload)
    _state["threats_total"] += 1
    payload["threats_total"] = _state["threats_total"]
    _append_alert_log(payload)
    socketio.emit("new_alert", payload)
    return jsonify(success=True, payload=payload)


@app.route("/api/ingest_alert", methods=["POST"])
def ingest_alert():
    """Endpoint para integracoes de servico (ex.: monitor.py) enviarem
    alertas reais. Usa um token de servico dedicado — nao a sessao de
    usuario — porque quem chama aqui nao e um navegador autenticado."""
    auth = request.headers.get("Authorization", "")
    token = auth[7:] if auth.startswith("Bearer ") else ""
    if not token or not secrets.compare_digest(token, INGEST_TOKEN):
        abort(401)

    if not request.is_json:
        abort(400, description="JSON invalido")

    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        abort(400, description="Payload deve ser um objeto JSON")

    clean = _sanitize_alert(data)
    _state["threats_total"] += 1
    clean["threats_total"] = _state["threats_total"]
    _append_alert_log(clean)
    socketio.emit("new_alert", clean)
    return jsonify(success=True)


@socketio.on("connect")
def on_connect():
    if not session.get("logged_in"):
        return False
    emit("session_init", {"threats_total": _state["threats_total"]})


if __name__ == "__main__":
    host = os.environ.get("DATASENTINEL_HOST", "127.0.0.1")
    port = int(os.environ.get("DATASENTINEL_PORT", "5000"))
    if host == "0.0.0.0":
        print(
            "[SECURITY] Servidor exposto em 0.0.0.0 (todas as interfaces de "
            "rede). Use apenas atras de um proxy reverso com TLS e em redes "
            "confiaveis."
        )
    # allow_unsafe_werkzeug: este projeto roda com o servidor de
    # desenvolvimento do Flask (uso local/dev). Para producao de verdade,
    # use um servidor WSGI real (gunicorn+eventlet) atras de um proxy com TLS.
    socketio.run(app, host=host, port=port, allow_unsafe_werkzeug=True)
