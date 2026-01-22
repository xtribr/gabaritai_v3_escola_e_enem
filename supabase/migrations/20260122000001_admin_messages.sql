-- ============================================================================
-- MIGRATION: Sistema de Mensagens Internas do Admin
-- Data: 2026-01-22
-- Descrição: Permite que SUPER_ADMIN envie mensagens para alunos e escolas
-- ============================================================================

-- Tabela principal de mensagens enviadas pelo admin
CREATE TABLE admin_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,                    -- Suporta Markdown
  target_type VARCHAR(20) NOT NULL CHECK (target_type IN ('students', 'schools')),

  -- Filtros opcionais (NULL = todos)
  filter_school_ids UUID[] DEFAULT NULL,    -- Escolas específicas
  filter_turmas TEXT[] DEFAULT NULL,        -- Turmas específicas
  filter_series TEXT[] DEFAULT NULL,        -- Séries específicas

  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL           -- Calculado como created_at + 7 dias
);

-- Tabela de destinatários (rastreia quem recebeu e leu)
CREATE TABLE message_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES admin_messages(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ DEFAULT NULL,         -- NULL = não lida
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(message_id, recipient_id)
);

-- Índices para performance
CREATE INDEX idx_admin_messages_created_by ON admin_messages(created_by);
CREATE INDEX idx_admin_messages_target_type ON admin_messages(target_type);
CREATE INDEX idx_admin_messages_expires ON admin_messages(expires_at);
CREATE INDEX idx_admin_messages_created_at ON admin_messages(created_at DESC);

CREATE INDEX idx_message_recipients_recipient ON message_recipients(recipient_id);
CREATE INDEX idx_message_recipients_message ON message_recipients(message_id);
CREATE INDEX idx_message_recipients_unread ON message_recipients(recipient_id) WHERE read_at IS NULL;

-- ============================================================================
-- RLS (Row Level Security) Policies
-- ============================================================================

ALTER TABLE admin_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_recipients ENABLE ROW LEVEL SECURITY;

-- SUPER_ADMIN pode tudo em admin_messages
CREATE POLICY "super_admin_all_messages" ON admin_messages
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  );

-- SUPER_ADMIN pode tudo em message_recipients
CREATE POLICY "super_admin_all_recipients" ON message_recipients
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  );

-- Usuários podem ver suas próprias mensagens (message_recipients)
CREATE POLICY "users_view_own_messages" ON message_recipients
  FOR SELECT
  TO authenticated
  USING (recipient_id = auth.uid());

-- Usuários podem atualizar suas próprias mensagens (marcar como lida)
CREATE POLICY "users_update_own_messages" ON message_recipients
  FOR UPDATE
  TO authenticated
  USING (recipient_id = auth.uid())
  WITH CHECK (recipient_id = auth.uid());

-- Usuários podem ver admin_messages se são destinatários
CREATE POLICY "users_view_received_messages" ON admin_messages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM message_recipients
      WHERE message_recipients.message_id = admin_messages.id
      AND message_recipients.recipient_id = auth.uid()
    )
  );

-- ============================================================================
-- Comentários
-- ============================================================================

COMMENT ON TABLE admin_messages IS 'Mensagens enviadas pelo SUPER_ADMIN para alunos ou escolas';
COMMENT ON TABLE message_recipients IS 'Rastreia destinatários e status de leitura das mensagens';
COMMENT ON COLUMN admin_messages.target_type IS 'students = envia para alunos, schools = envia para school_admins';
COMMENT ON COLUMN admin_messages.filter_school_ids IS 'Se NULL, envia para todas as escolas. Se preenchido, filtra por escolas específicas';
COMMENT ON COLUMN admin_messages.filter_turmas IS 'Filtra alunos por turma (ex: 3A, 3B)';
COMMENT ON COLUMN admin_messages.filter_series IS 'Filtra alunos por série (ex: 1º Ano, 2º Ano)';
COMMENT ON COLUMN admin_messages.expires_at IS 'Mensagens expiram automaticamente após 7 dias';
COMMENT ON COLUMN message_recipients.read_at IS 'NULL = mensagem não lida, timestamp = quando foi lida';
