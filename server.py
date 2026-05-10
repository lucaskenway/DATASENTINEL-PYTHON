from flask import Flask, render_template
from flask_socketio import SocketIO

app = Flask(__name__)

socketio = SocketIO(app)

alerts = []

@app.route("/")
def home():
    return render_template("index.html")

@socketio.on("new_alert")
def handle_alert(data):
    alerts.append(data)

    socketio.emit("receive_alert", data)

if __name__ == "__main__":
    socketio.run(
        app,
        host="0.0.0.0",
        port=5000,
        debug=True
    )
