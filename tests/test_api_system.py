from server import app


def _client(logged_in):
    client = app.test_client()
    if logged_in:
        with client.session_transaction() as sess:
            sess["logged_in"] = True
    return client


def test_api_system_requires_login():
    assert _client(False).get("/api/system").status_code == 401


def test_api_system_shape():
    r = _client(True).get("/api/system")
    assert r.status_code == 200
    d = r.get_json()
    for key in ("platform", "server_uptime", "socket_clients", "config", "mongodb", "ai", "network"):
        assert key in d, key
    assert set(d["mongodb"]) == {"configured", "online", "docs", "host"}
    assert "password" not in str(d["config"]).lower()
    assert set(d["ai"]) == {"trained", "trained_at", "samples"}
    net = d["network"]
    assert isinstance(net["interfaces"], list)
    assert isinstance(net["listening"], list)
    assert len(net["connections"]) <= 80
    assert net["connections_total"] >= len(net["connections"])


def test_db_status_never_exposes_credentials(monkeypatch):
    import database
    monkeypatch.setattr(database, "MONGODB_URI", "mongodb://user:segredo@10.0.0.20:27017/?authSource=admin")
    st = database.status()
    assert st["host"] == "10.0.0.20:27017"
    assert "segredo" not in str(st)
