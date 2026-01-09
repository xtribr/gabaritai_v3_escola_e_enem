-- ============================================================================
-- MIGRATION: Tabela de Projetos (persistência XTRI PROVAS)
-- ============================================================================

-- Tabela para armazenar projetos de correção (Dia 1, Dia 2, mesclados)
CREATE TABLE IF NOT EXISTS projetos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Metadados básicos
  nome TEXT NOT NULL,
  descricao TEXT,
  template JSONB, -- Objeto com {name: "ENEM - Dia 1", ...}

  -- Dados do gabarito e questões
  answer_key TEXT[] DEFAULT '{}',
  question_contents JSONB DEFAULT '[]',

  -- Dados dos alunos (array de objetos com respostas, notas, etc.)
  students JSONB DEFAULT '[]',

  -- Estatísticas gerais
  statistics JSONB DEFAULT '{}',

  -- Scores TRI
  tri_scores JSONB DEFAULT '{}',
  tri_scores_by_area JSONB DEFAULT '{}',

  -- Controle de merge ENEM
  dia1_processado BOOLEAN DEFAULT false,
  dia2_processado BOOLEAN DEFAULT false,

  -- Auditoria
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para busca rápida
CREATE INDEX IF NOT EXISTS idx_projetos_nome ON projetos(nome);
CREATE INDEX IF NOT EXISTS idx_projetos_created_at ON projetos(created_at DESC);

-- RLS: Projetos são públicos para super_admin (sem school_id por enquanto)
-- Futuramente pode adicionar school_id para multi-tenancy
ALTER TABLE projetos ENABLE ROW LEVEL SECURITY;

-- Policy para service role (backend) ter acesso total
CREATE POLICY "Service role full access" ON projetos
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Trigger para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_projetos_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS projetos_updated_at ON projetos;
CREATE TRIGGER projetos_updated_at
  BEFORE UPDATE ON projetos
  FOR EACH ROW
  EXECUTE FUNCTION update_projetos_updated_at();
