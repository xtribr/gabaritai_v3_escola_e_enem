#!/bin/bash
# =============================================================================
# RALPH - Gabaritai Admin + Alunos
# =============================================================================

MAX_ITERATIONS=${1:-15}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}"
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║        🎯 RALPH - Gabaritai Admin + Alunos                ║"
echo "║           10 tasks para completar                         ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

cd "$PROJECT_DIR"

# Status inicial
PENDING=$(cat "$SCRIPT_DIR/prd.json" | jq '[.userStories[] | select(.passes == false)] | length')
echo -e "Tasks pendentes: ${YELLOW}$PENDING${NC}"
echo ""

for i in $(seq 1 $MAX_ITERATIONS); do
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo -e "Iteração $i de $MAX_ITERATIONS"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    
    # Executa Claude Code com o prompt
    OUTPUT=$(cat "$SCRIPT_DIR/prompt.md" | claude --dangerously-skip-permissions 2>&1 | tee /dev/stderr) || true
    
    # Verifica condições de parada
    if echo "$OUTPUT" | grep -q "<promise>COMPLETE</promise>"; then
        echo ""
        echo -e "${GREEN}🎉 TODAS AS TASKS COMPLETAS!${NC}"
        exit 0
    fi
    
    if echo "$OUTPUT" | grep -q "<promise>BLOCKED</promise>"; then
        echo -e "${YELLOW}⚠️ Bloqueado - verificar manualmente${NC}"
    fi
    
    # Atualiza contagem
    PENDING=$(cat "$SCRIPT_DIR/prd.json" | jq '[.userStories[] | select(.passes == false)] | length')
    echo -e "Tasks pendentes: ${YELLOW}$PENDING${NC}"
    
    if [ "$PENDING" -eq 0 ]; then
        echo -e "${GREEN}🎉 COMPLETO!${NC}"
        exit 0
    fi
    
    sleep 2
done

echo -e "${YELLOW}Máximo de iterações atingido${NC}"
