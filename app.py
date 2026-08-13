import threading

try:
    import webview
except ImportError as exc:
    raise SystemExit(
        "PyWebview não está instalado. Execute: pip install pywebview"
    ) from exc

from server import app, socketio


def start_server():
    socketio.run(app, host='127.0.0.1', port=5000, allow_unsafe_werkzeug=True)


if __name__ == '__main__':
    server_thread = threading.Thread(target=start_server, daemon=True)
    server_thread.start()

    webview.create_window(
        'DataSentinel',
        'http://127.0.0.1:5000/login',
        width=1366,
        height=840,
        resizable=True,
        fullscreen=False,
    )
    webview.start()
