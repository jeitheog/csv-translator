import json
import time
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


def _norm(s):
    """Normalize a CDN URL for matching: strip query params and lowercase."""
    if not s:
        return ""
    s = s.strip()
    if s.startswith("//"):
        s = "https:" + s
    return s.split("?")[0].lower()


class handler(BaseHTTPRequestHandler):

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length)) if length else {}

        store = body.get("store", "").strip().replace("https://", "").replace("http://", "").rstrip("/")
        if not store.endswith(".myshopify.com"):
            store += ".myshopify.com"
        token = body.get("token", "").strip()
        product = body.get("product")

        if not store or not token or not product:
            self._respond(400, {"error": "Faltan campos: store, token, product"})
            return

        # ── Step 1: extract _variant_image_src from each variant ──────────────
        images_list = product.get("images", []) or []
        variants_list = product.get("variants", []) or []

        # Build norm→index map from the images we're about to send
        img_norm_map = {}
        for i, img in enumerate(images_list):
            n = _norm(img.get("src", ""))
            if n and n not in img_norm_map:
                img_norm_map[n] = i

        # For each variant, pop its private field and record which image index
        # it should be linked to.  If the image isn't in our list yet, add it.
        # We also build the reverse map: image_index → [variant_indices]
        img_to_variant_indices = {}   # image list index → [variant list indices]
        for vi, v in enumerate(variants_list):
            src = v.pop("_variant_image_src", "") or ""
            if not src:
                continue
            n = _norm(src)
            if not n:
                continue
            if n not in img_norm_map:
                # Not in gallery yet — append it
                new_idx = len(images_list)
                images_list.append({"src": src})
                img_norm_map[n] = new_idx
            img_idx = img_norm_map[n]
            img_to_variant_indices.setdefault(img_idx, []).append(vi)

        product["images"] = images_list

        # ── Step 2: create the product ─────────────────────────────────────────
        status, data = _shopify_request(store, token, "POST", "products.json", {"product": product})

        if status != 201:
            error_msg = data.get("errors", data.get("error", "Error al crear producto"))
            self._respond(status or 500, {"success": False, "error": error_msg})
            return

        created = data.get("product", {})
        product_id = created.get("id")
        created_images   = sorted(created.get("images", []), key=lambda img: img.get("position", 0))
        created_variants = created.get("variants", [])

        # ── Step 3: associate images with variants using variant_ids ───────────
        # For each colour image, do ONE PUT to update image.variant_ids.
        # This is the recommended Shopify API approach — fewer calls, more reliable.
        for img_idx, variant_indices in img_to_variant_indices.items():
            if img_idx >= len(created_images):
                continue
            image_id = created_images[img_idx]["id"]

            # Resolve variant IDs
            variant_ids = []
            for vi in variant_indices:
                if vi < len(created_variants):
                    variant_ids.append(created_variants[vi]["id"])

            if not variant_ids:
                continue

            _shopify_request(
                store, token, "PUT",
                f"products/{product_id}/images/{image_id}.json",
                {"image": {"id": image_id, "variant_ids": variant_ids}},
            )
            time.sleep(0.3)   # Respect Shopify rate limits

        self._respond(201, {
            "success": True,
            "product": {
                "id": product_id,
                "title": created.get("title"),
                "variants_count": len(created_variants),
            },
        })

    def _respond(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass
