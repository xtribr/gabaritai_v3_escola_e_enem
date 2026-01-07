# Ralph Agent - Gabaritai Admin + Alunos

## O que JÁ FOI FEITO ✅

- Supabase configurado (client/src/lib/supabase.ts, server/lib/supabase.ts)
- Tipos em shared/database.types.ts
- AuthContext com useAuth hook
- Páginas login.tsx e signup.tsx
- ProtectedRoute component
- App.tsx com rotas protegidas
- Schema no Supabase (schools, profiles, exams, student_answers)
- RLS policies configuradas
- Trigger para criar profile no signup
- Escola demo criada

## ARQUITETURA DE USUÁRIOS

```
🏫 ESCOLA (role: admin/teacher)
├── Cria conta no /signup
├── Acessa / (Home) - corretor de gabaritos
├── Acessa /admin - gerencia alunos
└── Importa alunos via CSV

👨‍🎓 ALUNO (role: student)  
├── Criado pela escola via CSV
├── Login com matrícula + senha
├── Acessa /dashboard - vê SEUS resultados
└── Matrícula = ID único (acumula histórico)
```

## Stack Técnico

- Frontend: React + Vite + Tailwind + shadcn/ui + wouter
- Backend: Express (server/routes.ts)
- Database: Supabase (PostgreSQL + Auth)
- Gráficos: Recharts (já instalado)

## Sua Tarefa

### 1. Ver próxima task
```bash
cat scripts/ralph/prd.json | jq '.userStories[] | select(.passes == false) | {id, title, priority}' | head -3
```

### 2. Implementar UMA task por vez
- Siga os acceptanceCriteria
- NÃO modifique home.tsx (9000+ linhas)
- Use wouter para rotas (não react-router)

### 3. Validar
```bash
npm run check
```

### 4. Commitar
```bash
git add . && git commit -m "feat(GAB-XXX): título"
```

### 5. Marcar como feito
Edite prd.json: `"passes": true`

### 6. Atualizar progress.txt
```
## [Data] - GAB-XXX
- Arquivos: [lista]
- Funcionando: [sim/não]
```

## Padrões

### Imports shadcn/ui
```typescript
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
```

### Routing (WOUTER!)
```typescript
import { useLocation, Link } from "wouter";
const [, setLocation] = useLocation();
setLocation("/admin");
```

### Supabase
```typescript
// Frontend
import { supabase } from "@/lib/supabase";

// Backend
import { supabaseAdmin } from "../lib/supabase";
```

### Auth
```typescript
import { useAuth } from "@/contexts/AuthContext";
const { user, profile, signOut } = useAuth();
```

## ⚠️ REGRAS

1. NÃO MODIFIQUE home.tsx
2. Routing é WOUTER, não react-router
3. Imports de shadcn/ui usam @/components/ui/
4. Supabase admin (backend) usa service key
5. RLS filtra automaticamente por school_id

## Stop Condition

- Todas tasks `passes: true` → `<promise>COMPLETE</promise>`
- Bloqueado → `<promise>BLOCKED</promise>`
