import json
from http.server import BaseHTTPRequestHandler


class handler(BaseHTTPRequestHandler):
    """JWT es stateless: el cliente descarta el token. El servidor solo confirma."""

    def do_POST(self):
        body = json.dumps({'success': True}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(body))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass
