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
