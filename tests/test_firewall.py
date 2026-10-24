import os

import pytest

import firewall


@pytest.fixture(autouse=True)
def clean_state():
    firewall.blocked_ips.clear()
    firewall._failed_ips.clear()
    yield
    firewall.blocked_ips.clear()
    firewall._failed_ips.clear()


@pytest.fixture
def commands(monkeypatch):
    """Substitui a execucao real do firewall e registra os comandos."""
    calls = []
    monkeypatch.setattr(firewall, "_run_firewall_command", calls.append)
    monkeypatch.setattr(firewall.shutil, "which", lambda name: name == "iptables")
    return calls


def test_invalid_ip_is_ignored(commands):
    assert firewall.block_ip("nao-e-ip") is False
    assert commands == []


def test_block_ip_runs_command_once(commands):
    assert firewall.block_ip("203.0.113.5") is True
    assert firewall.block_ip("203.0.113.5") is True

    assert len(commands) == 1
    assert "203.0.113.5" in " ".join(commands[0])
    assert "203.0.113.5" in firewall.blocked_ips


@pytest.mark.skipif(os.name != "nt", reason="regra netsh so existe no Windows")
def test_block_ip_uses_netsh_on_windows(commands):
    firewall.block_ip("203.0.113.5")

    assert commands[0][:5] == ["netsh", "advfirewall", "firewall", "add", "rule"]
    assert "remoteip=203.0.113.5" in commands[0]


def test_failure_is_reported_once_and_not_retried(monkeypatch, capsys):
    calls = []

    def failing(command):
        calls.append(command)
        raise RuntimeError("A operação solicitada exige elevação")

    monkeypatch.setattr(firewall, "_run_firewall_command", failing)

    for _ in range(5):
        assert firewall.block_ip("203.0.113.5") is False

    out = capsys.readouterr().out
    assert len(calls) == 1
    assert out.count("Erro ao bloquear IP 203.0.113.5") == 1
    assert "203.0.113.5" not in firewall.blocked_ips


def test_failure_of_one_ip_does_not_affect_others(monkeypatch):
    def fail_first(command):
        if "203.0.113.5" in " ".join(command):
            raise RuntimeError("falhou")

    monkeypatch.setattr(firewall, "_run_firewall_command", fail_first)

    assert firewall.block_ip("203.0.113.5") is False
    assert firewall.block_ip("198.51.100.7") is True


def test_decode_output_utf8():
    raw = "A operação solicitada exige elevação\r\n".encode("utf-8")
    assert firewall._decode_output(raw) == "A operação solicitada exige elevação"


@pytest.mark.skipif(os.name != "nt", reason="code page OEM so existe no Windows")
def test_decode_output_falls_back_to_oem():
    raw = b"opera\x87\xc6o"  # nao e UTF-8 valido
    assert firewall._decode_output(raw) == raw.decode("oem")


def test_run_firewall_command_error_keeps_accents(monkeypatch):
    class Completed:
        returncode = 1
        stdout = b""
        stderr = "A operação solicitada exige elevação".encode("utf-8")

    monkeypatch.setattr(firewall.subprocess, "run", lambda *a, **k: Completed())

    with pytest.raises(RuntimeError, match="operação solicitada exige elevação"):
        firewall._run_firewall_command(["netsh"])
