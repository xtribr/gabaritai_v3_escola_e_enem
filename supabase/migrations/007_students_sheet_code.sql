-- ============================================================================
-- MIGRATION 007: Adiciona sheet_code à tabela students
-- Permite vincular QR Codes diretamente aos alunos importados via CSV
-- ============================================================================

-- Adicionar coluna sheet_code à tabela students
ALTER TABLE students ADD COLUMN IF NOT EXISTS sheet_code TEXT UNIQUE;

-- Criar índice para busca rápida por sheet_code
CREATE INDEX IF NOT EXISTS idx_students_sheet_code ON students(sheet_code);

-- Comentário
COMMENT ON COLUMN students.sheet_code IS 'Código único do QR Code (formato: XTRI-XXXXXX) para identificação no gabarito';

-- ============================================================================
-- FUNÇÃO: Gera sheet_code único no formato XTRI-XXXXXX
-- ============================================================================
CREATE OR REPLACE FUNCTION generate_sheet_code()
RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  result TEXT := 'XTRI-';
  i INTEGER;
BEGIN
  FOR i IN 1..6 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNÇÃO: Gera sheet_codes para alunos que não têm
-- ============================================================================
CREATE OR REPLACE FUNCTION generate_sheet_codes_for_students()
RETURNS INTEGER AS $$
DECLARE
  student_record RECORD;
  new_code TEXT;
  updated_count INTEGER := 0;
  max_attempts INTEGER := 100;
  attempts INTEGER;
BEGIN
  FOR student_record IN
    SELECT id FROM students WHERE sheet_code IS NULL
  LOOP
    attempts := 0;
    LOOP
      new_code := generate_sheet_code();
      -- Verificar unicidade em students E answer_sheet_students
      IF NOT EXISTS (SELECT 1 FROM students WHERE sheet_code = new_code)
         AND NOT EXISTS (SELECT 1 FROM answer_sheet_students WHERE sheet_code = new_code)
      THEN
        UPDATE students SET sheet_code = new_code WHERE id = student_record.id;
        updated_count := updated_count + 1;
        EXIT;
      END IF;
      attempts := attempts + 1;
      IF attempts >= max_attempts THEN
        RAISE EXCEPTION 'Não foi possível gerar código único após % tentativas', max_attempts;
      END IF;
    END LOOP;
  END LOOP;
  RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- TRIGGER: Gerar sheet_code automaticamente ao inserir aluno
-- ============================================================================
CREATE OR REPLACE FUNCTION auto_generate_sheet_code()
RETURNS TRIGGER AS $$
DECLARE
  new_code TEXT;
  max_attempts INTEGER := 100;
  attempts INTEGER := 0;
BEGIN
  IF NEW.sheet_code IS NULL THEN
    LOOP
      new_code := generate_sheet_code();
      -- Verificar unicidade em students E answer_sheet_students
      IF NOT EXISTS (SELECT 1 FROM students WHERE sheet_code = new_code)
         AND NOT EXISTS (SELECT 1 FROM answer_sheet_students WHERE sheet_code = new_code)
      THEN
        NEW.sheet_code := new_code;
        EXIT;
      END IF;
      attempts := attempts + 1;
      IF attempts >= max_attempts THEN
        RAISE EXCEPTION 'Não foi possível gerar código único após % tentativas', max_attempts;
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS students_auto_sheet_code ON students;
CREATE TRIGGER students_auto_sheet_code
  BEFORE INSERT ON students
  FOR EACH ROW EXECUTE FUNCTION auto_generate_sheet_code();

-- ============================================================================
-- GERAR CÓDIGOS PARA ALUNOS EXISTENTES
-- ============================================================================
SELECT generate_sheet_codes_for_students();
