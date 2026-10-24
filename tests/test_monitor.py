from collections import namedtuple

import psutil
import pytest

import monitor

Addr = namedtuple("Addr", "ip port")
Conn = namedtuple("Conn", "laddr raddr status")


def listening(port):
    return Conn(Addr("0.0.0.0", port), (), psutil.CONN_LISTEN)


def inbound(remote_ip, remote_port, local_port=22):
    return Conn(Addr("192.168.1.10", local_port), Addr(remote_ip, remote_port),
                psutil.CONN_ESTABLISHED)


def outbound(remote_ip, local_port, remote_port=443):
    return Conn(Addr("192.168.1.10", local_port), Addr(remote_ip, remote_port),
                psutil.CONN_ESTABLISHED)


@pytest.mark.parametrize(
    "ip, expected",
    [
        ("127.0.0.1", True),
        ("127.0.0.5", True),
        ("::1", True),
        ("::ffff:127.0.0.1", True),
        ("0.0.0.0", True),
        ("203.0.113.5", False),
        ("192.168.1.20", False),
        ("nao-e-ip", False),
    ],
)
def test_is_local(ip, expected):
    assert monitor._is_local(ip) is expected


def test_outbound_connections_are_ignored():
    # navegador abrindo varias conexoes para o mesmo site: antes virava "port scan"
    connections = [listening(22)] + [
        outbound("203.0.113.5", port) for port in range(50000, 50020)
    ]

    new, active = monitor.new_inbound_connections(connections, set())

    assert new == []
    assert active == set()


def test_inbound_connections_are_reported():
    connections = [listening(22), inbound("203.0.113.5", 40001),
                   inbound("203.0.113.5", 40002)]

    new, active = monitor.new_inbound_connections(connections, set())

    assert new == [("203.0.113.5", 22), ("203.0.113.5", 22)]
    assert active == {(22, "203.0.113.5", 40001), (22, "203.0.113.5", 40002)}


def test_inbound_from_loopback_is_ignored():
    connections = [listening(5000), inbound("127.0.0.1", 40001, local_port=5000),
                   inbound("::ffff:127.0.0.1", 40002, local_port=5000)]

    new, _ = monitor.new_inbound_connections(connections, set())

    assert new == []


def test_open_connection_counts_only_once():
    connections = [listening(22), inbound("203.0.113.5", 40001)]

    new1, seen = monitor.new_inbound_connections(connections, set())
    new2, seen = monitor.new_inbound_connections(connections, seen)
    new3, _ = monitor.new_inbound_connections(connections, seen)

    assert len(new1) == 1
    assert new2 == []
    assert new3 == []


def test_closed_connection_is_forgotten():
    conn = inbound("203.0.113.5", 40001)

    _, seen = monitor.new_inbound_connections([listening(22), conn], set())
    _, seen = monitor.new_inbound_connections([listening(22)], seen)
    assert seen == set()

    # mesma tupla reaparecendo depois de fechar e uma conexao nova
    new, _ = monitor.new_inbound_connections([listening(22), conn], seen)
    assert new == [("203.0.113.5", 22)]


@pytest.fixture
def handled(monkeypatch):
    """Isola handle_connection de rede, disco, e-mail e firewall."""
    calls = {"blocked": [], "alerts": []}
    monkeypatch.setattr(monitor, "block_ip", calls["blocked"].append)
    monkeypatch.setattr(monitor, "push_alert", calls["alerts"].append)
    monkeypatch.setattr(monitor, "save_log", lambda msg: None)
    monkeypatch.setattr(monitor, "send_email", lambda *a: None)
    monkeypatch.setattr(monitor, "register_incident", lambda ip, t: (True, 0))
    monkeypatch.setattr(monitor, "get_geo", lambda ip: {
        "location": "Teste", "lat": None, "lon": None, "country": None,
        "region": None, "city": None, "countryCode": None, "isp": None, "org": None,
    })
    return calls


def _stub_detector(monkeypatch, conn_count, suspicious, ai):
    monkeypatch.setattr(monitor, "record_connection", lambda ip, port: (conn_count, 1))
    monkeypatch.setattr(monitor, "detect_suspicious", lambda ip: suspicious)
    monkeypatch.setattr(monitor, "ai_detect", lambda features: ai)


def test_ai_alone_ignored_below_min_connections(monkeypatch, handled):
    _stub_detector(monkeypatch, monitor.AI_MIN_CONNECTIONS - 1, suspicious=False, ai=True)

    monitor.handle_connection("203.0.113.5", 22)

    assert handled["blocked"] == []
    assert handled["alerts"] == []


def test_ai_alerts_at_min_connections(monkeypatch, handled):
    _stub_detector(monkeypatch, monitor.AI_MIN_CONNECTIONS, suspicious=False, ai=True)

    monitor.handle_connection("203.0.113.5", 22)

    assert handled["blocked"] == ["203.0.113.5"]
    assert handled["alerts"][0]["reason"] == "ai_anomaly"


def test_threshold_alerts_as_brute_force(monkeypatch, handled):
    _stub_detector(monkeypatch, 25, suspicious=True, ai=False)

    monitor.handle_connection("203.0.113.5", 22)

    alert = handled["alerts"][0]
    assert alert["type"] == "brute_force"
    assert alert["reason"] == "threshold"
    assert "Forca Bruta" in alert["message"]
