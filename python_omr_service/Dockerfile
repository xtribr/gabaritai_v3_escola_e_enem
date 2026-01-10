# =============================================================================
# GabaritAI OMR Service - Dockerfile
# =============================================================================
# Serviço de leitura de gabaritos com OpenCV
# Deploy target: Fly.io (xtri-gabaritos-omr)
# =============================================================================

FROM python:3.11-slim

WORKDIR /app

# Instalar dependências do sistema para OpenCV e pdf2image
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender1 \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Copiar requirements e instalar dependências Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar código da aplicação
COPY app.py .
COPY template_calibration.json .

# Criar usuário não-root
RUN useradd --create-home --shell /bin/bash appuser && \
    chown -R appuser:appuser /app
USER appuser

# Variáveis de ambiente
ENV PYTHONUNBUFFERED=1
ENV PORT=5002

# Expor porta
EXPOSE 5002

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:5002/health')" || exit 1

# Comando de inicialização com gunicorn
CMD ["gunicorn", "--bind", "0.0.0.0:5002", "--workers", "8", "--threads", "2", "--timeout", "120", "app:app"]
