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


def _call_gemini(title, description, vendor):
    plain = _strip_html(description)[:800]
    brand_hint = f' La marca es "{vendor}".' if vendor else ''
    prompt = (
        'Eres un experto en copywriting para tiendas de decoración y muebles de lujo.'
        f'{brand_hint}\n\n'
        'Analiza el siguiente producto y devuelve ÚNICAMENTE un objeto JSON válido con estos dos campos:\n'
        '- "tag": tipo de artículo en español, una palabra o frase muy corta (máximo 3 palabras), '
        'sin adjetivos ni colores. Ejemplos: "Sofá", "Mesa de comedor", "Silla", "Armario", '
        '"Lámpara", "Alfombra", "Estantería", "Espejo", "Cómoda", "Sillón".\n'
        '- "title": título de producto elegante en español, enfoque premium de marca, '
        'máximo 8 palabras, destaca el material o característica más distintiva, '
        'sin incluir el nombre de la marca.\n\n'
        f'Título original: {title}\n'
        f'Descripción: {plain}\n\n'
        'Responde ÚNICAMENTE con el JSON, sin markdown ni explicación. Ejemplo:\n'
        '{"tag":"Sofá","title":"Sofá Chester de Terciopelo Azul Marino"}'
    )

    body = json.dumps({
        'contents': [{'parts': [{'text': prompt}]}],
        'generationConfig': {'maxOutputTokens': 80, 'temperature': 0.2},
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
    tag   = str(parsed.get('tag', '')).strip('.,;:!?\'" ')[:60]
    title_out = str(parsed.get('title', '')).strip('.,;:!?\'" ')[:120]
    return tag, title_out


class handler(BaseHTTPRequestHandler):

    def do_POST(self):
        if not GEMINI_API_KEY:
            self._respond(500, {'error': 'GEMINI_API_KEY no configurada'})
            return

        length = int(self.headers.get('Content-Length', 0))
        body = json.loads(self.rfile.read(length)) if length else {}

        title    = (body.get('title')    or '').strip()
        body_html = (body.get('body_html') or '').strip()
        vendor   = (body.get('vendor')   or '').strip()

        if not title and not body_html:
            self._respond(400, {'error': 'Falta title o body_html'})
            return

        try:
            tag, new_title = _call_gemini(title, body_html, vendor)
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
