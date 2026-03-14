#!/usr/bin/env python3
"""
CSV Traductor al Español — Servidor local con proxy a Shopify Admin API.
No requiere dependencias externas (solo librería estándar de Python 3).

Uso: python3 server.py
"""

import base64
import hashlib
import hmac
import http.server
import json
import os
import ssl
import sys
import time
import urllib.parse
import urllib.request
import urllib.error

PORT = 8080
SHOPIFY_API_VERSION = "2024-01"

# Directorio de archivos estáticos (donde está este script)
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'public')


# ── Carga .env ──────────────────────────────────────────────
def _load_env():
    env_path = os.path.join(STATIC_DIR, '.env')
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, _, v = line.partition('=')
                    os.environ.setdefault(k.strip(), v.strip())

_load_env()


# ── JWT stateless (HMAC-SHA256, sin dependencias externas) ───
# Funciona igual en local y en Vercel serverless.

def _verify_password(password: str, stored_hash: str, salt: str) -> bool:
    computed = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 100000).hex()
    return hmac.compare_digest(computed, stored_hash)


def _create_token(email: str, role: str, ttl: int = 86400) -> str:
    payload = json.dumps({'email': email, 'role': role, 'exp': int(time.time()) + ttl})
    payload_b64 = base64.urlsafe_b64encode(payload.encode()).rstrip(b'=').decode()
    secret = os.environ.get('SECRET_KEY', '')
    sig = hmac.new(secret.encode(), payload_b64.encode(), hashlib.sha256).hexdigest()
    return f"{payload_b64}.{sig}"


def _verify_token(token: str):
    try:
        payload_b64, sig = token.rsplit('.', 1)
        secret = os.environ.get('SECRET_KEY', '')
        expected = hmac.new(secret.encode(), payload_b64.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            return None
        padding = 4 - len(payload_b64) % 4
        if padding != 4:
            payload_b64 += '=' * padding
        payload = json.loads(base64.urlsafe_b64decode(payload_b64))
        if payload.get('exp', 0) < time.time():
            return None
        return payload
    except Exception:
        return None


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
        if self.path == "/api/auth/login":
            self._handle_login()
        elif self.path == "/api/auth/logout":
            self._handle_logout()
        elif self.path == "/api/shopify/test":
            self._handle_shopify_test()
        elif self.path == "/api/shopify/products":
            self._handle_shopify_create_product()
        elif self.path == "/api/translate":
            self._handle_translate()
        elif self.path == "/api/tag":
            self._handle_tag()
        elif self.path == "/api/scraper":
            self._handle_scraper()
        else:
            self.send_error(404, "Endpoint no encontrado")

    def do_GET(self):
        if self.path == "/api/auth/verify":
            self._handle_verify()
        else:
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

    # ─── Auth Handlers ──────────────────────────────────────
    def _handle_login(self):
        body = self._read_json_body()
        if not body or 'email' not in body or 'password' not in body:
            self._send_json_response(400, {'success': False, 'error': 'Faltan email y contraseña'})
            return

        email = body['email'].strip().lower()
        password = body['password']

        admin_email = os.environ.get('ADMIN_EMAIL', '').strip().lower()
        admin_hash  = os.environ.get('ADMIN_PASSWORD_HASH', '')
        admin_salt  = os.environ.get('ADMIN_SALT', '')

        if not admin_email or not admin_hash or not admin_salt:
            self._send_json_response(500, {
                'success': False,
                'error': 'Servidor no configurado. Ejecuta: python3 setup_admin.py'
            })
            return

        if email == admin_email and _verify_password(password, admin_hash, admin_salt):
            token = _create_token(email, 'admin')
            self._send_json_response(200, {
                'success': True,
                'token': token,
                'user': {
                    'email': email,
                    'name': 'Super Admin',
                    'plan': 'unlimited',
                    'role': 'admin',
                    'usage': 0,
                    'filesProcessed': 0,
                    'billingHistory': [],
                    'status': 'active',
                }
            })
        else:
            self._send_json_response(401, {'success': False, 'error': 'Credenciales incorrectas'})

    def _handle_logout(self):
        # JWT es stateless: el cliente descarta el token. El servidor confirma.
        self._send_json_response(200, {'success': True})

    def _handle_verify(self):
        token = self.headers.get('Authorization', '').replace('Bearer ', '').strip()
        payload = _verify_token(token) if token else None
        if payload:
            self._send_json_response(200, {
                'success': True,
                'role': payload['role'],
                'email': payload['email'],
            })
        else:
            self._send_json_response(401, {'success': False, 'error': 'Sesión inválida o expirada'})

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
    @staticmethod
    def _norm(s):
        if not s: return ""
        s = s.strip()
        if s.startswith("//"): s = "https:" + s
        return s.split('?')[0].lower()

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
                    # Not in gallery, add it
                    new_idx = len(images_list)
                    images_list.append({'src': src})
                    image_norm_map[norm_src] = new_idx
                    v_to_img_idx[i] = new_idx
        
        product['images'] = images_list

        # 2. Create the product
        status, data = self._shopify_request(
            store, token, "POST", "products.json", {"product": product}
        )

        if status == 201:
            created = data.get("product", {})
            product_id = created.get("id")
            created_images = created.get("images", [])
            created_variants = created.get("variants", [])

            # 3. Associate images with variants using IDs (order is preserved)
            import time
            for v_idx, img_idx in v_to_img_idx.items():
                if v_idx < len(created_variants) and img_idx < len(created_images):
                    vid = created_variants[v_idx]['id']
                    iid = created_images[img_idx]['id']
                    
                    self._shopify_request(
                        store, token, "PUT",
                        f"variants/{vid}.json",
                        {"variant": {"id": vid, "image_id": iid}}
                    )
                    time.sleep(0.4) # Rate limit safety

            self._send_json_response(201, {
                "success": True,
                "product": {
                    "id": product_id,
                    "title": created.get("title"),
                    "variants_count": len(created_variants),
                }
            })
        else:
            error_msg = data.get("errors", data.get("error", "Error al crear producto"))
            self._send_json_response(status or 500, {
                "success": False,
                "error": error_msg
            })

    # ─── Translate proxy ────────────────────────────────────
    def _handle_translate(self):
        import urllib.parse as _urlparse
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length)) if length else {}
        text = body.get("text", "").strip()
        sl = body.get("sl", "auto").strip() or "auto"
        tl = body.get("tl", "").strip()
        if not text or not tl:
            self._send_json_response(400, {"error": "Faltan campos: text, tl"})
            return
        # Try Google Translate
        try:
            url = (
                "https://translate.googleapis.com/translate_a/single"
                f"?client=gtx&sl={_urlparse.quote(sl)}&tl={_urlparse.quote(tl)}"
                f"&dt=t&q={_urlparse.quote(text)}"
            )
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode())
            if data and data[0]:
                translated = "".join(seg[0] for seg in data[0] if seg and seg[0])
                if translated:
                    self._send_json_response(200, {"translated": translated, "source": "google"})
                    return
        except Exception:
            pass
        # Fallback: MyMemory
        try:
            url2 = f"https://api.mymemory.translated.net/get?q={_urlparse.quote(text)}&langpair={_urlparse.quote(sl + '|' + tl)}"
            with urllib.request.urlopen(url2, timeout=10) as resp:
                data2 = json.loads(resp.read().decode())
            if data2.get("responseStatus") == 200:
                t = data2.get("responseData", {}).get("translatedText", "")
                if t:
                    self._send_json_response(200, {"translated": t, "source": "mymemory"})
                    return
        except Exception:
            pass
        self._send_json_response(502, {"error": "No se pudo traducir"})

    # ─── Shopify scraper ─────────────────────────────────────
    @staticmethod
    def _get_store_base(parsed):
        return f"{parsed.scheme}://{parsed.netloc}"

    def _handle_scraper(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length)) if length else {}
        raw_url = body.get("url", "").strip()
        if not raw_url:
            self._send_json_response(400, {"error": "Falta la URL de la tienda"})
            return

        store_url = raw_url.rstrip("/")
        if not store_url.startswith("http"):
            store_url = "https://" + store_url

        parsed = urllib.parse.urlparse(store_url)
        path = parsed.path.lower()
        store_base = self._get_store_base(parsed)

        print(f"[Scraper] Raw URL: {raw_url}")
        print(f"[Scraper] Cleaned: {store_url} | Path: {path} | Base: {store_base}")

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json",
        }
        all_products = []
        try:
            # 1. Attempt Single Product if /products/ is in path
            if "/products/" in path:
                parts = path.split("/")
                try:
                    p_idx = next(i for i, part in enumerate(parts) if part == "products")
                    handle = parts[p_idx + 1]
                    print(f"[Scraper] Detected product handle: {handle}")
                    
                    url = f"{store_base}/products/{handle}.json"
                    print(f"[Scraper] Attempting direct fetch: {url}")
                    try:
                        req = urllib.request.Request(url, headers=headers)
                        with urllib.request.urlopen(req, timeout=10) as resp:
                            data = json.loads(resp.read().decode())
                        p = data.get("product")
                        if p:
                            all_products = [p]
                            print(f"[Scraper] Success: Found '{p.get('title')}' via direct JSON")
                    except Exception as e:
                        print(f"[Scraper] Direct JSON failed: {str(e)}. Falling back to full store fetch filtered by handle.")
                except (ValueError, IndexError, StopIteration):
                    print("[Scraper] Could not extract handle from path parts.")

            # 2. Full Store Search (if not found or not a single product URL)
            if not all_products:
                print(f"[Scraper] Fetching all products from: {store_base}/products.json")
                page = 1
                target_handle = None
                if "/products/" in path:
                    target_handle = path.split("/products/")[1].split("/")[0].split("?")[0]

                while True:
                    url = f"{store_base}/products.json?limit=250&page={page}"
                    req = urllib.request.Request(url, headers=headers)
                    with urllib.request.urlopen(req, timeout=12) as resp:
                        data = json.loads(resp.read().decode())
                    products = data.get("products", [])
                    if not products:
                        break
                    
                    if target_handle:
                        # If we are looking for a specific product, check if it's in this page
                        p = next((x for x in products if x.get('handle') == target_handle), None)
                        if p:
                            all_products = [p]
                            print(f"[Scraper] Success: Found '{p.get('title')}' in full products list")
                            break
                    else:
                        all_products.extend(products)

                    if len(products) < 250 or page >= 20:
                        break
                    page += 1
        except urllib.error.HTTPError as e:
            msg = f"Error {e.code} de la tienda"
            print(f"[Scraper] HTTP Error: {e.code}")
            self._send_json_response(e.code, {"error": msg})
            return
        except Exception as e:
            print(f"[Scraper] Global Error: {str(e)}")
            self._send_json_response(502, {"error": f"Fallo de conexión: {str(e)}"})
            return

        print(f"[Scraper] Done. Found {len(all_products)} product(s).")
        self._send_json_response(200, {"products": all_products, "total": len(all_products)})

    # ─── AI Tag/Enrichment proxy ─────────────────────────────
    def _handle_tag(self):
        gemini_api_key = os.environ.get('GEMINI_API_KEY', '')
        if not gemini_api_key:
            self._send_json_response(500, {'error': 'GEMINI_API_KEY no configurada'})
            return

        length = int(self.headers.get('Content-Length', 0))
        body = json.loads(self.rfile.read(length)) if length else {}

        title          = (body.get('title')          or '').strip()
        original_title = (body.get('original_title') or '').strip()
        body_html      = (body.get('body_html')      or '').strip()
        vendor         = (body.get('vendor')         or '').strip()
        handle         = (body.get('handle')         or '').strip()

        if not title and not original_title and not body_html and not handle:
            self._send_json_response(400, {'error': 'Falta title, original_title, handle o body_html'})
            return

        def _strip_html(html):
            if not html: return ''
            import re
            text = re.sub(r'<[^>]+>', ' ', html)
            return re.sub(r'\s+', ' ', text).strip()

        plain = _strip_html(body_html)[:800]
        brand_hint = f' La marca es "{vendor}".' if vendor else ''

        context_parts = []
        if handle: context_parts.append(f'Handle del producto: {handle}')
        if original_title: context_parts.append(f'Título original (idioma fuente): {original_title}')
        if title and title != original_title: context_parts.append(f'Título traducido al español: {title}')
        if plain: context_parts.append(f'Descripción: {plain}')
        context = '\n'.join(context_parts)

        prompt = (
            'Eres un experto en copywriting para tiendas premium de moda y decoración.'
            f'{brand_hint}\n\n'
            'TU MISIÓN: Identificar qué es exactamente el producto basándote en los DATOS ORIGINALES '
            '(título original y descripción) para generar un nuevo título elegante.\n\n'
            'PASOS:\n'
            '1. Analiza el "Título original" y la "Descripción" (en su idioma fuente) para identificar el tipo de producto. '
            'El handle también da pistas cruciales.\n'
            '2. Determina el NOMBRE DEL PRODUCTO en español (ej: "Zapatillas", "Sofá", "Vestido", "Bolso"). '
            'Debe ser el nombre genérico más exacto. Si son unas zapatillas, USA "Zapatillas".\n'
            '3. Extrae la característica más llamativa o el estilo (ej: "Cuero Genuino", "Estilo Nórdico").\n\n'
            f'{context}\n\n'
            'REGLAS DE RESPUESTA (JSON ÚNICAMENTE):\n'
            '- "tag": El tipo de artículo en español (ej: "Reloj", "Chaqueta"), máximo 2-3 palabras.\n'
            '- "title": FORMATO EXACTO → "[tag] - [característica llamativa]"\n'
            'Ejemplos correctos:\n'
            '{"tag":"Zapatillas","title":"Zapatillas - Urban Style de Cuero Blanco"}\n'
            '{"tag":"Sofá","title":"Sofá - Terciopelo Azul con Patas de Roble"}\n'
            '{"tag":"Vestido","title":"Vestido - Seda con Estampado Floral"}\n\n'
            'IMPORTANTE: Responde ÚNICAMENTE con el objeto JSON. Sin markdown, sin explicaciones.'
        )

        gemini_url = f'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={gemini_api_key}'
        gemini_body = json.dumps({
            'contents': [{'parts': [{'text': prompt}]}],
            'generationConfig': {'maxOutputTokens': 150, 'temperature': 0.1},
        }).encode()

        try:
            req = urllib.request.Request(
                gemini_url, data=gemini_body,
                headers={'Content-Type': 'application/json'},
                method='POST',
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode())

            raw = data['candidates'][0]['content']['parts'][0]['text'].strip()
            import re
            raw = re.sub(r'^```[a-z]*\n?', '', raw).rstrip('`').strip()

            parsed = json.loads(raw)
            title_out = str(parsed.get('title', '')).strip('.,;:!?\'" ')[:120]
            tag = str(parsed.get('tag', '')).strip('.,;:!?\'" ')[:60]

            if title_out and ' - ' in title_out:
                tag = title_out.split(' - ')[0].strip()

            self._send_json_response(200, {'tag': tag, 'title': title_out})
        except Exception as e:
            self._send_json_response(500, {'error': str(e)})

    # ─── Suppress default logging clutter ───────────────────
    def log_message(self, format, *args):
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
    print("    POST /api/auth/login        → Login admin")
    print("    POST /api/auth/logout       → Logout")
    print("    GET  /api/auth/verify       → Verificar token")
    print("    POST /api/shopify/test      → Verificar conexión Shopify")
    print("    POST /api/shopify/products  → Crear producto Shopify")
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
