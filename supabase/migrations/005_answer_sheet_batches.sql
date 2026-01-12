-- ============================================================
-- Migration: Answer Sheet Batches (Gabaritos com QR Code)
-- ============================================================
-- Tabelas para sistema de gabaritos pré-cadastrados com QR Code
-- para identificação automática de alunos.
--
-- Fluxo:
-- 1. Escola faz upload de CSV com alunos
-- 2. Sistema cria batch + students com sheet_codes únicos
-- 3. Sistema gera PDFs com QR Codes
-- 4. Após escaneamento, OMR lê QR + bolhas
-- 5. Respostas são salvas automaticamente
-- ============================================================

-- Tabela de lotes de gabaritos (cada upload de CSV cria um lote)
CREATE TABLE IF NOT EXISTS answer_sheet_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Comentários
COMMENT ON TABLE answer_sheet_batches IS 'Lotes de gabaritos pré-cadastrados';
COMMENT ON COLUMN answer_sheet_batches.name IS 'Nome do lote (ex: "Simulado ENEM - Março 2025")';

-- Tabela de alunos/gabaritos pré-cadastrados
CREATE TABLE IF NOT EXISTS answer_sheet_students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES answer_sheet_batches(id) ON DELETE CASCADE,

    -- Dados do CSV (flexíveis)
    enrollment_code TEXT,           -- Matrícula (pode ser NULL)
    student_name TEXT NOT NULL,     -- Nome do aluno
    class_name TEXT,                -- Turma

    -- Identificador único para o QR Code
    sheet_code TEXT UNIQUE NOT NULL, -- Ex: "XTRI-A7B3C9"

    -- Resultado após leitura OMR
    answers JSONB,                  -- Array de respostas ["A", "B", null, "C", ...]
    processed_at TIMESTAMPTZ,       -- Quando foi processado

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Comentários
COMMENT ON TABLE answer_sheet_students IS 'Gabaritos pré-cadastrados com QR Code único';
COMMENT ON COLUMN answer_sheet_students.sheet_code IS 'Código único do QR Code (formato: XTRI-XXXXXX)';
COMMENT ON COLUMN answer_sheet_students.answers IS 'Array JSON de respostas após leitura OMR';

-- ============================================================
-- ÍNDICES
-- ============================================================

-- Index para lookup rápido do QR Code (crítico para performance)
CREATE INDEX IF NOT EXISTS idx_answer_sheet_students_sheet_code
    ON answer_sheet_students(sheet_code);

-- Index para buscar alunos por lote
CREATE INDEX IF NOT EXISTS idx_answer_sheet_students_batch_id
    ON answer_sheet_students(batch_id);

-- Index para buscar lotes por escola
CREATE INDEX IF NOT EXISTS idx_answer_sheet_batches_school_id
    ON answer_sheet_batches(school_id);

-- Index para buscar lotes por prova
CREATE INDEX IF NOT EXISTS idx_answer_sheet_batches_exam_id
    ON answer_sheet_batches(exam_id);

-- ============================================================
-- TRIGGERS PARA UPDATED_AT
-- ============================================================

-- Trigger para answer_sheet_batches
CREATE OR REPLACE FUNCTION update_answer_sheet_batches_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_answer_sheet_batches_updated_at ON answer_sheet_batches;
CREATE TRIGGER trigger_answer_sheet_batches_updated_at
    BEFORE UPDATE ON answer_sheet_batches
    FOR EACH ROW
    EXECUTE FUNCTION update_answer_sheet_batches_updated_at();

-- Trigger para answer_sheet_students
CREATE OR REPLACE FUNCTION update_answer_sheet_students_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_answer_sheet_students_updated_at ON answer_sheet_students;
CREATE TRIGGER trigger_answer_sheet_students_updated_at
    BEFORE UPDATE ON answer_sheet_students
    FOR EACH ROW
    EXECUTE FUNCTION update_answer_sheet_students_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================

-- Habilitar RLS
ALTER TABLE answer_sheet_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE answer_sheet_students ENABLE ROW LEVEL SECURITY;

-- Policies para answer_sheet_batches
-- Admins podem ver/editar tudo
CREATE POLICY "Admins full access to batches"
    ON answer_sheet_batches
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );

-- Coordenadores podem ver/editar lotes da própria escola
CREATE POLICY "Coordinators manage school batches"
    ON answer_sheet_batches
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'coordinator'
            AND profiles.school_id = answer_sheet_batches.school_id
        )
    );

-- Professores podem ver lotes da própria escola
CREATE POLICY "Teachers view school batches"
    ON answer_sheet_batches
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'teacher'
            AND profiles.school_id = answer_sheet_batches.school_id
        )
    );

-- Policies para answer_sheet_students
-- Admins podem ver/editar tudo
CREATE POLICY "Admins full access to sheet students"
    ON answer_sheet_students
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );

-- Coordenadores podem ver/editar alunos de lotes da própria escola
CREATE POLICY "Coordinators manage school sheet students"
    ON answer_sheet_students
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM answer_sheet_batches b
            JOIN profiles p ON p.id = auth.uid()
            WHERE b.id = answer_sheet_students.batch_id
            AND p.role = 'coordinator'
            AND p.school_id = b.school_id
        )
    );

-- Professores podem ver alunos de lotes da própria escola
CREATE POLICY "Teachers view school sheet students"
    ON answer_sheet_students
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM answer_sheet_batches b
            JOIN profiles p ON p.id = auth.uid()
            WHERE b.id = answer_sheet_students.batch_id
            AND p.role = 'teacher'
            AND p.school_id = b.school_id
        )
    );

-- Service role bypass (para o backend)
CREATE POLICY "Service role full access batches"
    ON answer_sheet_batches
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role full access students"
    ON answer_sheet_students
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================
-- GRANT PERMISSIONS
-- ============================================================

GRANT ALL ON answer_sheet_batches TO authenticated;
GRANT ALL ON answer_sheet_batches TO service_role;
GRANT ALL ON answer_sheet_students TO authenticated;
GRANT ALL ON answer_sheet_students TO service_role;
