-- Migration: Tracking de downloads de listas de exercícios
-- Permite ao coordenador ver quais alunos baixaram quais listas

-- Tabela para registrar downloads
CREATE TABLE IF NOT EXISTS list_downloads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  list_id UUID NOT NULL REFERENCES exercise_lists(id) ON DELETE CASCADE,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  turma TEXT,
  downloaded_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  -- Um aluno só pode ter um registro por lista (pode baixar múltiplas vezes, mas só conta uma)
  UNIQUE(student_id, list_id)
);

-- Índices para consultas frequentes
CREATE INDEX IF NOT EXISTS idx_list_downloads_school_id ON list_downloads(school_id);
CREATE INDEX IF NOT EXISTS idx_list_downloads_list_id ON list_downloads(list_id);
CREATE INDEX IF NOT EXISTS idx_list_downloads_student_id ON list_downloads(student_id);
CREATE INDEX IF NOT EXISTS idx_list_downloads_turma ON list_downloads(turma);
CREATE INDEX IF NOT EXISTS idx_list_downloads_downloaded_at ON list_downloads(downloaded_at);

-- RLS Policies
ALTER TABLE list_downloads ENABLE ROW LEVEL SECURITY;

-- Alunos podem ver seus próprios downloads
CREATE POLICY "Students can view own downloads"
  ON list_downloads FOR SELECT
  USING (auth.uid() = student_id);

-- Alunos podem inserir seus próprios downloads
CREATE POLICY "Students can insert own downloads"
  ON list_downloads FOR INSERT
  WITH CHECK (auth.uid() = student_id);

-- Coordenadores podem ver downloads de sua escola
CREATE POLICY "Coordinators can view school downloads"
  ON list_downloads FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
      AND p.role IN ('coordinator', 'admin')
      AND p.school_id = list_downloads.school_id
    )
  );

-- Admins podem ver tudo
CREATE POLICY "Admins can view all downloads"
  ON list_downloads FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
      AND p.role = 'admin'
    )
  );

-- View para relatório do coordenador: resumo por lista
CREATE OR REPLACE VIEW list_download_summary AS
SELECT
  el.id AS list_id,
  el.titulo AS list_title,
  el.area,
  el.tri_min,
  el.tri_max,
  ld.school_id,
  ld.turma,
  COUNT(DISTINCT ld.student_id) AS total_downloads,
  COUNT(DISTINCT CASE WHEN ld.downloaded_at > NOW() - INTERVAL '7 days' THEN ld.student_id END) AS downloads_last_7_days
FROM exercise_lists el
LEFT JOIN list_downloads ld ON el.id = ld.list_id
GROUP BY el.id, el.titulo, el.area, el.tri_min, el.tri_max, ld.school_id, ld.turma;

-- View para relatório detalhado: quem baixou e quem não baixou
CREATE OR REPLACE VIEW list_download_details AS
SELECT
  p.id AS student_id,
  p.name AS student_name,
  p.student_number,
  p.turma,
  p.school_id,
  el.id AS list_id,
  el.titulo AS list_title,
  el.area,
  el.tri_min,
  el.tri_max,
  CASE WHEN ld.id IS NOT NULL THEN true ELSE false END AS downloaded,
  ld.downloaded_at
FROM profiles p
CROSS JOIN exercise_lists el
LEFT JOIN list_downloads ld ON p.id = ld.student_id AND el.id = ld.list_id
WHERE p.role = 'student';

COMMENT ON TABLE list_downloads IS 'Rastreia downloads de listas de exercícios pelos alunos';
COMMENT ON VIEW list_download_summary IS 'Resumo de downloads por lista, escola e turma';
COMMENT ON VIEW list_download_details IS 'Detalhes de download por aluno e lista';
