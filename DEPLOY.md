# GabaritAI - Guia de Deploy

Guia completo para deploy do GabaritAI em produção.

## Arquitetura

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│    Frontend     │     │    Backend      │     │    Database     │
│    (Vercel)     │────▶│   (Fly.io)      │────▶│   (Supabase)    │
│  React + Vite   │     │  Express.js     │     │   PostgreSQL    │
└─────────────────┘     └────────┬────────┘     └─────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    ▼                         ▼
          ┌─────────────────┐       ┌─────────────────┐
          │   OMR Service   │       │   TRI Service   │
          │   (Fly.io)      │       │   (Fly.io)      │
          │  Python/OpenCV  │       │  Python/Pandas  │
          └─────────────────┘       └─────────────────┘
```

## 1. Pré-requisitos

### Contas Necessárias

| Serviço | URL | Uso |
|---------|-----|-----|
| Fly.io | https://fly.io | Backend + Python services |
| Vercel | https://vercel.com | Frontend |
| Supabase | https://supabase.com | Banco de dados |
| OpenAI | https://platform.openai.com | API de IA (opcional) |

### CLIs Necessárias

```bash
# Fly.io CLI
curl -L https://fly.io/install.sh | sh
# ou: brew install flyctl

# Vercel CLI
npm install -g vercel

# Verificar instalação
fly version
vercel --version
```

### Login nas CLIs

```bash
fly auth login
vercel login
```

## 2. Configurar Supabase

### 2.1 Criar Projeto

1. Acesse https://supabase.com/dashboard
2. Clique em "New Project"
3. Escolha região `South America (São Paulo)` para menor latência
4. Anote a senha do banco

### 2.2 Obter Credenciais

Em **Project Settings > API**:

| Variável | Onde encontrar |
|----------|----------------|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_ANON_KEY` | anon/public key |
| `SUPABASE_SERVICE_KEY` | service_role key (⚠️ nunca expor!) |

### 2.3 Criar Tabelas

Execute o SQL em **SQL Editor**:

```sql
-- Tabela de escolas
CREATE TABLE IF NOT EXISTS schools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela de perfis de usuário
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  school_id UUID REFERENCES schools(id),
  role TEXT CHECK (role IN ('admin', 'teacher', 'student')),
  name TEXT,
  email TEXT,
  student_number TEXT,
  turma TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela de exames
CREATE TABLE IF NOT EXISTS exams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES schools(id),
  titulo TEXT NOT NULL,
  template_type TEXT DEFAULT 'ENEM',
  total_questoes INTEGER DEFAULT 90,
  gabarito JSONB,
  question_contents JSONB,
  status TEXT DEFAULT 'active',
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela de respostas dos alunos
CREATE TABLE IF NOT EXISTS student_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id UUID REFERENCES exams(id) ON DELETE CASCADE,
  school_id UUID REFERENCES schools(id),
  student_id UUID REFERENCES profiles(id),
  student_number TEXT,
  student_name TEXT NOT NULL,
  turma TEXT,
  answers JSONB NOT NULL,
  score NUMERIC,
  correct_answers INTEGER,
  wrong_answers INTEGER,
  blank_answers INTEGER,
  tri_theta NUMERIC,
  tri_score NUMERIC,
  tri_lc NUMERIC,
  tri_ch NUMERIC,
  tri_cn NUMERIC,
  tri_mt NUMERIC,
  confidence NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX idx_student_answers_exam ON student_answers(exam_id);
CREATE INDEX idx_student_answers_school ON student_answers(school_id);
CREATE INDEX idx_exams_school ON exams(school_id);
CREATE INDEX idx_profiles_school ON profiles(school_id);

-- Row Level Security
ALTER TABLE schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_answers ENABLE ROW LEVEL SECURITY;
```

## 3. Deploy Python Services (Fly.io)

Os serviços Python devem ser deployados primeiro, pois o backend depende deles.

### 3.1 Deploy OMR Service

```bash
cd python_omr_service

# Criar app (apenas primeira vez)
fly apps create xtri-gabaritos-omr

# Deploy
fly deploy

# Verificar
fly status
curl https://xtri-gabaritos-omr.fly.dev/health
```

### 3.2 Deploy TRI Service

```bash
cd python_tri_service

# Criar app (apenas primeira vez)
fly apps create xtri-gabaritos-tri

# Deploy
fly deploy

# Verificar
fly status
curl https://xtri-gabaritos-tri.fly.dev/health
```

## 4. Deploy Backend (Fly.io)

### 4.1 Criar App

```bash
# Na raiz do projeto
fly apps create xtri-gabaritos-api
```

### 4.2 Configurar Secrets

```bash
fly secrets set \
  SUPABASE_URL="https://xxx.supabase.co" \
  SUPABASE_SERVICE_KEY="eyJhbGc..." \
  OPENAI_API_KEY="sk-proj-..." \
  PYTHON_OMR_URL="https://xtri-gabaritos-omr.fly.dev" \
  PYTHON_TRI_URL="https://xtri-gabaritos-tri.fly.dev" \
  USE_PYTHON_OMR="true" \
  USE_PYTHON_TRI="true" \
  FRONTEND_URL="https://seu-app.vercel.app"
```

### 4.3 Deploy

```bash
fly deploy

# Verificar
fly status
fly logs
curl https://xtri-gabaritos-api.fly.dev/api/health
```

## 5. Deploy Frontend (Vercel)

### 5.1 Conectar Repositório

1. Acesse https://vercel.com/new
2. Importe o repositório do GitHub
3. Configure:
   - **Framework Preset**: Vite
   - **Build Command**: `npx vite build`
   - **Output Directory**: `dist/public`

### 5.2 Configurar Variáveis de Ambiente

Em **Settings > Environment Variables**:

| Variável | Valor |
|----------|-------|
| `VITE_SUPABASE_URL` | `https://xxx.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | `eyJhbGc...` (anon key) |
| `VITE_API_URL` | `https://xtri-gabaritos-api.fly.dev` |

### 5.3 Deploy

```bash
vercel --prod
```

Ou configure deploy automático no push para `main`.

## 6. Verificar Health Checks

### Script Automático

```bash
./scripts/deploy.sh status
```

### Manual

```bash
# Backend
curl https://xtri-gabaritos-api.fly.dev/api/health

# OMR
curl https://xtri-gabaritos-omr.fly.dev/health

# TRI
curl https://xtri-gabaritos-tri.fly.dev/health

# Frontend (deve retornar HTML)
curl -I https://seu-app.vercel.app
```

## 7. Troubleshooting

### Problema: "App not found" no Fly.io

```bash
# Verificar se está logado
fly auth whoami

# Listar apps
fly apps list

# Recriar app
fly apps create nome-do-app
```

### Problema: CORS errors no frontend

1. Verifique se `FRONTEND_URL` está correto nos secrets do backend
2. Adicione o domínio Vercel em `server/index.ts`:
```typescript
const allowedOrigins = [
  // ... adicione seu domínio
  "https://seu-app.vercel.app",
];
```

### Problema: Serviço Python não responde

```bash
# Ver logs
fly logs -a xtri-gabaritos-omr

# Reiniciar
fly apps restart xtri-gabaritos-omr

# Verificar memória (OMR precisa de 1GB)
fly scale memory 1024 -a xtri-gabaritos-omr
```

### Problema: Build falha no Vercel

1. Verifique se `vercel.json` está correto
2. Teste build local: `npx vite build`
3. Verifique variáveis de ambiente no dashboard

### Problema: Supabase connection refused

1. Verifique se as credenciais estão corretas
2. Em Supabase > Settings > Database, verifique se "Direct connections" está habilitado
3. Verifique se o IP do Fly.io não está bloqueado

## 8. Custos Estimados

### Fly.io (Backend + Python)

| Serviço | Specs | Custo/mês |
|---------|-------|-----------|
| Backend | 512MB, shared CPU | ~$5 |
| OMR | 1GB, shared CPU | ~$7 |
| TRI | 512MB, shared CPU | ~$5 |
| **Total** | | **~$17** |

*Com auto-stop habilitado, custos podem ser menores com baixo tráfego.*

### Vercel (Frontend)

| Plano | Custo/mês |
|-------|-----------|
| Hobby | Grátis |
| Pro | $20/mês |

*Hobby é suficiente para projetos pessoais/pequenos.*

### Supabase (Database)

| Plano | Custo/mês |
|-------|-----------|
| Free | Grátis (500MB, pausado após 1 semana inativo) |
| Pro | $25/mês (8GB, sem pausa) |

### OpenAI (IA)

| Uso | Custo estimado |
|-----|----------------|
| 1000 correções/mês | ~$5-10 |

*Depende do modelo usado (gpt-4o-mini é mais barato).*

### Total Estimado

| Cenário | Custo/mês |
|---------|-----------|
| Mínimo (hobby) | ~$17 (só Fly.io) |
| Produção básica | ~$42 (Fly + Supabase Pro) |
| Produção completa | ~$70 (tudo Pro + OpenAI) |

## 9. Comandos Úteis

```bash
# Deploy completo
./scripts/deploy.sh all

# Deploy individual
./scripts/deploy.sh frontend
./scripts/deploy.sh backend
./scripts/deploy.sh omr
./scripts/deploy.sh tri

# Ver status
./scripts/deploy.sh status

# Logs em tempo real
fly logs -a xtri-gabaritos-api
fly logs -a xtri-gabaritos-omr
fly logs -a xtri-gabaritos-tri

# Escalar recursos
fly scale memory 1024 -a xtri-gabaritos-api
fly scale count 2 -a xtri-gabaritos-api

# SSH no container
fly ssh console -a xtri-gabaritos-api
```

## 10. Checklist de Deploy

- [ ] Supabase projeto criado e tabelas criadas
- [ ] OMR service deployado e respondendo `/health`
- [ ] TRI service deployado e respondendo `/health`
- [ ] Backend deployado com secrets configurados
- [ ] Frontend deployado com variáveis de ambiente
- [ ] CORS configurado para domínio de produção
- [ ] Teste de login funciona
- [ ] Teste de upload de PDF funciona
- [ ] Teste de publicação para alunos funciona
