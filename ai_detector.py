import json
import os
import time

import numpy as np
from sklearn.ensemble import IsolationForest

try:
    import joblib
except ImportError:
    joblib = None

DATA_DIR = os.environ.get("DATASENTINEL_DATA_DIR", "data")
DATASET_FILE = os.path.join(DATA_DIR, "ai_training_data.jsonl")
MODEL_FILE = os.path.join(DATA_DIR, "ai_model.joblib")

MIN_SAMPLES = 30        # amostras reais minimas antes de confiar no modelo
RETRAIN_EVERY = 50      # retreina a cada N amostras novas
MAX_DATASET_ROWS = 5000  # janela de treino (linhas mais recentes)
CONTAMINATION = 0.01

_model = None
_samples_since_train = 0


def _ensure_data_dir():
    os.makedirs(DATA_DIR, exist_ok=True)


def _count_existing_samples():
    if not os.path.isfile(DATASET_FILE):
        return 0
    with open(DATASET_FILE, "r", encoding="utf-8") as f:
        return sum(1 for _ in f)


_dataset_size = _count_existing_samples()


def _load_dataset(limit=MAX_DATASET_ROWS):
    if not os.path.isfile(DATASET_FILE):
        return []
    with open(DATASET_FILE, "r", encoding="utf-8") as f:
        lines = f.readlines()[-limit:]
    rows = []
    for line in lines:
        try:
            rows.append(json.loads(line)["features"])
        except (ValueError, KeyError):
            continue
    return rows


def _append_sample(features):
    _ensure_data_dir()
    with open(DATASET_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps({"ts": time.time(), "features": features}) + "\n")


def _load_model():
    global _model
    if joblib and os.path.isfile(MODEL_FILE):
        try:
            _model = joblib.load(MODEL_FILE)
        except Exception:
            _model = None
    return _model


def _train(rows):
    global _model
    model = IsolationForest(contamination=CONTAMINATION, random_state=42)
    model.fit(np.array(rows))
    _model = model
    if joblib:
        _ensure_data_dir()
        try:
            joblib.dump(model, MODEL_FILE)
        except Exception:
            pass
    print(f"[AI] Modelo (re)treinado com {len(rows)} amostras reais.")
    return model


def ai_detect(features):
    """Recebe um vetor de features reais observado agora (ex.: [conexoes nos
    ultimos 10s, portas distintas nos ultimos 60s] vindo de detector.py) e
    retorna True se o padrao for uma anomalia frente ao trafego historico real
    desta maquina. As amostras sao acumuladas em disco e o modelo e
    (re)treinado periodicamente com dados reais, nao mais fixos."""
    global _model, _samples_since_train, _dataset_size

    features = list(features)
    _append_sample(features)
    _dataset_size += 1
    _samples_since_train += 1

    if _model is None:
        _load_model()

    if _dataset_size < MIN_SAMPLES:
        return False  # ainda "aquecendo": poucos dados reais para confiar

    if _model is None or _samples_since_train >= RETRAIN_EVERY:
        rows = _load_dataset()
        if len(rows) >= MIN_SAMPLES:
            _train(rows)
            _samples_since_train = 0

    if _model is None:
        return False

    prediction = _model.predict([features])
    return prediction[0] == -1
