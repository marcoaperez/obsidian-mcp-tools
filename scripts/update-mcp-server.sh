#!/bin/bash
# update-mcp-server.sh — Comprueba y descarga la última versión del servidor MCP
# Se ejecuta automáticamente via LaunchAgent o manualmente.

set -euo pipefail

REPO="marcoaperez/obsidian-mcp-tools"
INSTALL_DIR="$HOME/.local/bin"
BINARY_NAME="obsidian-mcp-server"
BINARY_PATH="$INSTALL_DIR/$BINARY_NAME"
VERSION_FILE="$INSTALL_DIR/.obsidian-mcp-version"
LOG_FILE="$HOME/Library/Logs/obsidian-mcp-update.log"

# Detectar arquitectura
ARCH=$(uname -m)
case "$ARCH" in
  arm64) ASSET_NAME="mcp-server-macos-arm64" ;;
  x86_64) ASSET_NAME="mcp-server-macos-x64" ;;
  *) echo "Arquitectura no soportada: $ARCH" >> "$LOG_FILE"; exit 1 ;;
esac

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# Crear directorio si no existe
mkdir -p "$INSTALL_DIR"
mkdir -p "$(dirname "$LOG_FILE")"

# Obtener última versión de GitHub
LATEST=$(curl -sf "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')

if [ -z "$LATEST" ]; then
  log "ERROR: No se pudo obtener la última versión de GitHub"
  exit 1
fi

# Comparar con versión instalada
CURRENT="none"
if [ -f "$VERSION_FILE" ]; then
  CURRENT=$(cat "$VERSION_FILE")
fi

if [ "$CURRENT" = "$LATEST" ]; then
  log "Ya estás en la última versión: $LATEST"
  exit 0
fi

log "Actualizando: $CURRENT → $LATEST"

# Descargar binario
DOWNLOAD_URL="https://github.com/$REPO/releases/download/$LATEST/$ASSET_NAME"
TMP_FILE=$(mktemp)

if curl -sfL "$DOWNLOAD_URL" -o "$TMP_FILE"; then
  mv "$TMP_FILE" "$BINARY_PATH"
  chmod +x "$BINARY_PATH"
  # Quitar cuarentena de macOS
  xattr -d com.apple.quarantine "$BINARY_PATH" 2>/dev/null || true
  echo "$LATEST" > "$VERSION_FILE"
  log "OK: Actualizado a $LATEST"
else
  rm -f "$TMP_FILE"
  log "ERROR: No se pudo descargar $DOWNLOAD_URL"
  exit 1
fi
