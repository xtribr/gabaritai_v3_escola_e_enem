# Configurações de Segurança - Supabase

## 1. Expiração de Sessão JWT

Para configurar a expiração automática de sessão no Supabase:

1. Acesse o **Dashboard do Supabase**: https://app.supabase.com
2. Vá para **Authentication** > **Settings** > **JWT Settings**
3. Configure:
   - **JWT expiry limit**: `28800` (8 horas em segundos)
   - Ou `86400` (24 horas) se preferir mais tempo

### Opção alternativa via SQL:
```sql
-- Atualizar configuração de expiração JWT (executar como superuser)
ALTER SYSTEM SET "app.settings.jwt_exp" = 28800;
SELECT pg_reload_conf();
```

## 2. Rate Limiting (Proteção contra Brute Force)

No Supabase Dashboard:
1. Vá para **Authentication** > **Settings** > **Rate Limits**
2. Configure:
   - **Rate limit for signup**: 10 requests per hour
   - **Rate limit for login**: 30 requests per hour
   - **Rate limit for token refresh**: 360 requests per hour

## 3. Políticas RLS Aplicadas

### Tabela `profiles`
- Usuários só podem ver/editar seu próprio perfil
- Super admin pode ver todos os perfis

### Tabela `projetos`
- Super admin tem acesso total
- School admin só acessa projetos da própria escola
- Projetos legados (sem school_id) são apenas para super_admin

### Tabela `student_answers`
- Admins podem criar/ver/deletar respostas
- Alunos podem ver apenas suas próprias respostas

## 4. Endpoints Protegidos no Backend

Todos os endpoints agora requerem autenticação:

| Rota | Roles Permitidas |
|------|------------------|
| `/api/process-pdf` | super_admin |
| `/api/projetos/*` | super_admin |
| `/api/avaliacoes/*` | super_admin, school_admin |
| `/api/escola/*` | super_admin, school_admin |
| `/api/student/*` | super_admin, school_admin, student |
| `/api/admin/*` | super_admin, school_admin |
| `/api/schools/*` | super_admin |
| `/api/simulados/*` | super_admin, school_admin |

## 5. Verificação Aplicada

1. **requireAuth**: Verifica se existe um token JWT válido
2. **requireRole**: Verifica se o usuário tem a role necessária
3. **requireSchoolAccess**: Garante que school_admin só acessa dados da própria escola

## 6. Frontend Atualizado

Todas as chamadas de API agora usam `authFetch()` que:
- Busca automaticamente o token da sessão do Supabase
- Adiciona o header `Authorization: Bearer <token>`
- Funciona com chamadas GET, POST, PUT, DELETE

## 7. Próximos Passos (Manual)

Para completar a segurança, você precisa:

1. **Acessar o Dashboard do Supabase** e configurar o JWT expiry
2. **Testar o login/logout** para verificar se a expiração está funcionando
3. **Deploy** do código atualizado para Vercel e Fly.io
