#!/bin/bash
# install.sh — Instalador todo-en-uno para compañeros de Taiko
# Uso: curl -fsSL https://raw.githubusercontent.com/marcoaperez/obsidian-mcp-tools/main/scripts/install.sh | bash
#
# Qué hace:
# 1. Descarga el servidor MCP (última versión)
# 2. Configura actualización automática diaria (LaunchAgent)
# 3. Muestra la configuración para Claude Desktop

set -euo pipefail

REPO="marcoaperez/obsidian-mcp-tools"
INSTALL_DIR="$HOME/.local/bin"
BINARY_NAME="obsidian-mcp-server"
BINARY_PATH="$INSTALL_DIR/$BINARY_NAME"
PLIST_NAME="com.taiko.obsidian-mcp-update"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$PLIST_DIR/$PLIST_NAME.plist"
UPDATE_SCRIPT="$INSTALL_DIR/update-obsidian-mcp.sh"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  Instalador MCP Tools para Obsidian (Taiko)  ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# --- Paso 1: Detectar arquitectura ---
ARCH=$(uname -m)
case "$ARCH" in
  arm64) ASSET_NAME="mcp-server-macos-arm64" ;;
  x86_64) ASSET_NAME="mcp-server-macos-x64" ;;
  *)
    echo "❌ Arquitectura no soportada: $ARCH"
    exit 1
    ;;
esac
echo "→ Arquitectura detectada: $ARCH ($ASSET_NAME)"

# --- Paso 2: Descargar binario ---
mkdir -p "$INSTALL_DIR"

echo "→ Descargando última versión..."
LATEST=$(curl -sf "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')

if [ -z "$LATEST" ]; then
  echo "❌ No se pudo obtener la última versión"
  exit 1
fi

DOWNLOAD_URL="https://github.com/$REPO/releases/download/$LATEST/$ASSET_NAME"
curl -fSL "$DOWNLOAD_URL" -o "$BINARY_PATH"
chmod +x "$BINARY_PATH"
xattr -d com.apple.quarantine "$BINARY_PATH" 2>/dev/null || true
echo "$LATEST" > "$INSTALL_DIR/.obsidian-mcp-version"

echo "✓ Servidor MCP $LATEST instalado en $BINARY_PATH"

# --- Paso 3: Instalar script de actualización ---
cat > "$UPDATE_SCRIPT" << 'UPDATER'
#!/bin/bash
set -euo pipefail
REPO="marcoaperez/obsidian-mcp-tools"
INSTALL_DIR="$HOME/.local/bin"
BINARY_NAME="obsidian-mcp-server"
BINARY_PATH="$INSTALL_DIR/$BINARY_NAME"
VERSION_FILE="$INSTALL_DIR/.obsidian-mcp-version"
LOG_FILE="$HOME/Library/Logs/obsidian-mcp-update.log"
ARCH=$(uname -m)
case "$ARCH" in
  arm64) ASSET_NAME="mcp-server-macos-arm64" ;;
  x86_64) ASSET_NAME="mcp-server-macos-x64" ;;
  *) echo "[$(date)] Arquitectura no soportada: $ARCH" >> "$LOG_FILE"; exit 1 ;;
esac
mkdir -p "$INSTALL_DIR" "$(dirname "$LOG_FILE")"
LATEST=$(curl -sf "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')
if [ -z "$LATEST" ]; then
  echo "[$(date)] ERROR: No se pudo obtener versión" >> "$LOG_FILE"; exit 1
fi
CURRENT="none"
[ -f "$VERSION_FILE" ] && CURRENT=$(cat "$VERSION_FILE")
if [ "$CURRENT" = "$LATEST" ]; then
  echo "[$(date)] Ya en última versión: $LATEST" >> "$LOG_FILE"; exit 0
fi
echo "[$(date)] Actualizando: $CURRENT → $LATEST" >> "$LOG_FILE"
TMP=$(mktemp)
if curl -sfL "https://github.com/$REPO/releases/download/$LATEST/$ASSET_NAME" -o "$TMP"; then
  mv "$TMP" "$BINARY_PATH"
  chmod +x "$BINARY_PATH"
  xattr -d com.apple.quarantine "$BINARY_PATH" 2>/dev/null || true
  echo "$LATEST" > "$VERSION_FILE"
  echo "[$(date)] OK: Actualizado a $LATEST" >> "$LOG_FILE"
else
  rm -f "$TMP"
  echo "[$(date)] ERROR: Descarga fallida" >> "$LOG_FILE"; exit 1
fi
UPDATER
chmod +x "$UPDATE_SCRIPT"
echo "✓ Script de actualización instalado"

# --- Paso 4: Configurar LaunchAgent ---
mkdir -p "$PLIST_DIR"

# Descargar el LaunchAgent si ya existe
launchctl bootout "gui/$(id -u)/$PLIST_NAME" 2>/dev/null || true

cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$PLIST_NAME</string>
    <key>ProgramArguments</key>
    <array>
        <string>$UPDATE_SCRIPT</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>9</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$HOME/Library/Logs/obsidian-mcp-update.log</string>
    <key>StandardErrorPath</key>
    <string>$HOME/Library/Logs/obsidian-mcp-update.log</string>
</dict>
</plist>
EOF

launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH" 2>/dev/null || true
echo "✓ Actualización automática configurada (diaria a las 9:00 + al iniciar sesión)"

# --- Paso 5: Mostrar configuración para Claude Desktop ---
echo ""
echo "══════════════════════════════════════════════════"
echo "  ÚLTIMO PASO: Configurar Claude Desktop"
echo "══════════════════════════════════════════════════"
echo ""
echo "1. Abre el archivo de configuración:"
echo ""
echo "   open ~/Library/Application\\ Support/Claude/claude_desktop_config.json"
echo ""
echo "2. Añade esto dentro de \"mcpServers\" (reemplaza TU_API_KEY):"
echo ""
echo "   \"obsidian-mcp-tools\": {"
echo "     \"command\": \"$BINARY_PATH\","
echo "     \"env\": {"
echo "       \"OBSIDIAN_API_KEY\": \"TU_API_KEY_AQUI\""
echo "     }"
echo "   }"
echo ""
echo "3. Para obtener la API Key:"
echo "   Obsidian → Ajustes → Community Plugins → Local REST API → copiar"
echo ""
echo "4. Reinicia Claude Desktop (Cmd+Q y volver a abrir)"
echo ""
echo "══════════════════════════════════════════════════"
echo "  ✓ Instalación completada"
echo "  ✓ El servidor se actualizará automáticamente"
echo "══════════════════════════════════════════════════"
echo ""
