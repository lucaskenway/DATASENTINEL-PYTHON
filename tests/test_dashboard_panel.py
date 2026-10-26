import os
import re

from server import _sanitize_alert


TEMPLATES = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "templates")


def _read(name):
    with open(os.path.join(TEMPLATES, name), encoding="utf-8") as f:
        return f.read()


def _attacker_card_html():
    html = _read("index.html")
    m = re.search(r'<aside class="attacker-card".*?</aside>', html, re.S)
    assert m, "cartao ORIGEM DO ATAQUE nao encontrado no index.html"
    return m.group(0)


def test_sanitize_alert_keeps_target_fields():
    clean = _sanitize_alert({
        "ip": "190.12.34.56",
        "lat": "-34.604", "lon": -58.382,
        "target_ip": "10.0.0.5", "target_city": "São\nPaulo", "target_location": "Brasil - São Paulo",
        "target_lat": -23.55, "target_lon": "-46.63",
        "campo_estranho": "descartado",
    })
    assert clean["lat"] == -34.604 and clean["lon"] == -58.382
    assert clean["target_ip"] == "10.0.0.5"
    assert clean["target_city"] == "São Paulo"  # quebra de linha removida
    assert clean["target_lat"] == -23.55 and clean["target_lon"] == -46.63
    assert "campo_estranho" not in clean


def test_sanitize_alert_invalid_coordinates_become_none():
    clean = _sanitize_alert({"ip": "1.2.3.4", "lat": "abc", "lon": None, "target_lat": {"x": 1}})
    assert clean["lat"] is None and clean["lon"] is None
    assert clean["target_lat"] is None and clean["target_lon"] is None


def test_attacker_card_has_all_fields_and_same_page_button():
    card = _attacker_card_html()
    for element_id in ("ac-kicker", "ac-city", "ac-rows", "ac-frame", "ac-map-empty", "ac-map"):
        assert f'id="{element_id}"' in card, element_id
    assert re.search(r'<button[^>]*id="ac-map"[^>]*type="button"[^>]*>VER REGIÃO NO MAPA</button>', card)
    assert "Localização aproximada pelo IP" in card
    # Nada no cartao pode abrir outra aba ou pagina
    assert "<a " not in card
    assert "_blank" not in card


def test_region_button_uses_globe_not_external_map():
    js = _read("script.js")
    assert "function focusGlobeOnEvent" in js
    assert "btn.onclick = () => focusGlobeOnEvent(p)" in js
    # O link antigo abria o OpenStreetMap em nova aba
    assert "openstreetmap.org/?mlat" not in js
    assert "window.open" not in js
