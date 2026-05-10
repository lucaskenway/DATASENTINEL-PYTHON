app = Flask(__name__)
app.config["SECRET_KEY"] = "secret!"
socketio = SocketIO(app)