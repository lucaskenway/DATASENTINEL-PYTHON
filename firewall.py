import ipaddress
import os
import shutil
import subprocess

blocked_ips = set()


def _run_firewall_command(command):
    completed = subprocess.run(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        check=False,
        timeout=10,
    )
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or completed.stdout.strip() or "firewall command failed")


def block_ip(ip):
    if ip in blocked_ips:
        return True

    try:
        ipaddress.ip_address(ip)
    except ValueError:
        print(f"[FIREWALL] IP invalido, ignorado: {ip}")
        return False

    try:
        if os.name == "nt":
            command = [
                "netsh",
                "advfirewall",
                "firewall",
                "add",
                "rule",
                f"name=Block {ip}",
                "dir=in",
                "action=block",
                f"remoteip={ip}",
            ]
        elif shutil.which("iptables"):
            command = ["iptables", "-I", "INPUT", "-s", ip, "-j", "DROP"]
        elif shutil.which("ufw"):
            command = ["ufw", "insert", "1", "deny", "from", ip]
        else:
            print(f"[FIREWALL] Backend indisponivel para bloquear {ip}")
            return False

        _run_firewall_command(command)
        blocked_ips.add(ip)
        print(f"[FIREWALL] IP bloqueado: {ip}")
        return True

    except Exception as e:
        print(f"Erro ao bloquear IP: {e}")
        return False
