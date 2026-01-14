#!/bin/bash
# =============================================================================
# XTRI Ralph - Loop Autônomo para Claude Code
# =============================================================================
# Baseado no padrão Ralph de Geoffrey Huntley
# Adaptado para projetos XTRI/EdTech
#
# Uso: ./ralph.sh [max_iterations]
# =============================================================================

set -e

# Configuração
MAX_ITERATIONS=${1:-10}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRD_FILE="$SCRIPT_DIR/prd.json"
PROGRESS_FILE="$SCRIPT_DIR/progress.txt"
PROMPT_FILE="$SCRIPT_DIR/prompt.md"

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Banner
echo -e "${BLUE}"
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                    XTRI Ralph Agent Loop                      ║"
echo "║               Autonomous Claude Code Runner                   ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Verificar dependências
check_dependencies() {
    if ! command -v claude &> /dev/null; then
        echo -e "${RED}Erro: Claude Code CLI não encontrado${NC}"
        echo "Instale com: npm install -g @anthropic/claude-code"
        exit 1
    fi
    
    if ! command -v jq &> /dev/null; then
        echo -e "${RED}Erro: jq não encontrado${NC}"
        echo "Instale com: brew install jq (macOS) ou apt install jq (Linux)"
        exit 1
    fi
}

# Verificar arquivos necessários
check_files() {
    if [ ! -f "$PRD_FILE" ]; then
        echo -e "${RED}Erro: prd.json não encontrado em $SCRIPT_DIR${NC}"
        echo "Crie um PRD primeiro ou copie o prd.json.example"
        exit 1
    fi
    
    if [ ! -f "$PROMPT_FILE" ]; then
        echo -e "${RED}Erro: prompt.md não encontrado em $SCRIPT_DIR${NC}"
        exit 1
    fi
}

# Contar stories completas
count_stories() {
    local total=$(jq '.userStories | length' "$PRD_FILE")
    local complete=$(jq '[.userStories[] | select(.passes == true)] | length' "$PRD_FILE")
    echo "$complete/$total"
}

# Verificar se todas as stories estão completas
all_complete() {
    local incomplete=$(jq '[.userStories[] | select(.passes != true)] | length' "$PRD_FILE")
    [ "$incomplete" -eq 0 ]
}

# Executar uma iteração
run_iteration() {
    local iteration=$1
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    
    echo -e "\n${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}Iteração $iteration de $MAX_ITERATIONS${NC}"
    echo -e "${YELLOW}Stories: $(count_stories) completas${NC}"
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
    
    # Log no progress.txt
    echo "" >> "$PROGRESS_FILE"
    echo "=== Iteração $iteration - $timestamp ===" >> "$PROGRESS_FILE"
    
    # Executar Claude Code com o prompt
    # O prompt.md instrui o Claude a ler prd.json e trabalhar nas stories
    if claude --print "$PROMPT_FILE" 2>&1 | tee -a "$PROGRESS_FILE"; then
        echo -e "\n${GREEN}✓ Iteração $iteration concluída${NC}"
    else
        echo -e "\n${RED}✗ Erro na iteração $iteration${NC}"
    fi
    
    # Pequena pausa entre iterações
    sleep 2
}

# Main loop
main() {
    check_dependencies
    check_files
    
    echo -e "${BLUE}PRD:${NC} $PRD_FILE"
    echo -e "${BLUE}Prompt:${NC} $PROMPT_FILE"
    echo -e "${BLUE}Progress:${NC} $PROGRESS_FILE"
    echo -e "${BLUE}Max iterações:${NC} $MAX_ITERATIONS"
    echo ""
    
    # Inicializar progress.txt se não existir
    if [ ! -f "$PROGRESS_FILE" ]; then
        echo "# XTRI Ralph Progress Log" > "$PROGRESS_FILE"
        echo "Iniciado em: $(date)" >> "$PROGRESS_FILE"
        echo "" >> "$PROGRESS_FILE"
        echo "## Codebase Patterns" >> "$PROGRESS_FILE"
        echo "<!-- Adicione padrões aprendidos aqui -->" >> "$PROGRESS_FILE"
    fi
    
    # Loop principal
    for ((i=1; i<=MAX_ITERATIONS; i++)); do
        # Verificar se já completou tudo
        if all_complete; then
            echo -e "\n${GREEN}╔═══════════════════════════════════════════════════════════════╗${NC}"
            echo -e "${GREEN}║                    🎉 TODAS AS STORIES COMPLETAS!              ║${NC}"
            echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════╝${NC}"
            echo ""
            echo -e "Stories completas: $(count_stories)"
            echo "<promise>COMPLETE</promise>"
            exit 0
        fi
        
        run_iteration $i
    done
    
    # Atingiu max iterações sem completar
    echo -e "\n${YELLOW}⚠ Atingiu máximo de $MAX_ITERATIONS iterações${NC}"
    echo -e "Stories completas: $(count_stories)"
    echo ""
    echo "Para continuar, rode novamente: ./ralph.sh"
}

# Executar
main
