import time

connections_count = {}

THRESHOLD = 20

def detect_suspicious(ip):

    current_time = int(time.time())

    if ip not in connections_count:
        connections_count[ip] = []

    connections_count[ip].append(current_time)

    recent = [
        t for t in connections_count[ip]
        if current_time - t <= 10
    ]

    connections_count[ip] = recent

    if len(recent) >= THRESHOLD:
        return True

    return False
