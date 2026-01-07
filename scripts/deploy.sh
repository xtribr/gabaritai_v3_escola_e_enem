#!/bin/bash
# =============================================================================
# GabaritAI - Script de Deploy
# =============================================================================
# Uso: ./scripts/deploy.sh [comando]
#
# Comandos:
#   all       - Deploy de todos os serviços
#   frontend  - Deploy do frontend (Vercel)
#   backend   - Deploy do backend Express (Fly.io)
#   omr       - Deploy do serviço OMR (Fly.io)
#   tri       - Deploy do serviço TRI (Fly.io)
#   python    - Deploy dos serviços Python (OMR + TRI)
#   status    - Verificar status dos serviços
# =============================================================================

set -e

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Diretório raiz do projeto
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# -----------------------------------------------------------------------------
# Funções auxiliares
# -----------------------------------------------------------------------------

print_header() {
    echo ""
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  $1${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    echo ""
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_info() {
    echo -e "${BLUE}→ $1${NC}"
}

# -----------------------------------------------------------------------------
# Verificações de dependências
# -----------------------------------------------------------------------------

check_fly() {
    if ! command -v fly &> /dev/null; then
        print_error "Fly CLI não encontrado!"
        echo "  Instale com: curl -L https://fly.io/install.sh | sh"
        echo "  Ou: brew install flyctl"
        exit 1
    fi
    print_success "Fly CLI encontrado: $(fly version)"
}

check_vercel() {
    if ! command -v vercel &> /dev/null; then
        print_error "Vercel CLI não encontrado!"
        echo "  Instale com: npm install -g vercel"
        exit 1
    fi
    print_success "Vercel CLI encontrado: $(vercel --version)"
}

check_all_deps() {
    print_header "Verificando dependências"
    check_fly
    check_vercel
}

# -----------------------------------------------------------------------------
# Funções de deploy
# -----------------------------------------------------------------------------

deploy_frontend() {
    print_header "Deploy Frontend (Vercel)"
    cd "$ROOT_DIR"

    print_info "Executando: vercel --prod"
    vercel --prod

    print_success "Frontend deployado com sucesso!"
}

deploy_backend() {
    print_header "Deploy Backend Express (Fly.io)"
    cd "$ROOT_DIR"

    print_info "Executando: fly deploy"
    fly deploy

    print_success "Backend deployado com sucesso!"
    echo ""
    print_info "URL: https://xtri-gabaritos-api.fly.dev"
}

deploy_omr() {
    print_header "Deploy OMR Service (Fly.io)"
    cd "$ROOT_DIR/python_omr_service"

    print_info "Executando: fly deploy"
    fly deploy

    print_success "OMR Service deployado com sucesso!"
    echo ""
    print_info "URL: https://xtri-gabaritos-omr.fly.dev"
}

deploy_tri() {
    print_header "Deploy TRI Service (Fly.io)"
    cd "$ROOT_DIR/python_tri_service"

    print_info "Executando: fly deploy"
    fly deploy

    print_success "TRI Service deployado com sucesso!"
    echo ""
    print_info "URL: https://xtri-gabaritos-tri.fly.dev"
}

deploy_python() {
    deploy_omr
    deploy_tri
}

deploy_all() {
    print_header "Deploy Completo - Todos os Serviços"

    check_all_deps

    deploy_omr
    deploy_tri
    deploy_backend
    deploy_frontend

    print_header "Deploy Completo Finalizado!"
    echo ""
    echo -e "${GREEN}Serviços deployados:${NC}"
    echo "  • Frontend:  https://gabaritai.vercel.app (ou seu domínio)"
    echo "  • Backend:   https://xtri-gabaritos-api.fly.dev"
    echo "  • OMR:       https://xtri-gabaritos-omr.fly.dev"
    echo "  • TRI:       https://xtri-gabaritos-tri.fly.dev"
    echo ""
}

show_status() {
    print_header "Status dos Serviços"

    echo -e "${BLUE}Backend (Fly.io):${NC}"
    fly status -a xtri-gabaritos-api 2>/dev/null || print_warning "App não encontrado ou não deployado"
    echo ""

    echo -e "${BLUE}OMR Service (Fly.io):${NC}"
    fly status -a xtri-gabaritos-omr 2>/dev/null || print_warning "App não encontrado ou não deployado"
    echo ""

    echo -e "${BLUE}TRI Service (Fly.io):${NC}"
    fly status -a xtri-gabaritos-tri 2>/dev/null || print_warning "App não encontrado ou não deployado"
    echo ""

    print_header "Health Checks"

    print_info "Verificando Backend..."
    curl -s -o /dev/null -w "%{http_code}" https://xtri-gabaritos-api.fly.dev/api/health 2>/dev/null && print_success "Backend OK" || print_warning "Backend não respondendo"

    print_info "Verificando OMR..."
    curl -s -o /dev/null -w "%{http_code}" https://xtri-gabaritos-omr.fly.dev/health 2>/dev/null && print_success "OMR OK" || print_warning "OMR não respondendo"

    print_info "Verificando TRI..."
    curl -s -o /dev/null -w "%{http_code}" https://xtri-gabaritos-tri.fly.dev/health 2>/dev/null && print_success "TRI OK" || print_warning "TRI não respondendo"
}

show_help() {
    echo "GabaritAI - Script de Deploy"
    echo ""
    echo "Uso: ./scripts/deploy.sh [comando]"
    echo ""
    echo "Comandos disponíveis:"
    echo "  all       Deploy de todos os serviços"
    echo "  frontend  Deploy do frontend (Vercel)"
    echo "  backend   Deploy do backend Express (Fly.io)"
    echo "  omr       Deploy do serviço OMR (Fly.io)"
    echo "  tri       Deploy do serviço TRI (Fly.io)"
    echo "  python    Deploy dos serviços Python (OMR + TRI)"
    echo "  status    Verificar status dos serviços"
    echo "  help      Mostrar esta ajuda"
    echo ""
    echo "Exemplos:"
    echo "  ./scripts/deploy.sh all        # Deploy completo"
    echo "  ./scripts/deploy.sh backend    # Apenas backend"
    echo "  ./scripts/deploy.sh status     # Ver status"
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------

case "${1:-help}" in
    all)
        deploy_all
        ;;
    frontend)
        check_vercel
        deploy_frontend
        ;;
    backend)
        check_fly
        deploy_backend
        ;;
    omr)
        check_fly
        deploy_omr
        ;;
    tri)
        check_fly
        deploy_tri
        ;;
    python)
        check_fly
        deploy_python
        ;;
    status)
        check_fly
        show_status
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        print_error "Comando desconhecido: $1"
        echo ""
        show_help
        exit 1
        ;;
esac
