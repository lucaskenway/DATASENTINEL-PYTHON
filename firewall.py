import ipaddress
import os
import shutil
import subprocess

blocked_ips = set()
_failed_ips = set()  # falhas ja reportadas, para nao repetir o erro a cada conexao


def _decode_output(raw):
    # O netsh pode responder em UTF-8 ou na code page do console (OEM),
    # dependendo da configuracao do Windows; text=True usaria cp1252 e
    # quebraria os acentos ("operaÃ§Ã£o").
    for encoding in ("utf-8", "oem" if os.name == "nt" else "latin-1"):
        try:
            return raw.decode(encoding).strip()
        except (UnicodeDecodeError, LookupError):
            continue
    return raw.decode("utf-8", errors="replace").strip()


def _run_firewall_command(command):
    completed = subprocess.run(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
        timeout=10,
    )
    if completed.returncode != 0:
        raise RuntimeError(
            _decode_output(completed.stderr)
            or _decode_output(completed.stdout)
            or "firewall command failed"
        )


def block_ip(ip):
    if ip in blocked_ips:
        return True
    if ip in _failed_ips:
        return False

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
        _failed_ips.add(ip)
        print(f"Erro ao bloquear IP {ip}: {e}")
        return False
