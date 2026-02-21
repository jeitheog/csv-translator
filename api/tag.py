import json
import os
import re
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler

GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY', '')
GEMINI_URL = (
    'https://generativelanguage.googleapis.com/v1beta/models/'
    'gemini-1.5-flash:generateContent?key=' + GEMINI_API_KEY
)


def _strip_html(html):
    text = re.sub(r'<[^>]+>', ' ', html)
    return re.sub(r'\s+', ' ', text).strip()


def _call_gemini(title, original_title, description, vendor):
    plain = _strip_html(description)[:800]
    brand_hint = f' La marca es "{vendor}".' if vendor else ''

    # Build the context block: original title gives the most reliable product clue
    context_parts = []
    if original_title and original_title != title:
        context_parts.append(f'Título original (idioma fuente): {original_title}')
    if title:
        context_parts.append(f'Título traducido al español: {title}')
    if plain:
        context_parts.append(f'Descripción: {plain}')
    context = '\n'.join(context_parts)

    prompt = (
        'Eres un experto en copywriting para tiendas premium de moda y decoración.'
        f'{brand_hint}\n\n'
        'Analiza la siguiente información del producto e identifica QUÉ ES exactamente el artículo '
        '(sofá, silla, bolso, zapatillas, chaqueta, etc.). '
        'Usa TODOS los datos disponibles: el título original en el idioma fuente suele ser el más fiable.\n\n'
        f'{context}\n\n'
        'Devuelve ÚNICAMENTE un objeto JSON con estos dos campos:\n\n'
        '- "tag": SOLO el tipo de artículo en español, máximo 3 palabras, '
        'sin adjetivos, colores ni materiales. '
        'Ejemplos: "Sofá", "Silla", "Mesa de comedor", "Bolso", "Zapatillas", '
        '"Chaqueta", "Camiseta", "Armario", "Lámpara", "Alfombra", "Cómoda".\n\n'
        '- "title": formato EXACTO → "[tag] - [característica más llamativa]"\n'
        '  El primer elemento es exactamente el mismo valor que "tag".\n'
        '  La característica: material, estilo o detalle único, máximo 5 palabras, sin nombre de marca.\n'
        '  Ejemplos:\n'
        '  {"tag":"Sofá","title":"Sofá - Chester de Terciopelo Azul Marino"}\n'
        '  {"tag":"Zapatillas","title":"Zapatillas - Running de Cuero Premium"}\n'
        '  {"tag":"Bolso","title":"Bolso - Piel Genuina Camel con Cadena"}\n\n'
        'Responde ÚNICAMENTE con el JSON, sin markdown ni explicación:'
    )

    body = json.dumps({
        'contents': [{'parts': [{'text': prompt}]}],
        'generationConfig': {'maxOutputTokens': 150, 'temperature': 0.1},
    }).encode()

    req = urllib.request.Request(
        GEMINI_URL, data=body,
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read().decode())

    raw = data['candidates'][0]['content']['parts'][0]['text'].strip()

    # Strip markdown code fences if present
    raw = re.sub(r'^```[a-z]*\n?', '', raw).rstrip('`').strip()

    parsed = json.loads(raw)
    title_out = str(parsed.get('title', '')).strip('.,;:!?\'" ')[:120]
    tag = str(parsed.get('tag', '')).strip('.,;:!?\'" ')[:60]

    # Guarantee: tag always matches the product name part of the title
    if title_out and ' - ' in title_out:
        tag = title_out.split(' - ')[0].strip()

    return tag, title_out


class handler(BaseHTTPRequestHandler):

    def do_POST(self):
        if not GEMINI_API_KEY:
            self._respond(500, {'error': 'GEMINI_API_KEY no configurada'})
            return

        length = int(self.headers.get('Content-Length', 0))
        body = json.loads(self.rfile.read(length)) if length else {}

        title          = (body.get('title')          or '').strip()
        original_title = (body.get('original_title') or '').strip()
        body_html      = (body.get('body_html')      or '').strip()
        vendor         = (body.get('vendor')         or '').strip()

        if not title and not original_title and not body_html:
            self._respond(400, {'error': 'Falta title, original_title o body_html'})
            return

        try:
            tag, new_title = _call_gemini(title, original_title, body_html, vendor)
            self._respond(200, {'tag': tag, 'title': new_title})
        except urllib.error.HTTPError as e:
            err = e.read().decode() if e.fp else str(e)
            self._respond(502, {'error': f'Gemini API error: {err[:300]}'})
        except Exception as e:
            self._respond(500, {'error': str(e)})

    def _respond(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', len(body))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass
