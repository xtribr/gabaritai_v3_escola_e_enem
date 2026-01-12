-- ============================================================================
-- MIGRATION 006: Tabela students separada do auth.users
-- Permite importar alunos do CSV sem criar usuários no Supabase Auth
-- Alunos podem opcionalmente criar conta depois para acessar dashboard
-- ============================================================================

-- TABELA STUDENTS
-- Armazena dados dos alunos importados via CSV
CREATE TABLE IF NOT EXISTS students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  matricula TEXT NOT NULL,
  name TEXT NOT NULL,
  turma TEXT,
  -- Referência opcional ao profile quando aluno criar conta
  profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  -- Matrícula única por escola
  UNIQUE(school_id, matricula)
);

-- Índices para busca rápida
CREATE INDEX IF NOT EXISTS idx_students_school ON students(school_id);
CREATE INDEX IF NOT EXISTS idx_students_matricula ON students(matricula);
CREATE INDEX IF NOT EXISTS idx_students_turma ON students(school_id, turma);
CREATE INDEX IF NOT EXISTS idx_students_profile ON students(profile_id);

-- Trigger para atualizar updated_at
CREATE OR REPLACE FUNCTION update_students_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS students_updated_at ON students;
CREATE TRIGGER students_updated_at
  BEFORE UPDATE ON students
  FOR EACH ROW EXECUTE FUNCTION update_students_updated_at();

-- RLS
ALTER TABLE students ENABLE ROW LEVEL SECURITY;

-- Políticas RLS
-- Admins da escola podem ver alunos
CREATE POLICY "School admins view students" ON students FOR SELECT
  USING (school_id IN (
    SELECT school_id FROM profiles
    WHERE id = auth.uid() AND role IN ('admin', 'teacher', 'school_admin', 'super_admin')
  ));

-- Super admins veem todos
CREATE POLICY "Super admins view all students" ON students FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin'
  ));

-- Admins podem inserir/atualizar/deletar
CREATE POLICY "Admins manage students" ON students FOR ALL
  USING (school_id IN (
    SELECT school_id FROM profiles
    WHERE id = auth.uid() AND role IN ('admin', 'teacher', 'school_admin', 'super_admin')
  ) OR EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin'
  ));

-- Alunos veem apenas seus próprios dados
CREATE POLICY "Students view own data" ON students FOR SELECT
  USING (profile_id = auth.uid());

-- ============================================================================
-- ATUALIZAÇÃO: Adicionar referência na student_answers
-- ============================================================================

-- Adicionar coluna student_record_id (referência à tabela students)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'student_answers' AND column_name = 'student_record_id'
  ) THEN
    ALTER TABLE student_answers ADD COLUMN student_record_id UUID REFERENCES students(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_answers_student_record ON student_answers(student_record_id);
  END IF;
END $$;

-- ============================================================================
-- COMENTÁRIOS
-- ============================================================================
COMMENT ON TABLE students IS 'Alunos importados via CSV, independente do auth.users';
COMMENT ON COLUMN students.matricula IS 'Número de matrícula único por escola';
COMMENT ON COLUMN students.profile_id IS 'Referência ao profile quando aluno cria conta no sistema';
COMMENT ON COLUMN student_answers.student_record_id IS 'Referência ao registro do aluno na tabela students';
