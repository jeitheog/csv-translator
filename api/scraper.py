import json
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json",
}


def _clean_url(raw):
    url = raw.strip().rstrip("/")
    if not url.startswith("http"):
        url = "https://" + url
    return url


def _fetch_page(store_url, page, limit=250):
    url = f"{store_url}/products.json?limit={limit}&page={page}"
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=12) as resp:
        data = json.loads(resp.read().decode())
    return data.get("products", [])


class handler(BaseHTTPRequestHandler):

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length)) if length else {}

        raw_url = body.get("url", "").strip()
        if not raw_url:
            self._respond(400, {"error": "Falta la URL de la tienda"})
            return

        store_url = _clean_url(raw_url)
        parsed = urllib.parse.urlparse(store_url)
        path = parsed.path.lower()
        store_base = f"{parsed.scheme}://{parsed.netloc}"

        all_products = []
        try:
            target_handle = None
            if "/products/" in path:
                # ── Single Product Mode ──────────────────────
                parts = path.split("/")
                try:
                    p_idx = next(i for i, part in enumerate(parts) if part == "products")
                    target_handle = parts[p_idx + 1]
                    
                    # A. Direct fetch attempt
                    url = f"{store_base}/products/{target_handle}.json"
                    try:
                        req = urllib.request.Request(url, headers=HEADERS)
                        with urllib.request.urlopen(req, timeout=10) as resp:
                            data = json.loads(resp.read().decode())
                        p = data.get("product")
                        if p:
                            all_products = [p]
                    except Exception:
                        pass # Fallback to full store fetch below
                except (ValueError, IndexError, StopIteration):
                    pass

            # ── Full Store Mode (Default or Fallback) ────────
            if not all_products:
                page = 1
                while True:
                    url = f"{store_base}/products.json?limit=250&page={page}"
                    req = urllib.request.Request(url, headers=HEADERS)
                    with urllib.request.urlopen(req, timeout=12) as resp:
                        data = json.loads(resp.read().decode())
                    products = data.get("products", [])
                    if not products:
                        break
                    
                    if target_handle:
                        # Looking for specific product in the list
                        p = next((x for x in products if x.get('handle') == target_handle), None)
                        if p:
                            all_products = [p]
                            break
                    else:
                        all_products.extend(products)

                    if len(products) < 250 or page >= 20: 
                        break
                    page += 1

        except urllib.error.HTTPError as e:
            self._respond(e.code, {"error": f"La tienda devolvió error {e.code}. Asegúrate de que sea pública."})
            return
        except Exception as e:
            self._respond(502, {"error": f"Error de conexión: {str(e)}"})
            return

        self._respond(200, {"products": all_products, "total": len(all_products)})

    def _respond(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass
