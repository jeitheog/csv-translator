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

        all_products = []
        page = 1
        try:
            while True:
                products = _fetch_page(store_url, page)
                if not products:
                    break
                all_products.extend(products)
                if len(products) < 250:
                    break
                page += 1
                if page > 20:   # safety cap: 5000 products max
                    break
        except urllib.error.HTTPError as e:
            self._respond(e.code, {"error": f"La tienda devolvió error {e.code}. Asegúrate de que sea una tienda Shopify pública."})
            return
        except Exception as e:
            self._respond(502, {"error": f"No se pudo conectar a la tienda: {str(e)}"})
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
