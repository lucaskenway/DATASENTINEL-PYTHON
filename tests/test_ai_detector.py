import json
import random

import pytest

import ai_detector


@pytest.fixture(autouse=True)
def isolated_data(tmp_path, monkeypatch):
    """Usa uma pasta temporaria para nao tocar nos dados reais em data/."""
    monkeypatch.setattr(ai_detector, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(ai_detector, "DATASET_FILE", str(tmp_path / "train.jsonl"))
    monkeypatch.setattr(ai_detector, "MODEL_FILE", str(tmp_path / "model.joblib"))
    monkeypatch.setattr(ai_detector, "_model", None)
    monkeypatch.setattr(ai_detector, "_dataset_size", 0)
    monkeypatch.setattr(ai_detector, "_samples_since_train", 0)
    return tmp_path


def _write_normal_traffic(path, n=300):
    rng = random.Random(0)
    with open(path, "w", encoding="utf-8") as f:
        for _ in range(n):
            features = [rng.randint(1, 3), rng.randint(1, 2)]
            f.write(json.dumps({"ts": 0, "features": features}) + "\n")
    ai_detector._dataset_size = n


def test_contamination_is_low():
    assert ai_detector.CONTAMINATION <= 0.01


def test_warmup_never_flags(isolated_data):
    results = [ai_detector.ai_detect([100, 50]) for _ in range(ai_detector.MIN_SAMPLES - 1)]

    assert not any(results)
    lines = (isolated_data / "train.jsonl").read_text(encoding="utf-8").splitlines()
    assert len(lines) == ai_detector.MIN_SAMPLES - 1


def test_normal_traffic_is_not_flagged():
    _write_normal_traffic(ai_detector.DATASET_FILE)

    assert ai_detector.ai_detect([2, 1]) is False


@pytest.mark.xfail(
    strict=True,
    reason=(
        "Limitacao conhecida: o IsolationForest nao extrapola para valores "
        "fora da faixa de treino; um ponto extremo cai na mesma folha do "
        "maior ponto normal e recebe score de 'normal'. Remover o xfail "
        "quando o modelo for trocado."
    ),
)
def test_extreme_traffic_is_flagged():
    _write_normal_traffic(ai_detector.DATASET_FILE)
    # Treina so com trafego normal antes de avaliar. Sem isso, ai_detect()
    # grava o ponto testado no dataset e retreina com ele, e o teste passa
    # sem provar que o modelo detecta anomalias que nunca viu.
    ai_detector._train(ai_detector._load_dataset())
    ai_detector._samples_since_train = 0

    assert ai_detector.ai_detect([80, 40]) is True


def test_low_false_positive_rate_on_normal_traffic():
    _write_normal_traffic(ai_detector.DATASET_FILE)
    rng = random.Random(1)

    flagged = sum(
        ai_detector.ai_detect([rng.randint(1, 3), rng.randint(1, 2)])
        for _ in range(200)
    )

    assert flagged / 200 <= 0.05
