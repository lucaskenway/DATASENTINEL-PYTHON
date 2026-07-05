import re
from datetime import datetime

LOG_FILE = "ataques.log"

_CONTROL_CHARS = re.compile(r"[\r\n\x00-\x1f]")

def save_log(message):
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    safe_message = _CONTROL_CHARS.sub(" ", str(message))
    log_message = f"[{now}] {safe_message}"

    print(log_message)

    with open(LOG_FILE, "a", encoding="utf-8") as file:
        file.write(log_message + "\n")
