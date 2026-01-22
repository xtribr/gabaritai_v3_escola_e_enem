# Sistema de Mensagens Internas do Admin

**Data:** 2026-01-22
**Status:** Aprovado para implementação

## Resumo

O SUPER_ADMIN poderá enviar mensagens internas para **alunos** ou **escolas (school_admins)** através do dashboard admin. Os destinatários verão:
- Um **badge** no navbar indicando mensagens não lidas
- Um **modal automático** ao fazer login quando há novas mensagens

## Requisitos

| Requisito | Decisão |
|-----------|---------|
| Quem envia | Apenas SUPER_ADMIN |
| Destinatários | Alunos ou School Admins |
| Filtros | Escolas específicas, turmas, séries |
| Visualização | Badge no navbar + modal no login |
| Formatação | Markdown básico (negrito, itálico, listas, links, emojis) |
| Expiração | Automática após 7 dias |

## Fluxo Principal

```
SUPER_ADMIN                         DESTINATÁRIOS
     │                                    │
     ├─► Nova aba "Mensagens"             │
     │   no admin dashboard               │
     │                                    │
     ├─► Seleciona tipo:                  │
     │   • Alunos (com filtros)           │
     │   • Escolas (com filtros)          │
     │                                    │
     ├─► Escreve mensagem                 │
     │   (título + corpo markdown)        │
     │                                    │
     ├─► Envia ─────────────────────────► Badge aparece no navbar
     │                                    │
     │                              Login ─► Modal com mensagens novas
     │                                    │
     │                              Marca como lida ─► Badge atualiza
```

---

## Banco de Dados

### Tabela `admin_messages`

```sql
CREATE TABLE admin_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,                    -- Markdown
  target_type VARCHAR(20) NOT NULL,         -- 'students' | 'schools'

  -- Filtros (nullable = todos)
  filter_school_ids UUID[] DEFAULT NULL,    -- Escolas específicas
  filter_turmas TEXT[] DEFAULT NULL,        -- Turmas específicas
  filter_series TEXT[] DEFAULT NULL,        -- Séries específicas

  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL           -- created_at + 7 dias
);
```

### Tabela `message_recipients`

```sql
CREATE TABLE message_recipients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id UUID NOT NULL REFERENCES admin_messages(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES profiles(id),
  read_at TIMESTAMPTZ DEFAULT NULL,         -- NULL = não lida
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(message_id, recipient_id)
);

-- Índices para performance
CREATE INDEX idx_message_recipients_recipient ON message_recipients(recipient_id);
CREATE INDEX idx_message_recipients_unread ON message_recipients(recipient_id) WHERE read_at IS NULL;
CREATE INDEX idx_admin_messages_expires ON admin_messages(expires_at);
```

### RLS (Row Level Security)

- **SUPER_ADMIN**: CRUD completo em `admin_messages`
- **Outros usuários**: Apenas SELECT em mensagens onde são destinatários via `message_recipients`

---

## API Endpoints

### Para SUPER_ADMIN

```typescript
// Criar nova mensagem
POST /api/admin/messages
Body: {
  title: string,
  content: string,              // Markdown
  target_type: 'students' | 'schools',
  filter_school_ids?: string[], // Opcional
  filter_turmas?: string[],     // Opcional
  filter_series?: string[]      // Opcional
}
Response: { id, recipients_count }

// Listar mensagens enviadas
GET /api/admin/messages
Response: { messages: AdminMessage[], total }

// Deletar mensagem
DELETE /api/admin/messages/:id
```

### Para Destinatários

```typescript
// Buscar minhas mensagens
GET /api/messages
Response: {
  messages: Message[],
  unread_count: number
}

// Marcar como lida
PATCH /api/messages/:id/read
Response: { success: true }

// Marcar todas como lidas
PATCH /api/messages/read-all
Response: { success: true }
```

---

## Componentes Frontend

### Novos Componentes

| Componente | Descrição |
|------------|-----------|
| `MessageInbox.tsx` | Lista de mensagens recebidas com renderização markdown |
| `NewMessagesModal.tsx` | Modal automático ao fazer login com mensagens novas |

### Modificações

| Arquivo | Modificação |
|---------|-------------|
| `admin.tsx` | Nova aba "Mensagens" com formulário e histórico |
| `TopNavbar.tsx` | Badge com contador de não lidas |
| `student-dashboard.tsx` | Integrar inbox |
| `escola.tsx` | Integrar inbox |

### Dependência

```bash
npm install react-markdown
```

---

## Plano de Implementação

### Fase 1: Banco de Dados
1. Criar migration SQL
2. Adicionar índices e RLS
3. Rodar `npm run db:push`

### Fase 2: Backend
1. Schemas Zod em `shared/schema.ts`
2. Endpoints SUPER_ADMIN (3 rotas)
3. Endpoints destinatários (3 rotas)

### Fase 3: Frontend Admin
1. Instalar `react-markdown`
2. Aba "Mensagens" em `admin.tsx`
3. Formulário + histórico

### Fase 4: Frontend Destinatários
1. `MessageInbox.tsx`
2. `NewMessagesModal.tsx`
3. Badge no `TopNavbar.tsx`
4. Integrar em dashboards

### Fase 5: Cleanup
1. Verificação lazy de expiração no backend

---

## Arquivos Afetados

| Ação | Arquivo |
|------|---------|
| Criar | `supabase/migrations/XXXXXX_admin_messages.sql` |
| Modificar | `shared/schema.ts` |
| Modificar | `shared/database.types.ts` |
| Modificar | `server/routes.ts` |
| Criar | `client/src/components/MessageInbox.tsx` |
| Criar | `client/src/components/NewMessagesModal.tsx` |
| Modificar | `client/src/components/TopNavbar.tsx` |
| Modificar | `client/src/pages/admin.tsx` |
| Modificar | `client/src/pages/student-dashboard.tsx` |
| Modificar | `client/src/pages/escola.tsx` |

---

## Estratégia de Segurança

- Todas as mudanças são **aditivas** (novas tabelas, endpoints, componentes)
- Nenhum código existente será alterado de forma destrutiva
- Componentes isolados, importados onde necessário
- Testes manuais em cada fase
