# Student Dashboard Flow - Plano de Implementação

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Garantir que o fluxo completo funcione: admin importa alunos → alunos recebem credenciais → alunos fazem login por matrícula → visualizam resultados do OMR

**Architecture:** O sistema já possui a maior parte implementada. Este plano foca em:
1. Validar e corrigir a vinculação de resultados OMR ao `student_id`
2. Garantir que senhas sejam exibidas/exportáveis após import
3. Adicionar página de "esqueci minha senha" para alunos
4. Melhorar UX do dashboard do aluno

**Tech Stack:** React, TypeScript, Express, Supabase Auth, PostgreSQL

---

## Estado Atual do Sistema

### ✅ Já Implementado:
- Login por matrícula (`/api/auth/email-by-matricula/:matricula`)
- Import de alunos via CSV com criação no Supabase Auth
- Dashboard do aluno completo (`/client/src/pages/student-dashboard.tsx`)
- Vinculação de `student_id` durante processamento OMR
- Senha gerada como `{matricula}{4 dígitos}`

### ⚠️ Lacunas Identificadas:
1. Não há página de "esqueci minha senha"
2. Senhas não são facilmente exportáveis após import
3. Falta botão de "exportar credenciais" no admin
4. Aluno não consegue redefinir senha sozinho

---

## Task 1: Adicionar Exportação de Credenciais no Admin

**Files:**
- Modify: `server/routes.ts` (adicionar endpoint)
- Modify: `client/src/pages/escola.tsx` ou admin (adicionar botão)

**Step 1: Criar endpoint para exportar credenciais**

Adicionar em `server/routes.ts` após linha ~4200:

```typescript
// GET /api/admin/export-credentials - Exportar credenciais dos alunos
app.get("/api/admin/export-credentials", requireAuth, requireRole('school_admin', 'super_admin'), async (req: Request, res: Response) => {
  try {
    const { turma, school_id } = req.query;

    let query = supabaseAdmin
      .from("profiles")
      .select("name, student_number, email, turma")
      .eq("role", "student")
      .order("turma")
      .order("name");

    if (turma) {
      query = query.eq("turma", turma);
    }

    if (school_id) {
      query = query.eq("school_id", school_id);
    }

    const { data: students, error } = await query;

    if (error) throw error;

    // Gerar CSV
    const csvHeader = "Nome,Matrícula,Email,Turma,Senha Padrão\n";
    const csvRows = students?.map(s =>
      `"${s.name}","${s.student_number}","${s.email}","${s.turma}","${s.student_number}1234"`
    ).join("\n") || "";

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=credenciais_alunos.csv");
    res.send(csvHeader + csvRows);

  } catch (error: any) {
    console.error("[EXPORT_CREDENTIALS] Erro:", error);
    res.status(500).json({ error: "Erro ao exportar credenciais", details: error.message });
  }
});
```

**Step 2: Commit**

```bash
git add server/routes.ts
git commit -m "feat: add endpoint to export student credentials as CSV"
```

---

## Task 2: Adicionar Página de Recuperação de Senha

**Files:**
- Create: `client/src/pages/forgot-password.tsx`
- Modify: `client/src/App.tsx` (adicionar rota)
- Modify: `client/src/pages/login.tsx` (adicionar link)

**Step 1: Criar página forgot-password.tsx**

```tsx
import { useState } from 'react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ArrowLeft, Mail } from 'lucide-react';
import { supabase } from '@/lib/supabase';

export default function ForgotPasswordPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [sent, setSent] = useState(false);

  const isEmail = identifier.includes('@');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    let emailToUse = identifier;

    // Se for matrícula, buscar email
    if (!isEmail) {
      try {
        const response = await fetch(`/api/auth/email-by-matricula/${encodeURIComponent(identifier)}`);
        const data = await response.json();

        if (!response.ok || !data.email) {
          toast({
            title: 'Matrícula não encontrada',
            description: 'Verifique se digitou corretamente ou fale com o administrador.',
            variant: 'destructive',
          });
          setLoading(false);
          return;
        }
        emailToUse = data.email;
      } catch {
        toast({
          title: 'Erro de conexão',
          description: 'Não foi possível verificar a matrícula.',
          variant: 'destructive',
        });
        setLoading(false);
        return;
      }
    }

    // Enviar email de recuperação
    const { error } = await supabase.auth.resetPasswordForEmail(emailToUse, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    setLoading(false);

    if (error) {
      toast({
        title: 'Erro',
        description: error.message,
        variant: 'destructive',
      });
    } else {
      setSent(true);
      toast({
        title: 'Email enviado!',
        description: 'Verifique sua caixa de entrada (e spam).',
      });
    }
  }

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <Mail className="w-12 h-12 mx-auto text-green-500 mb-4" />
            <CardTitle>Email Enviado!</CardTitle>
            <CardDescription>
              Se o email/matrícula estiver cadastrado, você receberá um link para redefinir sua senha.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/login">
              <Button variant="outline" className="w-full">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Voltar ao Login
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle>Esqueceu sua senha?</CardTitle>
          <CardDescription>
            Digite sua matrícula ou email para receber um link de recuperação.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="identifier">Matrícula ou Email</Label>
              <Input
                id="identifier"
                type="text"
                placeholder="12345 ou aluno@email.com"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
              />
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Enviando...
                </>
              ) : (
                'Enviar Link de Recuperação'
              )}
            </Button>

            <Link href="/login">
              <Button variant="ghost" className="w-full">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Voltar ao Login
              </Button>
            </Link>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

**Step 2: Adicionar rota no App.tsx**

Em `client/src/App.tsx`, adicionar import e rota:

```tsx
import ForgotPasswordPage from "@/pages/forgot-password";

// Na seção de rotas públicas:
<Route path="/forgot-password">
  <ForgotPasswordPage />
</Route>
```

**Step 3: Adicionar link no login.tsx**

Em `client/src/pages/login.tsx`, após o botão de submit:

```tsx
<div className="text-center text-sm">
  <Link href="/forgot-password" className="text-primary hover:underline">
    Esqueceu sua senha?
  </Link>
</div>
```

**Step 4: Commit**

```bash
git add client/src/pages/forgot-password.tsx client/src/App.tsx client/src/pages/login.tsx
git commit -m "feat: add forgot password page with matrícula support"
```

---

## Task 3: Criar Página de Reset de Senha

**Files:**
- Create: `client/src/pages/reset-password.tsx`
- Modify: `client/src/App.tsx` (adicionar rota)

**Step 1: Criar página reset-password.tsx**

```tsx
import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Loader2, CheckCircle, Lock } from 'lucide-react';
import { supabase } from '@/lib/supabase';

export default function ResetPasswordPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    // Verificar se há sessão de recovery
    supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        // Usuário veio do link de recovery
      }
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (password !== confirmPassword) {
      toast({
        title: 'Senhas não conferem',
        description: 'Digite a mesma senha nos dois campos.',
        variant: 'destructive',
      });
      return;
    }

    if (password.length < 6) {
      toast({
        title: 'Senha muito curta',
        description: 'A senha deve ter pelo menos 6 caracteres.',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.updateUser({ password });

    setLoading(false);

    if (error) {
      toast({
        title: 'Erro',
        description: error.message,
        variant: 'destructive',
      });
    } else {
      setSuccess(true);
      toast({ title: 'Senha alterada com sucesso!' });
      setTimeout(() => setLocation('/login'), 2000);
    }
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CheckCircle className="w-12 h-12 mx-auto text-green-500 mb-4" />
            <CardTitle>Senha Alterada!</CardTitle>
            <CardDescription>
              Redirecionando para o login...
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <Lock className="w-12 h-12 mx-auto text-primary mb-4" />
          <CardTitle>Nova Senha</CardTitle>
          <CardDescription>
            Digite sua nova senha abaixo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Nova Senha</Label>
              <Input
                id="password"
                type="password"
                placeholder="Mínimo 6 caracteres"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirmar Senha</Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="Digite novamente"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Salvando...
                </>
              ) : (
                'Salvar Nova Senha'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

**Step 2: Adicionar rota no App.tsx**

```tsx
import ResetPasswordPage from "@/pages/reset-password";

// Na seção de rotas públicas:
<Route path="/reset-password">
  <ResetPasswordPage />
</Route>
```

**Step 3: Commit**

```bash
git add client/src/pages/reset-password.tsx client/src/App.tsx
git commit -m "feat: add reset password page for password recovery flow"
```

---

## Task 4: Adicionar Botão de Download de Credenciais no Admin

**Files:**
- Modify: `client/src/pages/escola.tsx` (seção de alunos)

**Step 1: Adicionar botão de exportar**

Localizar seção de gestão de alunos e adicionar:

```tsx
<Button
  variant="outline"
  onClick={() => {
    const turma = selectedTurma || '';
    window.open(`/api/admin/export-credentials?turma=${turma}`, '_blank');
  }}
>
  <Download className="w-4 h-4 mr-2" />
  Exportar Credenciais
</Button>
```

**Step 2: Commit**

```bash
git add client/src/pages/escola.tsx
git commit -m "feat: add button to export student credentials in admin"
```

---

## Task 5: Melhorar Feedback de Senha no Import

**Files:**
- Modify: `server/routes.ts` (endpoint import-students)

**Step 1: Garantir que senha seja retornada corretamente**

Verificar que o endpoint `/api/admin/import-students` retorna a senha gerada no resultado. A senha segue o padrão `{matricula}{4 dígitos}`.

Exemplo de resultado esperado:
```json
{
  "results": [
    {
      "matricula": "12345",
      "nome": "João Silva",
      "turma": "3A",
      "email": "12345@escola.gabaritai.com",
      "senha": "123458742",
      "status": "created"
    }
  ]
}
```

**Step 2: Commit (se houver alteração)**

```bash
git add server/routes.ts
git commit -m "fix: ensure password is returned in import results"
```

---

## Task 6: Testar Fluxo Completo

**Checklist de Teste:**

1. **Admin importa alunos via CSV**
   - [ ] Alunos são criados no Supabase Auth
   - [ ] Senhas são exibidas no resultado
   - [ ] Botão "Exportar Credenciais" funciona

2. **Aluno faz login**
   - [ ] Login com matrícula funciona
   - [ ] Login com email funciona
   - [ ] Redireciona para /dashboard

3. **Aluno visualiza resultados**
   - [ ] Dashboard carrega
   - [ ] Resultados do OMR aparecem vinculados
   - [ ] Notas TRI são exibidas

4. **Recuperação de senha**
   - [ ] Página /forgot-password funciona
   - [ ] Email de recuperação é enviado
   - [ ] Página /reset-password permite alterar senha

---

## Resumo das Alterações

| Arquivo | Ação | Descrição |
|---------|------|-----------|
| `server/routes.ts` | Modificar | Endpoint export-credentials |
| `client/src/pages/forgot-password.tsx` | Criar | Página de esqueci senha |
| `client/src/pages/reset-password.tsx` | Criar | Página de nova senha |
| `client/src/App.tsx` | Modificar | Adicionar rotas |
| `client/src/pages/login.tsx` | Modificar | Link para forgot-password |
| `client/src/pages/escola.tsx` | Modificar | Botão exportar credenciais |
