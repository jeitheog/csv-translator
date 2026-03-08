import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

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
        return 0, {"error": str(e.reason)}


def _norm_store(store):
    store = store.strip().replace("https://", "").replace("http://", "").rstrip("/")
    if not store.endswith(".myshopify.com"):
        store += ".myshopify.com"
    return store


def _parse_link_header(link_header):
    """Extract next/prev page_info cursors from a Shopify Link header."""
    next_cursor = prev_cursor = None
    for part in link_header.split(","):
        url_m = re.search(r'<([^>]+)>', part)
        rel_m = re.search(r'rel="([^"]+)"', part)
        if not url_m or not rel_m:
            continue
        pi_m = re.search(r'page_info=([^&>]+)', url_m.group(1))
        if not pi_m:
            continue
        cursor = pi_m.group(1)
        if rel_m.group(1) == "next":
            next_cursor = cursor
        elif rel_m.group(1) == "previous":
            prev_cursor = cursor
    return next_cursor, prev_cursor


def _keywords_from_url(src):
    """Extract lowercase words from a CDN image filename."""
    filename = src.split("?")[0].rsplit("/", 1)[-1]
    filename = filename.rsplit(".", 1)[0].lower()
    return set(re.split(r"[-_\s\.]+", filename))


class handler(BaseHTTPRequestHandler):

    # ── GET /api/shopify/manage?store=…&token=…&page_info=…&limit=… ─────────
    def do_GET(self):
        params    = parse_qs(urlparse(self.path).query)
        store     = _norm_store(params.get("store", [""])[0])
        token     = params.get("token", [""])[0]
        page_info = params.get("page_info", [None])[0]
        limit     = min(int(params.get("limit", ["20"])[0]), 50)

        if not store or not token:
            self._respond(400, {"error": "Faltan store o token"})
            return

        # Cursor-based pagination (Shopify REST 2023-04+)
        # When page_info is present only limit is allowed alongside it.
        if page_info:
            qs = f"limit={limit}&page_info={urllib.parse.quote(page_info, safe='')}"
        else:
            qs = f"limit={limit}"

        url = f"https://{store}/admin/api/{SHOPIFY_API_VERSION}/products.json?{qs}"
        headers = {
            "X-Shopify-Access-Token": token,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        req = urllib.request.Request(url, headers=headers, method="GET")
        try:
            with urllib.request.urlopen(req) as resp:
                resp_body  = resp.read().decode()
                link_hdr   = resp.headers.get("Link", "")
                data       = json.loads(resp_body) if resp_body else {}
                status     = resp.status
        except urllib.error.HTTPError as e:
            error_body = e.read().decode() if e.fp else "{}"
            try:
                err = json.loads(error_body)
            except json.JSONDecodeError:
                err = {"error": error_body}
            self._respond(e.code, {"error": err.get("errors", err.get("error", "Error al listar productos"))})
            return
        except urllib.error.URLError as e:
            self._respond(502, {"error": str(e.reason)})
            return

        if status != 200:
            self._respond(status, {"error": data.get("errors", "Error al listar productos")})
            return

        next_cursor, prev_cursor = _parse_link_header(link_hdr)

        products = []
        for p in data.get("products", []):
            thumb = p["images"][0]["src"] if p.get("images") else ""
            products.append({
                "id":          p["id"],
                "title":       p.get("title", ""),
                "handle":      p.get("handle", ""),
                "status":      p.get("status", ""),
                "thumb":       thumb,
                "variants":    [{"id": v["id"], "option1": v.get("option1"), "option2": v.get("option2"), "option3": v.get("option3")} for v in p.get("variants", [])],
                "options":     [o.get("name") for o in p.get("options", [])],
            })

        self._respond(200, {
            "products":    products,
            "count":       len(products),
            "next_cursor": next_cursor,
            "prev_cursor": prev_cursor,
        })

    # ── POST /api/shopify/manage ─────────────────────────────────────────────
    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length)) if length else {}

        store      = _norm_store(body.get("store", ""))
        token      = body.get("token", "").strip()
        action     = body.get("action", "")
        product_id = body.get("product_id")

        if not store or not token or not action:
            self._respond(400, {"error": "Faltan store, token o action"})
            return

        if action == "delete":
            self._delete(store, token, product_id)
        elif action == "delete_bulk":
            self._delete_bulk(store, token, body.get("product_ids", []))
        elif action == "fix_images":
            self._fix_images(store, token, product_id)
        elif action == "update_variants":
            self._update_variants(store, token, product_id, body.get("variants", []))
        else:
            self._respond(400, {"error": f"Acción desconocida: {action}"})

    # ── Delete single product ────────────────────────────────────────────────
    def _delete(self, store, token, product_id):
        status, _ = _shopify_request(store, token, "DELETE", f"products/{product_id}.json")
        self._respond(200, {"success": status in (200, 204)})

    # ── Delete multiple products ─────────────────────────────────────────────
    def _delete_bulk(self, store, token, product_ids):
        ok, fail = 0, 0
        for pid in product_ids:
            status, _ = _shopify_request(store, token, "DELETE", f"products/{pid}.json")
            if status in (200, 204):
                ok += 1
            else:
                fail += 1
            time.sleep(0.4)   # Rate limit: 2 req/s
        self._respond(200, {"success": True, "deleted": ok, "errors": fail})

    # ── Fix variant images by filename-keyword matching ──────────────────────
    def _fix_images(self, store, token, product_id):
        status, data = _shopify_request(store, token, "GET", f"products/{product_id}.json")
        if status != 200:
            self._respond(status, {"error": "No se pudo obtener el producto"})
            return

        product  = data.get("product", {})
        images   = product.get("images", [])
        variants = product.get("variants", [])

        linked = 0
        for img in images:
            img_kws = _keywords_from_url(img.get("src", ""))
            matched = []
            for v in variants:
                for opt in [v.get("option1"), v.get("option2"), v.get("option3")]:
                    if not opt:
                        continue
                    # Match if any word of the option value appears in the image filename
                    opt_words = set(re.split(r"[-_\s\.]+", opt.lower()))
                    if opt_words & img_kws:   # non-empty intersection
                        matched.append(v["id"])
                        break

            if matched:
                _shopify_request(
                    store, token, "PUT",
                    f"products/{product_id}/images/{img['id']}.json",
                    {"image": {"id": img["id"], "variant_ids": matched}},
                )
                linked += 1
                time.sleep(0.3)

        self._respond(200, {"success": True, "linked": linked, "images": len(images)})

    # ── Update variant option values (after frontend translation) ────────────
    def _update_variants(self, store, token, product_id, variants):
        updated = 0
        for v in variants:
            vid  = v.get("id")
            if not vid:
                continue
            patch = {"id": vid}
            if v.get("option1") is not None: patch["option1"] = v["option1"]
            if v.get("option2") is not None: patch["option2"] = v["option2"]
            if v.get("option3") is not None: patch["option3"] = v["option3"]
            status, _ = _shopify_request(
                store, token, "PUT",
                f"variants/{vid}.json",
                {"variant": patch},
            )
            if status == 200:
                updated += 1
            time.sleep(0.3)
        self._respond(200, {"success": True, "updated": updated})

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def _respond(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", len(body))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass
