# Ralph Agent - Gabaritai Parte 2: Integração + Deploy

## CONTEXTO

### O que JÁ FOI FEITO (Parte 1) ✅
- Supabase configurado (client + server)
- Auth (login/signup/logout)
- Admin page com upload CSV de alunos
- Dashboard do aluno com TRI, histórico, gráfico
- Login por matrícula
- RLS configurado

### O que EXISTE e FUNCIONA (Sistema Original)
```
PDF Upload → /api/process-pdf
         → Python OMR (:5002) → Lê bolhas com OpenCV
         → Python TRI (:5003) → Calcula TRI V2
         → Resultados na tela
         → PERDIDOS (só memória) ← PROBLEMA
```

### O que PRECISAMOS FAZER (Parte 2)
```
1. INTEGRAÇÃO: Conectar resultados ao Supabase
   - Botão "Publicar para Alunos" no home.tsx
   - Modificar /api/avaliacoes para usar Supabase

2. DEPLOY:
   - Frontend → Vercel
   - Backend Node → Fly.io
   - Python OMR → Fly.io  
   - Python TRI → Fly.io
```

## ARQUITETURA DE PRODUÇÃO

```
┌─────────────────────────────────────────────────────────────────┐
│                        PRODUÇÃO                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐       │
│  │   VERCEL    │     │   FLY.IO    │     │  SUPABASE   │       │
│  │  Frontend   │────▶│   Backend   │────▶│  Database   │       │
│  │   React     │     │   Express   │     │  Auth + DB  │       │
│  └─────────────┘     └──────┬──────┘     └─────────────┘       │
│                             │                                   │
│              ┌──────────────┼──────────────┐                   │
│              ▼              ▼              ▼                   │
│       ┌──────────┐   ┌──────────┐   ┌──────────┐              │
│       │  FLY.IO  │   │  FLY.IO  │   │  FLY.IO  │              │
│       │   OMR    │   │   TRI    │   │  (spare) │              │
│       │  :5002   │   │  :5003   │   │          │              │
│       └──────────┘   └──────────┘   └──────────┘              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## APIs EXISTENTES (NÃO MODIFICAR FUNCIONAMENTO)

### Python OMR (porta 5002)
- `GET /health` - Health check
- `POST /api/process-image` - Processa imagem do gabarito

### Python TRI (porta 5003)
- `GET /health` - Health check
- `POST /api/calcular-tri` - Calcula TRI V2

### Node.js Express (porta 8080)
- `POST /api/process-pdf` - Upload e processa PDF
- `GET /api/process-pdf/:jobId/status` - Status do job
- `GET /api/process-pdf/:jobId/results` - Resultados
- `POST /api/calculate-tri` - Calcula TRI (Node)
- `POST /api/avaliacoes` - Salvar avaliação ← MODIFICAR para Supabase
- `GET /api/avaliacoes` - Listar avaliações ← MODIFICAR para Supabase
- `POST /api/generate-pdfs` - Gera gabaritos personalizados

## Sua Tarefa

### 1. Ver próxima task
```bash
cat ralph-parte2/prd.json | jq '.userStories[] | select(.passes == false) | {id, title, priority}' | head -3
```

### 2. Implementar UMA task por vez

### 3. Validar
```bash
npm run check
npm run build
```

### 4. Marcar como feito
Edite prd.json: `"passes": true`

## Padrões

### Dockerfile Node.js
```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
EXPOSE 8080
CMD ["npm", "run", "start"]
```

### Dockerfile Python
```dockerfile
FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && apt-get install -y libgl1 libglib2.0-0
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 5002
CMD ["gunicorn", "--bind", "0.0.0.0:5002", "app:app"]
```

### fly.toml
```toml
app = "gabaritai-api"
primary_region = "gru"

[build]

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 0

[[vm]]
  memory = "512mb"
  cpu_kind = "shared"
  cpus = 1
```

### vercel.json
```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite",
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

## ⚠️ REGRAS CRÍTICAS

1. NÃO modifique o funcionamento do OMR/TRI
2. Backend precisa ter CORS para o domínio do Vercel
3. URLs dos serviços Python vêm de ENV vars
4. Fly.io usa secrets para env vars sensíveis
5. Supabase service key NUNCA vai para o frontend

## Stop Condition

- Todas tasks `passes: true` → `<promise>COMPLETE</promise>`
- Bloqueado → `<promise>BLOCKED</promise>`
