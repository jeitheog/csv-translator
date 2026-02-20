#!/bin/bash
# ============================================================
# Servidor local para CSV Traductor al Español
# Uso: bash servidor.sh
# ============================================================

PORT=8080
DIR="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "  🌐 CSV Traductor al Español"
echo "  ─────────────────────────────────────────"
echo "  Iniciando servidor en: http://localhost:$PORT"
echo "  Carpeta servida:       $DIR"
echo ""
echo "  Abre tu navegador en:"
echo "  👉  http://localhost:$PORT"
echo ""
echo "  Presiona Ctrl+C para detener el servidor."
echo "  ─────────────────────────────────────────"
echo ""

if command -v python3 &>/dev/null; then
  python3 -m http.server $PORT --directory "$DIR"
elif command -v python &>/dev/null; then
  cd "$DIR" && python -m SimpleHTTPServer $PORT
else
  echo "❌ Python no está instalado. Instala Python desde https://python.org"
  exit 1
fi
