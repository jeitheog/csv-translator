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


def _call_gemini(title, original_title, description, vendor, handle=None):
    plain = _strip_html(description)[:800]
    brand_hint = f' La marca es "{vendor}".' if vendor else ''

    # Build the context block: original title and handle give the most reliable product clues
    context_parts = []
    if handle:
        context_parts.append(f'Handle del producto: {handle}')
    if original_title:
        context_parts.append(f'Título original (idioma fuente): {original_title}')
    if title and title != original_title:
        context_parts.append(f'Título traducido al español: {title}')
    if plain:
        context_parts.append(f'Descripción: {plain}')
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
        handle         = (body.get('handle')         or '').strip()

        if not title and not original_title and not body_html and not handle:
            self._respond(400, {'error': 'Falta title, original_title, handle o body_html'})
            return

        try:
            tag, new_title = _call_gemini(title, original_title, body_html, vendor, handle)
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
