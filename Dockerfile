# =============================================================================
# GabaritAI Backend - Dockerfile
# =============================================================================
# Multi-stage build para Express.js + TypeScript
# Deploy target: Fly.io
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Builder - Compila TypeScript e bundle
# -----------------------------------------------------------------------------
FROM node:20-slim AS builder

# Instalar dependências de build para pacotes nativos (canvas, sharp, etc.)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    pkg-config \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    libpixman-1-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar arquivos de dependências primeiro (melhor cache)
COPY package.json package-lock.json ./

# Instalar todas as dependências (incluindo devDependencies para build)
RUN npm install --legacy-peer-deps

# Copiar código fonte necessário para build
COPY server/ ./server/
COPY shared/ ./shared/
COPY script/ ./script/
COPY tsconfig.json ./
COPY vite.config.ts ./

# Build do servidor apenas (sem client - deploy separado no Vercel)
RUN npx tsx script/build-server.ts

# -----------------------------------------------------------------------------
# Stage 2: Runner - Imagem mínima para produção
# -----------------------------------------------------------------------------
FROM node:20-slim AS runner

# Instalar dependências runtime para canvas/sharp e poppler para PDF->PNG
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    pkg-config \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    libpixman-1-dev \
    wget \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Criar usuário não-root para segurança
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs expressjs

# Copiar package.json para instalar apenas deps de produção
COPY package.json package-lock.json ./

# Instalar apenas dependências de produção
RUN npm install --omit=dev --legacy-peer-deps && \
    npm cache clean --force

# Copiar o bundle compilado do builder
COPY --from=builder /app/dist ./dist

# Copiar dados TRI necessários para cálculo de notas ENEM
COPY tri/ ./tri/

# Copiar assets (logos, imagens) e ajustar permissões
COPY server/assets/ ./assets/
RUN chmod -R 644 ./assets/* && chown -R expressjs:nodejs ./assets

# Criar diretório data para templates (PDF gerado dinamicamente)
RUN mkdir -p ./data && chown -R expressjs:nodejs ./data

# Definir usuário não-root
USER expressjs

# Variáveis de ambiente
ENV NODE_ENV=production
ENV PORT=8080

# Expor porta
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/api/health || exit 1

# Comando de inicialização
CMD ["node", "dist/index.cjs"]
