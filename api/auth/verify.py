import base64
import hashlib
import hmac as hmac_mod
import json
import os
import time
from http.server import BaseHTTPRequestHandler


def _load_env():
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '.env')
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, _, v = line.partition('=')
                    os.environ.setdefault(k.strip(), v.strip())


_load_env()


def _verify_token(token):
    try:
        payload_b64, sig = token.rsplit('.', 1)
        secret = os.environ.get('SECRET_KEY', '')
        if not secret:
            return None
        expected = hmac_mod.new(secret.encode(), payload_b64.encode(), hashlib.sha256).hexdigest()
        if not hmac_mod.compare_digest(sig, expected):
            return None
        padding = 4 - len(payload_b64) % 4
        if padding != 4:
            payload_b64 += '=' * padding
        payload = json.loads(base64.urlsafe_b64decode(payload_b64))
        if payload.get('exp', 0) < time.time():
            return None
        return payload
    except Exception:
        return None


class handler(BaseHTTPRequestHandler):

    def do_GET(self):
        token = self.headers.get('Authorization', '').replace('Bearer ', '').strip()
        payload = _verify_token(token) if token else None
        if payload:
            self._respond(200, {'success': True, 'role': payload['role'], 'email': payload['email']})
        else:
            self._respond(401, {'success': False, 'error': 'Sesión inválida o expirada'})

    def _respond(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', len(body))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass
