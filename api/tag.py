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


def _call_gemini(title, description):
    plain = _strip_html(description)[:600]
    prompt = (
        'Analiza este producto y devuelve ÚNICAMENTE el tipo de artículo '
        'en español como una sola palabra o frase muy corta (máximo 3 palabras). '
        'Ejemplos válidos: Sofá, Silla, Mesa de comedor, Cama, Armario, '
        'Lámpara, Alfombra, Estantería, Espejo, Cómoda, Sillón, Taburete.\n'
        'NO incluyas adjetivos, colores ni materiales. SOLO el tipo de artículo.\n\n'
        f'Título: {title}\n'
        f'Descripción: {plain}\n\n'
        'Responde ÚNICAMENTE con el tipo de artículo, sin puntuación ni explicación:'
    )

    body = json.dumps({
        'contents': [{'parts': [{'text': prompt}]}],
        'generationConfig': {'maxOutputTokens': 20, 'temperature': 0},
    }).encode()

    req = urllib.request.Request(
        GEMINI_URL, data=body,
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read().decode())
    raw = data['candidates'][0]['content']['parts'][0]['text'].strip()
    # Capitalise and remove stray punctuation
    tag = raw.strip('.,;:!?"\' ').strip()
    return tag[:60] if tag else ''


class handler(BaseHTTPRequestHandler):

    def do_POST(self):
        if not GEMINI_API_KEY:
            self._respond(500, {'error': 'GEMINI_API_KEY no configurada'})
            return

        length = int(self.headers.get('Content-Length', 0))
        body = json.loads(self.rfile.read(length)) if length else {}

        title = (body.get('title') or '').strip()
        body_html = (body.get('body_html') or '').strip()

        if not title and not body_html:
            self._respond(400, {'error': 'Falta title o body_html'})
            return

        try:
            tag = _call_gemini(title, body_html)
            self._respond(200, {'tag': tag})
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
