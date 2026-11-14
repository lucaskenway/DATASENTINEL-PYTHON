import os

from pymongo import DESCENDING, MongoClient

MONGODB_URI = os.environ.get("DATASENTINEL_MONGODB_URI", "").strip()
MONGODB_DB_NAME = os.environ.get("DATASENTINEL_MONGODB_DB", "datasentinel").strip()

_client = None


def _get_collection():
    global _client
    if not MONGODB_URI:
        return None
    if _client is None:
        _client = MongoClient(MONGODB_URI)
    return _client[MONGODB_DB_NAME]["alerts"]


def init_db():
    collection = _get_collection()
    if collection is None:
        return

    collection.create_index("timestamp")


def save_alert(payload):
    collection = _get_collection()
    if collection is None:
        return

    collection.insert_one(dict(payload))


def count_alerts():
    collection = _get_collection()
    if collection is None:
        return 0

    return collection.count_documents({})


def get_alerts(limit=100):
    collection = _get_collection()
    if collection is None:
        return []

    cursor = collection.find({}, {"_id": 0}).sort("_id", DESCENDING).limit(limit)
    return list(cursor)


init_db()


def status():
    """Estado do MongoDB para o painel: configurado, online e total de
    documentos. Usa um cliente proprio com timeout curto para a tela nunca
    travar esperando o banco (o cliente principal usa o timeout padrao)."""
    if not MONGODB_URI:
        return {"configured": False, "online": False, "docs": None, "host": None}
    # So o host aparece no painel: usuario e senha da URI nunca saem daqui
    host = MONGODB_URI.split("://", 1)[-1].split("@")[-1].split("/")[0].split("?")[0]
    try:
        client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=1500)
        try:
            client.admin.command("ping")
            docs = client[MONGODB_DB_NAME]["alerts"].estimated_document_count()
        finally:
            client.close()
        return {"configured": True, "online": True, "docs": docs, "host": host}
    except Exception:
        return {"configured": True, "online": False, "docs": None, "host": host}
