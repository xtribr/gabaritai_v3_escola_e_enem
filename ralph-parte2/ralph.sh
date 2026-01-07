#!/bin/bash
# =============================================================================
# RALPH - Gabaritai Parte 2: Integração + Deploy
# =============================================================================

MAX_ITERATIONS=${1:-20}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}"
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║     🚀 RALPH - Parte 2: Integração + Deploy                   ║"
echo "║                                                               ║"
echo "║     Vercel (Frontend) + Fly.io (Backend + Python)             ║"
echo "║                                                               ║"
echo "║     15 tasks para completar                                   ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

cd "$PROJECT_DIR"

# Status inicial
PENDING=$(cat "$SCRIPT_DIR/prd.json" | jq '[.userStories[] | select(.passes == false)] | length')
COMPLETED=$(cat "$SCRIPT_DIR/prd.json" | jq '[.userStories[] | select(.passes == true)] | length')
echo -e "Status: ${GREEN}$COMPLETED completas${NC} | ${YELLOW}$PENDING pendentes${NC}"
echo ""

for i in $(seq 1 $MAX_ITERATIONS); do
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo -e "Iteração $i de $MAX_ITERATIONS"
    
    # Próxima task
    NEXT_TASK=$(cat "$SCRIPT_DIR/prd.json" | jq -r '.userStories[] | select(.passes == false) | .id' | head -1)
    NEXT_TITLE=$(cat "$SCRIPT_DIR/prd.json" | jq -r ".userStories[] | select(.id == \"$NEXT_TASK\") | .title")
    echo -e "Task: ${CYAN}$NEXT_TASK${NC} - $NEXT_TITLE"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    
    # Executa Claude Code com o prompt
    OUTPUT=$(cat "$SCRIPT_DIR/prompt.md" | claude --dangerously-skip-permissions 2>&1 | tee /dev/stderr) || true
    
    # Verifica condições de parada
    if echo "$OUTPUT" | grep -q "<promise>COMPLETE</promise>"; then
        echo ""
        echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════╗${NC}"
        echo -e "${GREEN}║     🎉 DEPLOY COMPLETO! Gabaritai em produção!                ║${NC}"
        echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════╝${NC}"
        exit 0
    fi
    
    if echo "$OUTPUT" | grep -q "<promise>BLOCKED</promise>"; then
        echo -e "${YELLOW}⚠️ Bloqueado - verificar manualmente${NC}"
    fi
    
    # Atualiza contagem
    PENDING=$(cat "$SCRIPT_DIR/prd.json" | jq '[.userStories[] | select(.passes == false)] | length')
    COMPLETED=$(cat "$SCRIPT_DIR/prd.json" | jq '[.userStories[] | select(.passes == true)] | length')
    echo -e "Progresso: ${GREEN}$COMPLETED/15${NC} (${YELLOW}$PENDING pendentes${NC})"
    
    if [ "$PENDING" -eq 0 ]; then
        echo -e "${GREEN}🎉 TODAS AS TASKS COMPLETAS!${NC}"
        exit 0
    fi
    
    sleep 2
done

echo -e "${YELLOW}Máximo de iterações atingido${NC}"
echo "Rode novamente: ./ralph.sh 20"
