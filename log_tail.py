import os
import time


def follow(path, poll_interval=2.0):
    """Gera continuamente novas linhas de um arquivo de log (tail -f),
    tratando rotacao via logrotate (arquivo truncado/recriado)."""
    f = open(path, "r", encoding="utf-8", errors="ignore")
    f.seek(0, os.SEEK_END)

    while True:
        line = f.readline()
        if not line:
            time.sleep(poll_interval)
            try:
                if os.path.getsize(path) < f.tell():
                    f.close()
                    f = open(path, "r", encoding="utf-8", errors="ignore")
                    f.seek(0, os.SEEK_END)
            except OSError:
                pass
            continue
        yield line
