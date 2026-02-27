import json
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


def _extract_filename(url):
    """Extract lowercase filename (without query params) from a URL."""
    try:
        return url.split('?')[0].rstrip('/').split('/')[-1].lower()
    except Exception:
        return ''


class handler(BaseHTTPRequestHandler):

    def _norm_img(self, s):
        if not s: return ""
        s = s.strip()
        if s.startswith("//"): s = "https:" + s
        return s.split('?')[0] # Remove query params for stable comparison

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

        # Extract _variant_image_src from each variant
        # Map variant_index to the ORIGINAL source URL
        var_img_map = {}  # variant_index -> original_src
        for i, variant in enumerate(product.get('variants', [])):
            src = (variant.pop('_variant_image_src', '') or '').strip()
            if src:
                var_img_map[i] = src

        # Deduplicate: remove variant images from product['images'] if they match (normalized)
        variant_norm_keys = set(self._norm_img(s) for s in var_img_map.values())
        if 'images' in product and variant_norm_keys:
            product['images'] = [img for img in product['images']
                                  if self._norm_img(img.get('src')) not in variant_norm_keys]
            if not product['images']:
                del product['images']

        status, data = _shopify_request(store, token, 'POST', 'products.json', {'product': product})

        if status == 201:
            created = data.get('product', {})
            product_id = created.get('id')
            created_variants = created.get('variants', [])

            # Second pass: association by re-uploading with variant_ids
            # This is slow but robust as it doesn't depend on filename matching
            if var_img_map and product_id:
                img_to_vids = {}
                for idx, src in var_img_map.items():
                    if idx < len(created_variants):
                        vid = created_variants[idx]["id"]
                        img_to_vids.setdefault(src, []).append(vid)

                import time
                for src, vids in img_to_vids.items():
                    _shopify_request(
                        store, token, 'POST',
                        f'products/{product_id}/images.json',
                        {'image': {'src': src, 'variant_ids': vids}}
                    )
                    time.sleep(0.5) # Prevent rate limits

            self._respond(201, {
                'success': True,
                'product': {
                    'id': product_id,
                    'title': created.get('title'),
                    'variants_count': len(created_variants),
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
