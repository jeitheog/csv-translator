#!/usr/bin/env python3
"""
CSV Traductor al Español — Servidor local con proxy a Shopify Admin API.
No requiere dependencias externas (solo librería estándar de Python 3).

Uso: python3 server.py
"""

import http.server
import json
import os
import ssl
import sys
import urllib.parse
import urllib.request
import urllib.error

PORT = 8080
SHOPIFY_API_VERSION = "2024-01"

# Directorio de archivos estáticos (donde está este script)
STATIC_DIR = os.path.dirname(os.path.abspath(__file__))


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
        if self.path == "/api/shopify/test":
            self._handle_shopify_test()
        elif self.path == "/api/shopify/products":
            self._handle_shopify_create_product()
        else:
            self.send_error(404, "Endpoint no encontrado")

    def do_GET(self):
        # No-cache headers for static files to avoid stale JS/CSS
        if self.path.endswith(('.js', '.css', '.html')) or self.path == '/':
            # Let SimpleHTTPRequestHandler serve the file, but override end_headers
            pass
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
        # Only log API calls, not every static file request
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
    print("    POST /api/shopify/test      → Verificar conexión")
    print("    POST /api/shopify/products  → Crear producto")
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
