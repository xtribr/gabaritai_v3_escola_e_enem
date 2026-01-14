-- ============================================================================
-- MIGRATION: Tabela projetos_escola para armazenar projetos de correção
-- Substitui o localStorage por armazenamento persistente no Supabase
-- ============================================================================

-- TABELA PRINCIPAL: projetos_escola
CREATE TABLE IF NOT EXISTS projetos_escola (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  nome TEXT NOT NULL,
  turma TEXT,
  descricao TEXT,
  -- Armazena as provas corrigidas como JSONB (estrutura flexível)
  provas JSONB DEFAULT '[]'::jsonb,
  -- Lista de alunos únicos consolidados
  alunos_unicos JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para busca rápida
CREATE INDEX IF NOT EXISTS idx_projetos_escola_school ON projetos_escola(school_id);
CREATE INDEX IF NOT EXISTS idx_projetos_escola_created_by ON projetos_escola(created_by);
CREATE INDEX IF NOT EXISTS idx_projetos_escola_nome ON projetos_escola(nome);

-- Trigger para atualizar updated_at
CREATE OR REPLACE FUNCTION update_projetos_escola_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS projetos_escola_updated_at ON projetos_escola;
CREATE TRIGGER projetos_escola_updated_at
  BEFORE UPDATE ON projetos_escola
  FOR EACH ROW EXECUTE FUNCTION update_projetos_escola_updated_at();

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================
ALTER TABLE projetos_escola ENABLE ROW LEVEL SECURITY;

-- Super admins podem ver/editar todos os projetos
CREATE POLICY "Super admins full access projetos_escola" ON projetos_escola
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  );

-- School admins podem ver/editar projetos da própria escola
CREATE POLICY "School admins manage own school projetos" ON projetos_escola
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'school_admin'
      AND profiles.school_id = projetos_escola.school_id
    )
  );

-- Service role tem acesso total (para o backend)
CREATE POLICY "Service role full access projetos_escola" ON projetos_escola
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- GRANTS
-- ============================================================================
GRANT ALL ON projetos_escola TO authenticated;
GRANT ALL ON projetos_escola TO service_role;

-- ============================================================================
-- COMENTÁRIOS
-- ============================================================================
COMMENT ON TABLE projetos_escola IS 'Projetos de correção de provas por escola/turma';
COMMENT ON COLUMN projetos_escola.provas IS 'Array JSON de provas corrigidas com gabarito e resultados';
COMMENT ON COLUMN projetos_escola.alunos_unicos IS 'Lista consolidada de alunos que participaram das provas';
