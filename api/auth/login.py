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


def _verify_password(password, stored_hash, salt):
    computed = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 100000).hex()
    return hmac_mod.compare_digest(computed, stored_hash)


def _create_token(email, role, ttl=86400):
    payload = json.dumps({'email': email, 'role': role, 'exp': int(time.time()) + ttl})
    payload_b64 = base64.urlsafe_b64encode(payload.encode()).rstrip(b'=').decode()
    secret = os.environ.get('SECRET_KEY', '')
    sig = hmac_mod.new(secret.encode(), payload_b64.encode(), hashlib.sha256).hexdigest()
    return f"{payload_b64}.{sig}"


class handler(BaseHTTPRequestHandler):

    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = json.loads(self.rfile.read(length)) if length else {}

        email = body.get('email', '').strip().lower()
        password = body.get('password', '')

        admin_email = os.environ.get('ADMIN_EMAIL', '').strip().lower()
        admin_hash = os.environ.get('ADMIN_PASSWORD_HASH', '')
        admin_salt = os.environ.get('ADMIN_SALT', '')

        if not admin_email or not admin_hash or not admin_salt:
            self._respond(500, {'success': False, 'error': 'Servidor no configurado'})
            return

        if email == admin_email and _verify_password(password, admin_hash, admin_salt):
            token = _create_token(email, 'admin')
            self._respond(200, {
                'success': True,
                'token': token,
                'user': {
                    'email': email,
                    'name': 'Super Admin',
                    'plan': 'unlimited',
                    'role': 'admin',
                    'usage': 0,
                    'filesProcessed': 0,
                    'billingHistory': [],
                    'status': 'active',
                },
            })
        else:
            self._respond(401, {'success': False, 'error': 'Credenciales incorrectas'})

    def _respond(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', len(body))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass
