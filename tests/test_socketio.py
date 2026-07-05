import os
import re
import requests
import socketio
import time


BASE = os.environ.get("DATASENTINEL_URL", "http://127.0.0.1:5000")


def test_socketio_session_init():
    s = requests.Session()
    r = s.get(f"{BASE}/login")
    assert r.status_code == 200
    m = re.search(r'name="csrf_token" value="([^"]+)"', r.text)
    assert m
    token = m.group(1)
    r2 = s.post(f"{BASE}/login", data={"username": os.environ.get("DATASENTINEL_ADMIN_USER", "admin"),
                   "password": os.environ.get("DATASENTINEL_ADMIN_PASSWORD", "admin1234"),
                   "csrf_token": token}, allow_redirects=False)
    assert r2.status_code in (302, 303)

    # get session cookie
    cookie_val = s.cookies.get('session')
    assert cookie_val

    received = {}

    sio = socketio.Client()

    @sio.on('session_init')
    def on_session_init(data):
        received['session_init'] = data

    # pass cookie header and connect (allow polling transport)
    headers = {'Cookie': f'session={cookie_val}'}
    sio.connect(BASE, headers=headers, wait=True, wait_timeout=3)
    time.sleep(0.5)
    sio.disconnect()

    assert 'session_init' in received
