import json
import os
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler

SHOPIFY_API_VERSION = "2024-01"


def _shopify_request(store, token, method, endpoint, data=None):
    url = f"https://{store}/admin/api/{SHOPIFY_API_VERSION}/{endpoint}"
    headers = {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    body = json.dumps(data, ensure_ascii=False).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            resp_body = resp.read().decode()
            return resp.status, json.loads(resp_body) if resp_body else {}
    except urllib.error.HTTPError as e:
        error_body = e.read().decode() if e.fp else "{}"
        try:
            error_json = json.loads(error_body)
        except json.JSONDecodeError:
            error_json = {"error": error_body}
        return e.code, error_json
    except urllib.error.URLError as e:
        return 0, {"error": f"No se pudo conectar a Shopify: {str(e.reason)}"}


class handler(BaseHTTPRequestHandler):

    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = json.loads(self.rfile.read(length)) if length else {}

        store = body.get('store', '').strip().replace('https://', '').replace('http://', '').rstrip('/')
        if not store.endswith('.myshopify.com'):
            store += '.myshopify.com'
        token = body.get('token', '').strip()
        product = body.get('product')

        if not store or not token or not product:
            self._respond(400, {'error': 'Faltan campos: store, token, product'})
            return

        status, data = _shopify_request(store, token, 'POST', 'products.json', {'product': product})

        if status == 201:
            created = data.get('product', {})
            self._respond(201, {
                'success': True,
                'product': {
                    'id': created.get('id'),
                    'title': created.get('title'),
                    'variants_count': len(created.get('variants', [])),
                },
            })
        else:
            error_msg = data.get('errors', data.get('error', 'Error al crear producto'))
            self._respond(status or 500, {'success': False, 'error': error_msg})

    def _respond(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', len(body))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass
