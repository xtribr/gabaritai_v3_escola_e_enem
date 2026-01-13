#!/bin/bash
# =============================================================================
# XTRI Ralph Setup - Instala Ralph em um projeto
# =============================================================================
# Uso: ./setup.sh /caminho/do/projeto
# =============================================================================

set -e

# Cores
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${1:-.}"

echo -e "${BLUE}XTRI Ralph Setup${NC}"
echo "=================="
echo ""

# Criar diretório
mkdir -p "$TARGET_DIR/scripts/ralph"

# Copiar arquivos
cp "$SCRIPT_DIR/ralph.sh" "$TARGET_DIR/scripts/ralph/"
cp "$SCRIPT_DIR/prompt.md" "$TARGET_DIR/scripts/ralph/"
cp "$SCRIPT_DIR/prd.json.example" "$TARGET_DIR/scripts/ralph/"
cp "$SCRIPT_DIR/README.md" "$TARGET_DIR/scripts/ralph/"

# Tornar executável
chmod +x "$TARGET_DIR/scripts/ralph/ralph.sh"

echo -e "${GREEN}✓ Ralph instalado em: $TARGET_DIR/scripts/ralph/${NC}"
echo ""
echo "Próximos passos:"
echo "  1. cd $TARGET_DIR/scripts/ralph"
echo "  2. cp prd.json.example prd.json"
echo "  3. Edite prd.json com suas user stories"
echo "  4. ./ralph.sh"
echo ""
