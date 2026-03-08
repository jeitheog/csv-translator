from http.server import BaseHTTPRequestHandler
import json
import os
import secrets
from urllib.parse import parse_qs, urlparse

SCOPES = "read_products,write_products"


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)

        shop = (params.get('shop', [''])[0]).strip()
        if not shop:
            self.send_json(400, {'error': 'Falta el parámetro shop'})
            return

        # Normalize shop domain
        shop = shop.replace('https://', '').replace('http://', '').rstrip('/')
        if not shop.endswith('.myshopify.com'):
            shop = f"{shop}.myshopify.com"

        # client_id: prefer env var, fall back to query param
        client_id = os.environ.get('SHOPIFY_CLIENT_ID', '') or (params.get('client_id', [''])[0]).strip()
        # app_url: browser always knows its own origin — use it; env var as fallback
        app_url   = (params.get('app_url', [''])[0]).strip() or os.environ.get('APP_URL', 'https://csv-translator-gray.vercel.app')

        if not client_id:
            self.send_json(500, {'error': 'Falta el Client ID. Introdúcelo en el panel de configuración OAuth.'})
            return

        # Generate a state nonce for CSRF protection
        state = secrets.token_urlsafe(16)

        redirect_uri = f"{app_url.rstrip('/')}/oauth_callback.html"

        auth_url = (
            f"https://{shop}/admin/oauth/authorize"
            f"?client_id={client_id}"
            f"&scope={SCOPES}"
            f"&redirect_uri={redirect_uri}"
            f"&state={state}"
        )

        self.send_json(200, {
            'auth_url': auth_url,
            'state': state,
            'shop': shop,
        })

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.end_headers()

    def send_json(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass
