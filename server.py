#!/usr/bin/env python3
"""
CSV Traductor al Español — Servidor local con proxy a Shopify Admin API.
No requiere dependencias externas (solo librería estándar de Python 3).

Uso: python3 server.py
"""

import base64
import hashlib
import hmac
import http.server
import json
import os
import ssl
import sys
import time
import urllib.parse
import urllib.request
import urllib.error

PORT = 8080
SHOPIFY_API_VERSION = "2024-01"

# Directorio de archivos estáticos (donde está este script)
STATIC_DIR = os.path.dirname(os.path.abspath(__file__))


# ── Carga .env ──────────────────────────────────────────────
def _load_env():
    env_path = os.path.join(STATIC_DIR, '.env')
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, _, v = line.partition('=')
                    os.environ.setdefault(k.strip(), v.strip())

_load_env()


# ── JWT stateless (HMAC-SHA256, sin dependencias externas) ───
# Funciona igual en local y en Vercel serverless.

def _verify_password(password: str, stored_hash: str, salt: str) -> bool:
    computed = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 100000).hex()
    return hmac.compare_digest(computed, stored_hash)


def _create_token(email: str, role: str, ttl: int = 86400) -> str:
    payload = json.dumps({'email': email, 'role': role, 'exp': int(time.time()) + ttl})
    payload_b64 = base64.urlsafe_b64encode(payload.encode()).rstrip(b'=').decode()
    secret = os.environ.get('SECRET_KEY', '')
    sig = hmac.new(secret.encode(), payload_b64.encode(), hashlib.sha256).hexdigest()
    return f"{payload_b64}.{sig}"


def _verify_token(token: str):
    try:
        payload_b64, sig = token.rsplit('.', 1)
        secret = os.environ.get('SECRET_KEY', '')
        expected = hmac.new(secret.encode(), payload_b64.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
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


class CSVTraductorHandler(http.server.SimpleHTTPRequestHandler):
    """Custom handler: sirve archivos estáticos + proxy API para Shopify."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    # ─── CORS Headers ───────────────────────────────────────
    def _send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        """Handle CORS preflight requests."""
        self.send_response(200)
        self._send_cors_headers()
        self.end_headers()

    # ─── API Routing ────────────────────────────────────────
    def do_POST(self):
        if self.path == "/api/auth/login":
            self._handle_login()
        elif self.path == "/api/auth/logout":
            self._handle_logout()
        elif self.path == "/api/shopify/test":
            self._handle_shopify_test()
        elif self.path == "/api/shopify/products":
            self._handle_shopify_create_product()
        else:
            self.send_error(404, "Endpoint no encontrado")

    def do_GET(self):
        if self.path == "/api/auth/verify":
            self._handle_verify()
        else:
            super().do_GET()

    def end_headers(self):
        # Add cache control for dev
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    # ─── Read JSON Body ─────────────────────────────────────
    def _read_json_body(self):
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length == 0:
            return None
        body = self.rfile.read(content_length)
        return json.loads(body.decode("utf-8"))

    def _send_json_response(self, status, data):
        response = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self._send_cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)

    # ─── Auth Handlers ──────────────────────────────────────
    def _handle_login(self):
        body = self._read_json_body()
        if not body or 'email' not in body or 'password' not in body:
            self._send_json_response(400, {'success': False, 'error': 'Faltan email y contraseña'})
            return

        email = body['email'].strip().lower()
        password = body['password']

        admin_email = os.environ.get('ADMIN_EMAIL', '').strip().lower()
        admin_hash  = os.environ.get('ADMIN_PASSWORD_HASH', '')
        admin_salt  = os.environ.get('ADMIN_SALT', '')

        if not admin_email or not admin_hash or not admin_salt:
            self._send_json_response(500, {
                'success': False,
                'error': 'Servidor no configurado. Ejecuta: python3 setup_admin.py'
            })
            return

        if email == admin_email and _verify_password(password, admin_hash, admin_salt):
            token = _create_token(email, 'admin')
            self._send_json_response(200, {
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
                }
            })
        else:
            self._send_json_response(401, {'success': False, 'error': 'Credenciales incorrectas'})

    def _handle_logout(self):
        # JWT es stateless: el cliente descarta el token. El servidor confirma.
        self._send_json_response(200, {'success': True})

    def _handle_verify(self):
        token = self.headers.get('Authorization', '').replace('Bearer ', '').strip()
        payload = _verify_token(token) if token else None
        if payload:
            self._send_json_response(200, {
                'success': True,
                'role': payload['role'],
                'email': payload['email'],
            })
        else:
            self._send_json_response(401, {'success': False, 'error': 'Sesión inválida o expirada'})

    # ─── Shopify API Proxy ──────────────────────────────────
    def _shopify_request(self, store, token, method, endpoint, data=None):
        """
        Make a request to Shopify Admin API.
        Returns (status_code, response_dict).
        """
        url = f"https://{store}/admin/api/{SHOPIFY_API_VERSION}/{endpoint}"
        headers = {
            "X-Shopify-Access-Token": token,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

        body = None
        if data is not None:
            body = json.dumps(data, ensure_ascii=False).encode("utf-8")

        req = urllib.request.Request(url, data=body, headers=headers, method=method)

        try:
            with urllib.request.urlopen(req) as resp:
                resp_body = resp.read().decode("utf-8")
                return resp.status, json.loads(resp_body) if resp_body else {}
        except urllib.error.HTTPError as e:
            error_body = e.read().decode("utf-8") if e.fp else "{}"
            try:
                error_json = json.loads(error_body)
            except json.JSONDecodeError:
                error_json = {"error": error_body}
            return e.code, error_json
        except urllib.error.URLError as e:
            return 0, {"error": f"No se pudo conectar a Shopify: {str(e.reason)}"}

    # ─── Test Connection ────────────────────────────────────
    def _handle_shopify_test(self):
        """Test Shopify credentials by fetching shop info."""
        body = self._read_json_body()
        if not body or "store" not in body or "token" not in body:
            self._send_json_response(400, {"error": "Faltan campos: store, token"})
            return

        store = body["store"].strip()
        token = body["token"].strip()

        # Normalize store URL
        store = store.replace("https://", "").replace("http://", "").rstrip("/")
        if not store.endswith(".myshopify.com"):
            store = store + ".myshopify.com"

        status, data = self._shopify_request(store, token, "GET", "shop.json")

        if status == 200:
            shop = data.get("shop", {})
            self._send_json_response(200, {
                "success": True,
                "shop": {
                    "name": shop.get("name", ""),
                    "domain": shop.get("domain", ""),
                    "email": shop.get("email", ""),
                    "plan": shop.get("plan_display_name", ""),
                }
            })
        else:
            error_msg = data.get("errors", data.get("error", "Error desconocido"))
            self._send_json_response(status or 500, {
                "success": False,
                "error": f"Error de conexión ({status}): {error_msg}"
            })

    # ─── Create Product ─────────────────────────────────────
    def _handle_shopify_create_product(self):
        """Create a product in Shopify."""
        body = self._read_json_body()
        if not body:
            self._send_json_response(400, {"error": "Body vacío"})
            return

        store = body.get("store", "").strip()
        token = body.get("token", "").strip()
        product = body.get("product")

        if not store or not token or not product:
            self._send_json_response(400, {"error": "Faltan campos: store, token, product"})
            return

        # Normalize store URL
        store = store.replace("https://", "").replace("http://", "").rstrip("/")
        if not store.endswith(".myshopify.com"):
            store = store + ".myshopify.com"

        status, data = self._shopify_request(
            store, token, "POST", "products.json", {"product": product}
        )

        if status == 201:
            created = data.get("product", {})
            self._send_json_response(201, {
                "success": True,
                "product": {
                    "id": created.get("id"),
                    "title": created.get("title"),
                    "variants_count": len(created.get("variants", [])),
                }
            })
        else:
            error_msg = data.get("errors", data.get("error", "Error al crear producto"))
            self._send_json_response(status or 500, {
                "success": False,
                "error": error_msg
            })

    # ─── Suppress default logging clutter ───────────────────
    def log_message(self, format, *args):
        if "/api/" in (args[0] if args else ""):
            super().log_message(format, *args)


def main():
    print()
    print("  🌐 CSV Traductor al Español + Shopify")
    print("  ─────────────────────────────────────────")
    print(f"  Servidor:    http://localhost:{PORT}")
    print(f"  Carpeta:     {STATIC_DIR}")
    print()
    print("  Endpoints API:")
    print("    POST /api/auth/login        → Login admin")
    print("    POST /api/auth/logout       → Logout")
    print("    GET  /api/auth/verify       → Verificar token")
    print("    POST /api/shopify/test      → Verificar conexión Shopify")
    print("    POST /api/shopify/products  → Crear producto Shopify")
    print()
    print("  Presiona Ctrl+C para detener.")
    print("  ─────────────────────────────────────────")
    print()

    server = http.server.HTTPServer(("", PORT), CSVTraductorHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  👋 Servidor detenido.")
        server.server_close()


if __name__ == "__main__":
    main()
