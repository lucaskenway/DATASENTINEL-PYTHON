from datetime import datetime

LOG_FILE = "ataques.log"

def save_log(message):
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    log_message = f"[{now}] {message}"

    print(log_message)

    with open(LOG_FILE, "a", encoding="utf-8") as file:
        file.write(log_message + "\n")
