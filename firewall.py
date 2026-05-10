import subprocess

blocked_ips = set()

def block_ip(ip):

    if ip in blocked_ips:
        return

    try:
        command = f'netsh advfirewall firewall add rule name="Block {ip}" dir=in action=block remoteip={ip}'

        subprocess.run(command, shell=True)

        blocked_ips.add(ip)

        print(f"[FIREWALL] IP bloqueado: {ip}")

    except Exception as e:
        print(f"Erro ao bloquear IP: {e}")
