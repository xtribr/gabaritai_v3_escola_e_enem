# Segmented Coordinator Roles Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implementar coordenadores segmentados por série - um para 3ª série e outro para 1ª/2ª séries - com filtro automático de dados baseado no perfil.

**Architecture:** Adicionar campo `allowed_series` no perfil do coordenador (array de strings como `["1ª Série", "2ª Série"]` ou `["3ª Série"]`). O backend filtra automaticamente os dados por série. O frontend usa o mesmo dashboard `/escola`, mas só mostra dados permitidos. Alunos continuam vendo apenas seus próprios resultados.

**Tech Stack:** Supabase (PostgreSQL), Express.js, React, TypeScript

---

## Resumo das Mudanças

| Componente | Mudança |
|------------|---------|
| **Database** | Adicionar coluna `allowed_series text[]` na tabela `profiles` |
| **Backend** | Filtrar queries por série baseado no `allowed_series` do perfil |
| **Frontend** | Mostrar apenas séries permitidas nos filtros e dados |
| **Login** | Redirecionar para `/escola` (coordenadores) ou `/dashboard` (alunos) |

---

### Task 1: Adicionar coluna `allowed_series` no banco de dados

**Files:**
- Create: `supabase/migrations/20250113_add_allowed_series.sql`

**Step 1: Criar migration SQL**

```sql
-- Migration: Add allowed_series column to profiles table
-- This enables segmented coordinator access (e.g., only 3rd grade or only 1st/2nd grade)

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS allowed_series text[] DEFAULT NULL;

-- NULL means unrestricted access (super_admin or legacy school_admin)
-- Example values:
--   ['3ª Série'] - Coordinator for 3rd grade only
--   ['1ª Série', '2ª Série'] - Coordinator for 1st and 2nd grade
--   NULL - Full access (super_admin or school-wide coordinator)

COMMENT ON COLUMN profiles.allowed_series IS 'Array of series/grades this coordinator can access. NULL = unrestricted.';
```

**Step 2: Aplicar migration via Supabase Dashboard**

1. Acessar Supabase Dashboard → SQL Editor
2. Colar e executar o SQL acima
3. Verificar: `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'allowed_series';`

**Step 3: Commit**

```bash
git add supabase/migrations/20250113_add_allowed_series.sql
git commit -m "chore(db): add allowed_series column for segmented coordinator access"
```

---

### Task 2: Atualizar tipos TypeScript

**Files:**
- Modify: `shared/database.types.ts:13-23`

**Step 1: Adicionar campo ao tipo Profile**

Localizar a interface `Profile` e adicionar `allowed_series`:

```typescript
export interface Profile {
  id: string;
  school_id: string | null;
  role: UserRole;
  name: string;
  email: string;
  student_number: string | null;
  turma: string | null;
  must_change_password: boolean;
  created_at: string;
  allowed_series: string[] | null;  // NEW: Series this coordinator can access
}
```

**Step 2: Commit**

```bash
git add shared/database.types.ts
git commit -m "feat(types): add allowed_series to Profile interface"
```

---

### Task 3: Atualizar middleware de autenticação para incluir `allowed_series`

**Files:**
- Modify: `server/lib/auth.ts:88-91`

**Step 1: Atualizar query do perfil no `requireRole`**

Localizar a query do Supabase (linha ~88) e adicionar `allowed_series`:

```typescript
const { data: profile, error: profileError } = await supabaseAdmin
  .from('profiles')
  .select('id, role, school_id, name, allowed_series')
  .eq('id', userId)
  .single();
```

**Step 2: Atualizar interface AuthenticatedRequest**

Adicionar `allowed_series` ao tipo do profile na request:

```typescript
export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
  };
  profile?: {
    id: string;
    role: string;
    school_id: string | null;
    name: string;
    allowed_series: string[] | null;
  };
}
```

**Step 3: Commit**

```bash
git add server/lib/auth.ts
git commit -m "feat(auth): include allowed_series in profile middleware"
```

---

### Task 4: Criar helper para filtrar por série

**Files:**
- Create: `server/lib/seriesFilter.ts`

**Step 1: Criar arquivo com funções auxiliares**

```typescript
/**
 * Helper functions for series-based data filtering
 */

/**
 * Extracts the série (grade level) from a turma name
 * Examples:
 *   "3ª Série A" → "3ª Série"
 *   "1º Ano B" → "1º Ano"
 *   "2ª série - Manhã" → "2ª série"
 */
export function extractSerie(turma: string | null): string | null {
  if (!turma || turma === 'null' || turma.trim() === '') return null;

  // Match patterns like "3ª Série", "1º Ano", "2ª série"
  const match = turma.match(/^(\d+[ªº]?\s*[Ss]érie|\d+[ªº]?\s*[Aa]no)/i);
  return match ? match[1] : null;
}

/**
 * Normalizes série for comparison (case-insensitive, accent-insensitive)
 * "3ª Série" → "3 serie"
 * "3ª série" → "3 serie"
 */
export function normalizeSerie(serie: string): string {
  return serie
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[ªº]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Checks if a turma matches any of the allowed series
 */
export function isTurmaAllowed(turma: string | null, allowedSeries: string[] | null): boolean {
  // If no restrictions, allow all
  if (!allowedSeries || allowedSeries.length === 0) return true;

  const serie = extractSerie(turma);
  if (!serie) return false;

  const normalizedSerie = normalizeSerie(serie);

  return allowedSeries.some(allowed => {
    const normalizedAllowed = normalizeSerie(allowed);
    return normalizedSerie.includes(normalizedAllowed) || normalizedAllowed.includes(normalizedSerie);
  });
}

/**
 * Builds a SQL-like filter condition for turmas based on allowed series
 * Returns array of patterns to match against turma column
 */
export function buildSeriesPatterns(allowedSeries: string[] | null): string[] {
  if (!allowedSeries || allowedSeries.length === 0) return [];

  return allowedSeries.map(serie => {
    // Extract just the number and normalize
    const match = serie.match(/(\d+)/);
    if (!match) return serie;

    const num = match[1];
    // Return pattern that matches "1ª Série", "1º Ano", "1a serie", etc.
    return `${num}`;
  });
}
```

**Step 2: Commit**

```bash
git add server/lib/seriesFilter.ts
git commit -m "feat(lib): add series filter helper functions"
```

---

### Task 5: Atualizar endpoint `/api/escola/dashboard` para filtrar por série

**Files:**
- Modify: `server/routes.ts:6294-6471`

**Step 1: Importar helper no início do arquivo**

```typescript
import { isTurmaAllowed, extractSerie } from "./lib/seriesFilter.js";
```

**Step 2: Atualizar endpoint do dashboard**

Localizar o endpoint `GET /api/escola/dashboard` e adicionar filtro por série:

```typescript
app.get("/api/escola/dashboard", requireAuth, requireRole('super_admin', 'school_admin'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const allowedSeries = req.profile?.allowed_series || null;

    console.log(`[ESCOLA DASHBOARD] User: ${req.profile?.name}, Allowed series: ${allowedSeries?.join(', ') || 'ALL'}`);

    // Buscar todos os resultados
    const { data: answers, error } = await supabaseAdmin
      .from("student_answers")
      .select(`
        id,
        student_name,
        student_number,
        turma,
        correct_answers,
        tri_lc,
        tri_ch,
        tri_cn,
        tri_mt,
        created_at,
        exams(title)
      `)
      .order("created_at", { ascending: false });

    if (error) throw error;

    // Filtrar por série se houver restrição
    const filteredAnswers = (answers || []).filter((a: any) =>
      isTurmaAllowed(a.turma, allowedSeries)
    );

    // ... resto do código usando filteredAnswers em vez de answers
```

**Step 3: Atualizar todas as agregações para usar `filteredAnswers`**

Substituir `answers` por `filteredAnswers` em todo o endpoint.

**Step 4: Commit**

```bash
git add server/routes.ts
git commit -m "feat(api): filter escola dashboard by allowed_series"
```

---

### Task 6: Atualizar endpoint `/api/escola/results` para filtrar por série

**Files:**
- Modify: `server/routes.ts:6203-6290`

**Step 1: Adicionar filtro ao endpoint de resultados**

```typescript
app.get("/api/escola/results", requireAuth, requireRole('super_admin', 'school_admin'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const allowedSeries = req.profile?.allowed_series || null;

    const { data: answers, error } = await supabaseAdmin
      .from("student_answers")
      .select(`
        id,
        student_name,
        student_number,
        turma,
        correct_answers,
        tri_lc,
        tri_ch,
        tri_cn,
        tri_mt,
        created_at,
        exams(title)
      `)
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) throw error;

    // Filtrar por série se houver restrição
    const filteredResults = (answers || []).filter((a: any) =>
      isTurmaAllowed(a.turma, allowedSeries)
    );

    res.json({
      results: filteredResults.map((a: any) => ({
        id: a.id,
        student_name: a.student_name,
        student_number: a.student_number,
        turma: a.turma,
        correct_answers: a.correct_answers,
        tri_lc: a.tri_lc,
        tri_ch: a.tri_ch,
        tri_cn: a.tri_cn,
        tri_mt: a.tri_mt,
        exam_title: a.exams?.title,
        created_at: a.created_at,
      })),
    });
  } catch (error: any) {
    console.error("[ESCOLA RESULTS] Erro:", error);
    res.status(500).json({ error: error.message });
  }
});
```

**Step 2: Commit**

```bash
git add server/routes.ts
git commit -m "feat(api): filter escola results by allowed_series"
```

---

### Task 7: Atualizar endpoint `/api/escola/turmas/:turma/alunos` para validar acesso

**Files:**
- Modify: `server/routes.ts:6475-6568`

**Step 1: Adicionar validação de acesso à turma**

```typescript
app.get("/api/escola/turmas/:turma/alunos", requireAuth, requireRole('super_admin', 'school_admin'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { turma } = req.params;
    const decodedTurma = decodeURIComponent(turma);
    const allowedSeries = req.profile?.allowed_series || null;

    // Verificar se coordenador tem acesso a esta turma
    if (!isTurmaAllowed(decodedTurma, allowedSeries)) {
      return res.status(403).json({
        error: "Acesso negado a esta turma",
        code: "SERIES_ACCESS_DENIED"
      });
    }

    // ... resto do código existente
```

**Step 2: Commit**

```bash
git add server/routes.ts
git commit -m "feat(api): validate turma access by allowed_series"
```

---

### Task 8: Atualizar endpoint de exportação Excel para validar acesso

**Files:**
- Modify: `server/routes.ts:6570-6684`

**Step 1: Adicionar validação ao endpoint de export**

```typescript
app.get("/api/escola/turmas/:turma/export-excel", requireAuth, requireRole('super_admin', 'school_admin'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { turma } = req.params;
    const decodedTurma = decodeURIComponent(turma);
    const allowedSeries = req.profile?.allowed_series || null;

    // Verificar se coordenador tem acesso a esta turma
    if (!isTurmaAllowed(decodedTurma, allowedSeries)) {
      return res.status(403).json({
        error: "Acesso negado a esta turma",
        code: "SERIES_ACCESS_DENIED"
      });
    }

    // ... resto do código existente
```

**Step 2: Commit**

```bash
git add server/routes.ts
git commit -m "feat(api): validate excel export access by allowed_series"
```

---

### Task 9: Atualizar AuthContext para incluir `allowed_series`

**Files:**
- Modify: `client/src/contexts/AuthContext.tsx:7-15`

**Step 1: Atualizar interface Profile no frontend**

```typescript
interface Profile {
  id: string;
  school_id: string | null;
  role: UserRole;
  name: string;
  email: string;
  student_number: string | null;
  turma: string | null;
  must_change_password: boolean;
  created_at: string;
  allowed_series: string[] | null;
}
```

**Step 2: Commit**

```bash
git add client/src/contexts/AuthContext.tsx
git commit -m "feat(auth): add allowed_series to frontend Profile type"
```

---

### Task 10: Atualizar endpoint `/api/profile/:id` para retornar `allowed_series`

**Files:**
- Modify: `server/routes.ts` (endpoint GET /api/profile/:id)

**Step 1: Localizar e atualizar o endpoint**

Procurar pelo endpoint `/api/profile/:id` e adicionar `allowed_series` no select:

```typescript
const { data: profile, error } = await supabaseAdmin
  .from('profiles')
  .select('id, school_id, role, name, email, student_number, turma, must_change_password, created_at, allowed_series')
  .eq('id', id)
  .single();
```

**Step 2: Commit**

```bash
git add server/routes.ts
git commit -m "feat(api): include allowed_series in profile endpoint"
```

---

### Task 11: Atualizar página `/escola` para filtrar séries no frontend

**Files:**
- Modify: `client/src/pages/escola.tsx`

**Step 1: Adicionar helper para extrair série**

A função `extractSerie` já existe (linha 359). Adicionar função para filtrar séries permitidas:

```typescript
// Helper: Check if turma matches allowed series
const isTurmaAllowed = (turma: string | null): boolean => {
  const allowedSeries = profile?.allowed_series;
  if (!allowedSeries || allowedSeries.length === 0) return true;

  const serie = extractSerie(turma);
  if (!serie) return false;

  return allowedSeries.some(allowed =>
    serie.toLowerCase().includes(allowed.toLowerCase().replace(/[ªº]/g, '').trim()) ||
    allowed.toLowerCase().includes(serie.toLowerCase().replace(/[ªº]/g, '').trim())
  );
};
```

**Step 2: Filtrar turmas no ranking**

Atualizar onde `turmaRanking` é usado para filtrar turmas não permitidas:

```typescript
// No Tab Turmas, filtrar o ranking
{dashboardData?.turmaRanking
  .filter(turma => isTurmaAllowed(turma.turma))
  .map((turma, index) => (
    // ... card da turma
  ))}
```

**Step 3: Filtrar dropdown de séries disponíveis**

```typescript
// Get unique series from results (excluding null/invalid AND filtering by allowed)
const availableSeries = [...new Set(
  results
    .map(r => extractSerie(r.turma))
    .filter(s => s && s !== 'Sem série' && s !== 'null')
    .filter(s => isTurmaAllowed(s))
)].sort();
```

**Step 4: Commit**

```bash
git add client/src/pages/escola.tsx
git commit -m "feat(escola): filter UI by allowed_series from profile"
```

---

### Task 12: Mostrar indicador de segmento no header

**Files:**
- Modify: `client/src/pages/escola.tsx:410-419`

**Step 1: Atualizar header para mostrar segmento**

```typescript
<div>
  <h1 className="text-xl font-bold">Portal da Escola</h1>
  <p className="text-sm text-gray-500">
    {profile?.name} - Coordenador(a)
    {profile?.allowed_series && profile.allowed_series.length > 0 && (
      <span className="ml-2 text-blue-600">
        ({profile.allowed_series.join(', ')})
      </span>
    )}
  </p>
</div>
```

**Step 2: Commit**

```bash
git add client/src/pages/escola.tsx
git commit -m "feat(escola): show allowed series indicator in header"
```

---

### Task 13: Criar coordenadores de teste no Supabase

**Files:**
- Create: `scripts/create-test-coordinators.sql`

**Step 1: Criar script SQL para coordenadores de teste**

```sql
-- Script para criar coordenadores de teste
-- Executar no Supabase SQL Editor

-- 1. Coordenador da 3ª Série
UPDATE profiles
SET allowed_series = ARRAY['3ª Série']
WHERE email = 'coordenador3serie@escola.com';

-- 2. Coordenador do Ensino Médio (1ª e 2ª Série)
UPDATE profiles
SET allowed_series = ARRAY['1ª Série', '2ª Série']
WHERE email = 'coordenadorEM@escola.com';

-- 3. Coordenador Geral (acesso total) - deixar NULL
UPDATE profiles
SET allowed_series = NULL
WHERE email = 'coordenacao@literato.edu.br';

-- Verificar configuração
SELECT email, name, role, allowed_series
FROM profiles
WHERE role = 'school_admin';
```

**Step 2: Commit**

```bash
git add scripts/create-test-coordinators.sql
git commit -m "chore(scripts): add SQL for test coordinator setup"
```

---

### Task 14: Build e teste final

**Step 1: Executar build**

```bash
npm run build
```

Expected: Build completo sem erros

**Step 2: Testar localmente**

```bash
npm run dev
```

1. Login como coordenador geral (`coordenacao@literato.edu.br`) → Deve ver todas as séries
2. Configurar um coordenador com `allowed_series = ['3ª Série']` no Supabase
3. Login como esse coordenador → Deve ver apenas turmas da 3ª Série

**Step 3: Commit final e push**

```bash
git add -A
git commit -m "feat: segmented coordinator roles by series

- Add allowed_series column to profiles table
- Filter all escola endpoints by coordinator's allowed series
- Show only permitted turmas in UI
- Display segment indicator in header"

git push origin amazing-lamport
```

---

## Resumo de Arquivos Modificados

| Arquivo | Tipo | Descrição |
|---------|------|-----------|
| `supabase/migrations/20250113_add_allowed_series.sql` | Create | Migration para coluna allowed_series |
| `shared/database.types.ts` | Modify | Adicionar allowed_series ao tipo Profile |
| `server/lib/auth.ts` | Modify | Incluir allowed_series na query do middleware |
| `server/lib/seriesFilter.ts` | Create | Funções helper para filtrar por série |
| `server/routes.ts` | Modify | Filtrar endpoints /api/escola/* por série |
| `client/src/contexts/AuthContext.tsx` | Modify | Adicionar allowed_series ao tipo Profile |
| `client/src/pages/escola.tsx` | Modify | Filtrar UI por série permitida |
| `scripts/create-test-coordinators.sql` | Create | Script para criar coordenadores de teste |

---

## Notas de Segurança

1. **Backend é a fonte da verdade** - O filtro acontece no backend, o frontend apenas esconde elementos da UI
2. **Validação em todos os endpoints** - Cada endpoint `/api/escola/*` valida o acesso
3. **NULL = acesso total** - Manter compatibilidade com coordenadores existentes
4. **Super admin bypassa** - `super_admin` sempre tem acesso total

---

**Plan complete and saved to `docs/plans/2025-01-13-segmented-coordinator-roles.md`. Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
