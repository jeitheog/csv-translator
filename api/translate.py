import json
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler


def _google_translate(text, sl, tl):
    url = (
        "https://translate.googleapis.com/translate_a/single"
        f"?client=gtx&sl={urllib.parse.quote(sl)}&tl={urllib.parse.quote(tl)}"
        f"&dt=t&q={urllib.parse.quote(text)}"
    )
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
    })
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read().decode())
    if data and data[0]:
        return "".join(seg[0] for seg in data[0] if seg and seg[0])
    return None


def _mymemory_translate(text, sl, tl):
    langpair = f"{sl}|{tl}"
    url = (
        "https://api.mymemory.translated.net/get"
        f"?q={urllib.parse.quote(text)}&langpair={urllib.parse.quote(langpair)}"
    )
    with urllib.request.urlopen(url, timeout=10) as resp:
        data = json.loads(resp.read().decode())
    if data.get("responseStatus") == 200:
        translated = data.get("responseData", {}).get("translatedText", "")
        if translated:
            return translated
    return None


class handler(BaseHTTPRequestHandler):

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length)) if length else {}

        text = body.get("text", "").strip()
        sl = body.get("sl", "auto").strip() or "auto"
        tl = body.get("tl", "").strip()

        if not text or not tl:
            self._respond(400, {"error": "Faltan campos: text, tl"})
            return

        # Try Google Translate first (server-side, no CORS issues)
        try:
            translated = _google_translate(text, sl, tl)
            if translated:
                self._respond(200, {"translated": translated, "source": "google"})
                return
        except Exception:
            pass

        # Fallback: MyMemory
        try:
            translated = _mymemory_translate(text, sl, tl)
            if translated:
                self._respond(200, {"translated": translated, "source": "mymemory"})
                return
        except Exception:
            pass

        self._respond(502, {"error": "No se pudo traducir el texto"})

    def _respond(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass
