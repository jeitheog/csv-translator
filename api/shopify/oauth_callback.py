from http.server import BaseHTTPRequestHandler
import json
import os
import hmac
import hashlib
import urllib.request
import urllib.parse
from urllib.parse import parse_qs, urlparse


class handler(BaseHTTPRequestHandler):

    def _exchange(self, code, shop, hmac_param, client_id, client_secret, shopify_params=None):
        """Exchange Shopify authorization code for permanent access token."""

        # Verify HMAC signature if provided
        # Shopify computes HMAC over ALL callback params except 'hmac' itself
        if hmac_param and client_secret:
            if shopify_params:
                params_for_hmac = {k: v for k, v in shopify_params.items() if k != 'hmac'}
            else:
                params_for_hmac = {'code': code, 'shop': shop}
            message = '&'.join(f"{k}={v}" for k, v in sorted(params_for_hmac.items()))
            expected = hmac.new(client_secret.encode(), message.encode(), hashlib.sha256).hexdigest()
            if not hmac.compare_digest(expected, hmac_param):
                return None, 'HMAC inválido — posible solicitud falsificada'

        # POST to Shopify to get access token
        try:
            token_url = f"https://{shop}/admin/oauth/access_token"
            post_data = urllib.parse.urlencode({
                'client_id': client_id,
                'client_secret': client_secret,
                'code': code,
            }).encode()

            req = urllib.request.Request(token_url, data=post_data, method='POST')
            req.add_header('Content-Type', 'application/x-www-form-urlencoded')

            with urllib.request.urlopen(req, timeout=15) as response:
                result = json.loads(response.read().decode())

            access_token = result.get('access_token', '')
            if not access_token:
                return None, 'Shopify no devolvió un access token'

            # Fetch shop display name
            shop_name = shop
            try:
                shop_req = urllib.request.Request(
                    f"https://{shop}/admin/api/2024-01/shop.json",
                    headers={
                        'X-Shopify-Access-Token': access_token,
                        'Content-Type': 'application/json',
                    }
                )
                with urllib.request.urlopen(shop_req, timeout=8) as sr:
                    shop_data = json.loads(sr.read().decode())
                    shop_name = shop_data.get('shop', {}).get('name', shop)
            except Exception:
                pass

            return {'success': True, 'token': access_token, 'store': shop, 'shop_name': shop_name}, None

        except Exception as e:
            return None, str(e)

    def do_POST(self):
        """Accept credentials from browser (oauth_callback.html) via POST body."""
        try:
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            payload = json.loads(body)
        except Exception:
            self.send_json(400, {'error': 'JSON inválido en el cuerpo de la solicitud'})
            return

        code       = payload.get('code', '')
        shop       = payload.get('shop', '')
        hmac_param = payload.get('hmac', '')

        # Prefer env vars, fall back to payload (browser-stored credentials)
        client_id     = os.environ.get('SHOPIFY_CLIENT_ID', '') or payload.get('client_id', '')
        client_secret = os.environ.get('SHOPIFY_CLIENT_SECRET', '') or payload.get('client_secret', '')

        if not code or not shop:
            self.send_json(400, {'error': 'Faltan code o shop'})
            return
        if not client_id or not client_secret:
            self.send_json(500, {'error': 'Faltan las credenciales OAuth (Client ID / Secret)'})
            return

        # All Shopify params (strip out our internal credentials before HMAC check)
        internal_keys = {'client_id', 'client_secret'}
        shopify_params = {k: v for k, v in payload.items() if k not in internal_keys}

        result, error = self._exchange(code, shop, hmac_param, client_id, client_secret, shopify_params)
        if error:
            self.send_json(500, {'error': error})
        else:
            self.send_json(200, result)

    def do_GET(self):
        """Fallback: accept credentials from query params (env-var only mode)."""
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)

        code       = params.get('code', [''])[0]
        shop       = params.get('shop', [''])[0]
        hmac_param = params.get('hmac', [''])[0]
        error      = params.get('error', [''])[0]

        if error:
            self.send_json(400, {'error': f'Shopify denegó el acceso: {error}'})
            return
        if not code or not shop:
            self.send_json(400, {'error': 'Parámetros incompletos (falta code o shop)'})
            return

        client_id     = os.environ.get('SHOPIFY_CLIENT_ID', '')
        client_secret = os.environ.get('SHOPIFY_CLIENT_SECRET', '')

        if not client_id or not client_secret:
            self.send_json(500, {'error': 'OAuth no configurado en el servidor y no se recibieron credenciales'})
            return

        result, error = self._exchange(code, shop, hmac_param, client_id, client_secret)
        if error:
            self.send_json(500, {'error': error})
        else:
            self.send_json(200, result)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
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
