# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GabaritAI is an educational platform for automated exam grading using OMR (Optical Mark Recognition). It processes scanned answer sheets, validates quality via ChatGPT Vision, calculates pedagogical scores (TRI/TCT), and generates educational insights. Primary target: ENEM (Brazilian national exam).

## Commands

```bash
# Development
npm run dev          # Start Express server (port 8080) with hot reload
npm run check        # TypeScript validation

# Build & Production
npm run build        # Bundle client + server (esbuild)
npm run start        # Run production server

# Database
npm run db:push      # Apply Drizzle migrations to Supabase

# Python Services (local dev only - production uses Fly.io)
cd python_omr_service && source venv/bin/activate && python app.py  # OMR on port 5002
cd python_tri_service && source venv/bin/activate && python app.py  # TRI on port 5003

# Deployment
flyctl deploy -a xtri-gabaritos-api     # Backend to Fly.io
flyctl deploy -a xtri-gabaritos-omr     # OMR service to Fly.io
flyctl deploy -a xtri-gabaritos-tri     # TRI service to Fly.io
vercel deploy                            # Frontend to Vercel
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Vercel (Frontend)                         │
│                    xtri-gabarito.app                             │
│                    React + Vite + Radix UI                       │
└─────────────────────────┬───────────────────────────────────────┘
                          │ /api/* proxy
┌─────────────────────────▼───────────────────────────────────────┐
│                     Fly.io (Backend)                             │
│                xtri-gabaritos-api.fly.dev                        │
│                Express + TypeScript (port 8080)                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ server/routes.ts - All API endpoints (~50 routes)        │   │
│  │ server/lib/auth.ts - JWT verification via Supabase       │   │
│  │ server/chatgptOMR.ts - OpenAI Vision integration         │   │
│  └──────────────────────────────────────────────────────────┘   │
└───────────┬─────────────────────────────────┬───────────────────┘
            │                                 │
┌───────────▼───────────┐       ┌─────────────▼─────────────┐
│   Fly.io (OMR)        │       │      Fly.io (TRI)         │
│ xtri-gabaritos-omr    │       │   xtri-gabaritos-tri      │
│ Flask + OpenCV        │       │   Flask + NumPy           │
│ Port 5002             │       │   Port 5003               │
└───────────────────────┘       └───────────────────────────┘
            │                                 │
            └─────────────┬───────────────────┘
                          │
              ┌───────────▼───────────┐
              │      Supabase         │
              │ PostgreSQL + Auth     │
              │ RLS by role           │
              └───────────────────────┘
```

## Key Files

| File | Purpose |
|------|---------|
| `server/routes.ts` | All API endpoints - add new routes here |
| `server/lib/auth.ts` | JWT middleware: `requireAuth`, `requireRole` |
| `server/chatgptOMR.ts` | OpenAI Vision for quality validation |
| `client/src/App.tsx` | React router with role-based routes |
| `client/src/contexts/AuthContext.tsx` | Auth state management |
| `shared/schema.ts` | Zod schemas shared between client/server |
| `shared/database.types.ts` | Auto-generated Supabase types |

## Adding an API Endpoint

```typescript
// In server/routes.ts
app.post("/api/my-endpoint", requireAuth, requireRole(["SUPER_ADMIN"]), async (req, res) => {
  try {
    const data = MySchema.parse(req.body);
    // ... logic
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});
```

Roles: `SUPER_ADMIN`, `SCHOOL_ADMIN`, `TEACHER`, `STUDENT`

## Environment Variables (Required)

| Variable | Purpose |
|----------|---------|
| `VITE_SUPABASE_URL` | Frontend Supabase endpoint |
| `VITE_SUPABASE_ANON_KEY` | Public Supabase key |
| `SUPABASE_URL` | Backend Supabase endpoint |
| `SUPABASE_SERVICE_KEY` | Admin Supabase key (service_role) |
| `OPENAI_API_KEY` | ChatGPT Vision & analysis |

## PDF Processing Pipeline

1. **Upload** → Multer handles multipart/form-data
2. **PDF to Images** → Sharp converts pages to PNG
3. **OMR** → Python service detects marked answers
4. **Quality Check** → ChatGPT Vision validates scan quality
5. **Student Lookup** → QR code (`XTRI-XXXXXX`) maps to `students.sheet_code`
6. **Score Calculation** → TRI (Item Response Theory) or TCT
7. **Storage** → Results saved to Supabase

## CORS Configuration

Allowed origins are in `server/index.ts`. Add new domains to `allowedOrigins` array:
- Production: `https://xtri-gabarito.app`
- Vercel previews: `https://*.vercel.app`
- Local: `http://localhost:5173`, `http://localhost:3000`

## Database

- **ORM**: Drizzle with PostgreSQL dialect
- **Migrations**: `supabase/migrations/` (SQL files)
- **RLS**: Row-Level Security policies enforce role-based access
- **Types**: Run `npm run db:generate` after schema changes

## TypeScript Path Aliases

```typescript
import { MySchema } from "@shared/schema";  // → shared/schema.ts
import { supabase } from "@/lib/supabase";  // → client/src/lib/supabase.ts
```

## Testing Locally

1. Start backend: `npm run dev`
2. Access: `http://localhost:8080`
3. For OMR testing, either:
   - Start local Python service, or
   - Set `USE_MODAL=true` to use Modal.com cloud service

## Local Supabase Development

For isolated local development with Docker-based Supabase:

### Setup

```bash
# Initialize Supabase (first time only)
npx supabase init

# Start local Supabase (requires Docker running)
npx supabase start

# Stop local Supabase
npx supabase stop
```

### Local URLs

| Service | URL |
|---------|-----|
| API Gateway | http://127.0.0.1:54321 |
| Studio (Dashboard) | http://127.0.0.1:54323 |
| Mailpit (Emails) | http://127.0.0.1:54324 |
| PostgreSQL | postgresql://postgres:postgres@127.0.0.1:54322/postgres |

### Configuration

Use `.env.local` for local Supabase development (copy to `.env` when developing locally):

```bash
# Frontend
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<from npx supabase start output>

# Backend
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_KEY=<from npx supabase start output>
```

### Database Commands

```bash
# Apply migrations to local Supabase
npx supabase db push

# Pull schema from remote to local
npx supabase db pull

# Generate TypeScript types from local schema
npx supabase gen types typescript --local > shared/database.types.ts

# Reset local database (destructive)
npx supabase db reset
```

### Workflow

1. Start Docker Desktop
2. Run `npx supabase start` (note the keys from output)
3. Copy `.env.local` to `.env` or update values
4. Run `npm run dev`
5. Access Studio at http://127.0.0.1:54323 to manage data

## Student Authentication Flow

### Default Password

New students are created with default password `SENHA123` and `must_change_password = true` in their profile.

### First Login Flow

1. Student logs in with matrícula + `SENHA123`
2. System checks `must_change_password` flag in profile
3. If `true`, modal forces password change before accessing dashboard
4. After changing, `must_change_password` is set to `false`

### Password Change Endpoints

- **Forced change (first login)**: `POST /api/profile/change-password` with `isForced: true`
- **Voluntary change (profile menu)**: `POST /api/profile/change-password` with `isForced: false`

Both use `supabaseAdmin.auth.admin.updateUserById()` to bypass session requirements.

### Activating Students

Students imported via Excel have profiles but no auth users. Use "Ativar Todos" button in school admin panel to create auth accounts with default password.

## Painel da Escola (Modelo Padrão)

O **Painel da Escola do Marista RN** (coordenadora Luciana) é o modelo de referência para todas as escolas. Qualquer desenvolvimento de novas funcionalidades deve usar este painel como base.

### Estrutura Padrão (5 abas)

| Aba | Funcionalidade |
|-----|----------------|
| Visão Geral | Dashboard com stats, rankings de turma, TRI por área, top/alunos em atenção |
| Resultados | Tabela filtrável de resultados (série, turma, busca) com paginação |
| Turmas | Cards por turma com métricas TRI e exportação Excel |
| Estatísticas TRI | Dispersão, análise por questão (180q), conteúdos com mais erros |
| Listas | Rastreamento de downloads de listas de exercícios |

### Cores por Área (XTRI Brand)

- **LC** (Linguagens): Cyan `#33B5E5`
- **CH** (Humanas): Orange `#F26A4B`
- **CN** (Natureza): Green `#10b981`
- **MT** (Matemática): Indigo `#6366f1`

### Limiares TRI

- Acima da média: TRI ≥ 600
- Na média: TRI 500-599
- Abaixo da média: TRI < 500

### Arquivos Principais

- `client/src/pages/escola.tsx` - Componente do painel (~2500 linhas)
- `server/routes.ts` - Endpoints `/api/escola/*` e `/api/coordinator/*`
