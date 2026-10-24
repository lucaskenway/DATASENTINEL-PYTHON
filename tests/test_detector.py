import pytest

import detector


@pytest.fixture(autouse=True)
def clean_state(monkeypatch):
    detector._connections.clear()
    detector._ports.clear()
    clock = {"now": 1000.0}
    monkeypatch.setattr(detector.time, "time", lambda: clock["now"])
    yield clock
    detector._connections.clear()
    detector._ports.clear()


def test_record_connection_counts_connections_and_ports():
    detector.record_connection("203.0.113.5", 22)
    detector.record_connection("203.0.113.5", 22)
    conn_count, distinct_ports = detector.record_connection("203.0.113.5", 80)

    assert conn_count == 3
    assert distinct_ports == 2


def test_record_connection_keeps_ips_separate():
    detector.record_connection("203.0.113.5", 22)
    conn_count, distinct_ports = detector.record_connection("198.51.100.7", 22)

    assert (conn_count, distinct_ports) == (1, 1)


def test_connections_expire_after_window(clean_state):
    detector.record_connection("203.0.113.5", 22)
    clean_state["now"] += detector.WINDOW_SECONDS + 1
    conn_count, _ = detector.record_connection("203.0.113.5", 22)

    assert conn_count == 1


def test_ports_expire_after_port_window(clean_state):
    detector.record_connection("203.0.113.5", 22)
    clean_state["now"] += detector.PORT_WINDOW_SECONDS + 1
    _, distinct_ports = detector.record_connection("203.0.113.5", 80)

    assert distinct_ports == 1


def test_detect_suspicious_only_at_threshold():
    ip = "203.0.113.5"
    for _ in range(detector.THRESHOLD - 1):
        detector.record_connection(ip, 22)
    assert not detector.detect_suspicious(ip)

    detector.record_connection(ip, 22)
    assert detector.detect_suspicious(ip)


def test_detect_suspicious_unknown_ip():
    assert not detector.detect_suspicious("203.0.113.99")


@pytest.mark.parametrize(
    "conn_count, distinct_ports, expected",
    [
        (1, detector.PORT_SCAN_THRESHOLD, "port_scan"),
        (detector.THRESHOLD, detector.PORT_SCAN_THRESHOLD, "port_scan"),
        (detector.THRESHOLD, 1, "brute_force"),
        (3, 2, "anomalia"),
    ],
)
def test_classify_attack(conn_count, distinct_ports, expected):
    assert detector.classify_attack(conn_count, distinct_ports) == expected
