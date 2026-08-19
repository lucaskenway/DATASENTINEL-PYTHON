import json
import os

import psycopg


DATABASE_URL = os.environ.get("DATASENTINEL_DATABASE_URL", "").strip()


def _connect():
    if not DATABASE_URL:
        return None
    return psycopg.connect(DATABASE_URL)


def init_db():
    connection = _connect()
    if connection is None:
        return

    with connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS alerts (
                    id BIGSERIAL PRIMARY KEY,
                    timestamp DOUBLE PRECISION NOT NULL,
                    ip VARCHAR(200),
                    attack_type VARCHAR(200),
                    country VARCHAR(200),
                    city VARCHAR(200),
                    latitude DOUBLE PRECISION,
                    longitude DOUBLE PRECISION,
                    message VARCHAR(200),
                    payload JSONB NOT NULL
                )
                """
            )
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON alerts(timestamp)"
            )


def save_alert(payload):
    connection = _connect()
    if connection is None:
        return

    with connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO alerts (
                    timestamp, ip, attack_type, country, city,
                    latitude, longitude, message, payload
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                """,
                (
                    payload.get("timestamp"),
                    payload.get("ip"),
                    payload.get("type"),
                    payload.get("country"),
                    payload.get("city"),
                    payload.get("lat"),
                    payload.get("lon"),
                    payload.get("message"),
                    json.dumps(payload, ensure_ascii=False),
                ),
            )


def count_alerts():
    connection = _connect()
    if connection is None:
        return 0

    with connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT COUNT(*) FROM alerts")
            return int(cursor.fetchone()[0])


def get_alerts(limit=100):
    connection = _connect()
    if connection is None:
        return []

    with connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT payload FROM alerts ORDER BY id DESC LIMIT %s", (limit,)
            )
            return [row[0] for row in cursor.fetchall()]


init_db()