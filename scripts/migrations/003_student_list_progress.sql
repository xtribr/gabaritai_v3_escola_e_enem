-- Migration: Tabela para rastrear progresso do aluno nas listas de exercícios
-- Implementa: Liberação por TRI + Auto-declaração de conclusão

-- Tabela de progresso nas listas
CREATE TABLE IF NOT EXISTS student_list_progress (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  list_id UUID NOT NULL REFERENCES exercise_lists(id) ON DELETE CASCADE,

  -- Status da lista para o aluno
  status TEXT NOT NULL DEFAULT 'locked' CHECK (status IN ('locked', 'available', 'downloaded', 'completed')),

  -- Timestamps de ações
  unlocked_at TIMESTAMPTZ,      -- Quando foi desbloqueada (atingiu TRI)
  downloaded_at TIMESTAMPTZ,    -- Quando fez download
  completed_at TIMESTAMPTZ,     -- Quando marcou como concluída
  download_count INT DEFAULT 0, -- Quantas vezes baixou

  -- Metadados
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraint única: um registro por aluno por lista
  UNIQUE(student_id, list_id)
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_student_list_progress_student ON student_list_progress(student_id);
CREATE INDEX IF NOT EXISTS idx_student_list_progress_list ON student_list_progress(list_id);
CREATE INDEX IF NOT EXISTS idx_student_list_progress_status ON student_list_progress(status);

-- Trigger para atualizar updated_at
CREATE OR REPLACE FUNCTION update_student_list_progress_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_student_list_progress_updated_at ON student_list_progress;
CREATE TRIGGER trigger_update_student_list_progress_updated_at
  BEFORE UPDATE ON student_list_progress
  FOR EACH ROW
  EXECUTE FUNCTION update_student_list_progress_updated_at();

-- RLS (Row Level Security)
ALTER TABLE student_list_progress ENABLE ROW LEVEL SECURITY;

-- Política: Aluno pode ver apenas seu próprio progresso
CREATE POLICY "Alunos podem ver seu progresso" ON student_list_progress
  FOR SELECT
  USING (auth.uid() = student_id);

-- Política: Aluno pode atualizar seu próprio progresso
CREATE POLICY "Alunos podem atualizar seu progresso" ON student_list_progress
  FOR UPDATE
  USING (auth.uid() = student_id);

-- Política: Service role pode fazer tudo (para a API)
CREATE POLICY "Service role full access" ON student_list_progress
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- Comentários
COMMENT ON TABLE student_list_progress IS 'Rastreia progresso do aluno em listas de exercícios';
COMMENT ON COLUMN student_list_progress.status IS 'locked=bloqueada, available=disponível, downloaded=baixou, completed=marcou concluída';
