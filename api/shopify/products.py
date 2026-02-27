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

    def _norm(self, s):
        if not s: return ""
        s = s.strip()
        if s.startswith("//"): s = "https:" + s
        return s.split('?')[0].lower()

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

        # 1. Map each variant to an image index based on its _variant_image_src
        images_list = product.get('images', [])
        image_norm_map = {self._norm(img.get('src')): i for i, img in enumerate(images_list)}
        
        # variant_index -> image_index
        v_to_img_idx = {}
        for i, v in enumerate(product.get('variants', [])):
            src = v.pop('_variant_image_src', '')
            if src:
                norm_src = self._norm(src)
                if norm_src in image_norm_map:
                    v_to_img_idx[i] = image_norm_map[norm_src]
                else:
                    # If variant image is not in gallery, add it to have an ID
                    new_idx = len(images_list)
                    images_list.append({'src': src})
                    image_norm_map[norm_src] = new_idx
                    v_to_img_idx[i] = new_idx
        
        product['images'] = images_list

        # 2. Create the product
        status, data = _shopify_request(store, token, 'POST', 'products.json', {'product': product})

        if status == 201:
            created = data.get('product', {})
            product_id = created.get('id')
            created_images = created.get('images', [])
            created_variants = created.get('variants', [])

            # 3. Associate images with variants using the real IDs
            import time
            for v_idx, img_idx in v_to_img_idx.items():
                if v_idx < len(created_variants) and img_idx < len(created_images):
                    vid = created_variants[v_idx]['id']
                    iid = created_images[img_idx]['id']
                    
                    _shopify_request(
                        store, token, 'PUT',
                        f'variants/{vid}.json',
                        {'variant': {'id': vid, 'image_id': iid}}
                    )
                    time.sleep(0.4) # Avoid hitting Shopify rate limits

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
