import smtplib
import ssl
from email.mime.text import MIMEText
from dotenv import load_dotenv
import os

load_dotenv()

EMAIL_HOST = os.getenv("EMAIL_HOST") or "localhost"
EMAIL_PORT = int(os.getenv("EMAIL_PORT", "587") or "587")
EMAIL_USER = os.getenv("EMAIL_USER") or ""
EMAIL_PASS = os.getenv("EMAIL_PASS") or ""
EMAIL_FROM = os.getenv("EMAIL_FROM") or EMAIL_USER or "datasentinel@example.com"
EMAIL_TO = os.getenv("EMAIL_TO") or EMAIL_FROM


def send_email(subject, message):
    if not EMAIL_USER or not EMAIL_PASS or not EMAIL_TO:
        print("[EMAIL] Configuracao de email incompleta; alerta nao enviado.")
        return

    try:
        msg = MIMEText(message)

        msg["Subject"] = subject
        msg["From"] = EMAIL_FROM
        msg["To"] = EMAIL_TO

        context = ssl.create_default_context()
        with smtplib.SMTP(EMAIL_HOST, EMAIL_PORT, timeout=5) as server:
            server.starttls(context=context)
            server.login(EMAIL_USER, EMAIL_PASS)
            server.sendmail(EMAIL_FROM, [EMAIL_TO], msg.as_string())

        print("[EMAIL] Alerta enviado!")

    except Exception as e:
        print(f"Erro ao enviar email: {e}")
