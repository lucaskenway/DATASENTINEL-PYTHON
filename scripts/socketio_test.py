"""Manual Socket.IO test: logs in and connects using session cookie.
Run: python scripts/socketio_test.py
"""
import os
import re
import requests
import socketio
import time

BASE = os.environ.get('DATASENTINEL_URL', 'http://127.0.0.1:5000')

def main():
    s = requests.Session()
    r = s.get(f"{BASE}/login")
    print('GET /login', r.status_code)
    m = re.search(r'name="csrf_token" value="([^"]+)"', r.text)
    if not m:
        print('no csrf on login')
        return
    token = m.group(1)
    r2 = s.post(f"{BASE}/login", data={'username': os.environ.get('DATASENTINEL_ADMIN_USER','admin'), 'password': os.environ.get('DATASENTINEL_ADMIN_PASSWORD','admin1234'), 'csrf_token': token}, allow_redirects=False)
    print('POST /login', r2.status_code)
    cookie = s.cookies.get('session')
    print('session cookie present?', bool(cookie))

    sio = socketio.Client()

    @sio.on('session_init')
    def on_session_init(data):
        print('received session_init', data)

    headers = {'Cookie': f'session={cookie}'}
    sio.connect(BASE, headers=headers, transports=['websocket'])
    time.sleep(1)
    sio.disconnect()

if __name__ == '__main__':
    main()
