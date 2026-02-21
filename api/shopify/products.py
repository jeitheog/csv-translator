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

        # Strip _variant_image_src (custom field) from variants before sending to Shopify
        variant_image_srcs = []
        clean_variants = []
        for v in (product.get('variants') or []):
            img_src = v.pop('_variant_image_src', '') or ''
            variant_image_srcs.append(img_src)
            clean_variants.append(v)
        product['variants'] = clean_variants

        status, data = _shopify_request(store, token, 'POST', 'products.json', {'product': product})

        if status == 201:
            created = data.get('product', {})

            # After creation: link each variant to its specific image
            self._link_variant_images(store, token, created, variant_image_srcs)

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

    def _link_variant_images(self, store, token, created_product, variant_image_srcs):
        """
        Link each variant to its image by matching filenames between the original
        scraped image URLs (_variant_image_src) and the created product's image URLs.
        Shopify re-hosts images on its CDN, so we match by filename (not full URL).
        """
        if not any(variant_image_srcs):
            return

        created_images = created_product.get('images', [])
        created_variants = created_product.get('variants', [])

        # Build filename → image_id map from created images
        filename_to_image_id = {}
        for img in created_images:
            fn = _extract_filename(img.get('src', ''))
            if fn:
                filename_to_image_id[fn] = img['id']

        # For each variant, find its image by filename and update image_id
        for created_v, img_src in zip(created_variants, variant_image_srcs):
            if not img_src:
                continue
            fn = _extract_filename(img_src)
            image_id = filename_to_image_id.get(fn)
            if not image_id:
                continue
            variant_id = created_v.get('id')
            if not variant_id:
                continue
            _shopify_request(
                store, token, 'PUT',
                f'variants/{variant_id}.json',
                {'variant': {'id': variant_id, 'image_id': image_id}},
            )

    def _respond(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', len(body))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass
