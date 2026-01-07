# =============================================================================
# GabaritAI TRI Service - Dockerfile
# =============================================================================
# Serviço de cálculo TRI (Teoria de Resposta ao Item)
# Deploy target: Fly.io (xtri-gabaritos-tri)
# =============================================================================

FROM python:3.11-slim

WORKDIR /app

# Copiar requirements e instalar dependências Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar código da aplicação e dados de referência
COPY app.py .
COPY tri_v2_producao.py .
COPY tri_tabela_referencia_oficial.json .
COPY tri_tabela_referencia_oficial.csv .

# Criar usuário não-root
RUN useradd --create-home --shell /bin/bash appuser && \
    chown -R appuser:appuser /app
USER appuser

# Variáveis de ambiente
ENV PYTHONUNBUFFERED=1
ENV PORT=5003

# Expor porta
EXPOSE 5003

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:5003/health')" || exit 1

# Comando de inicialização com gunicorn
CMD ["gunicorn", "--bind", "0.0.0.0:5003", "--workers", "2", "--timeout", "60", "app:app"]
