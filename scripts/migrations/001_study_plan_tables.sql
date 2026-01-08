-- =====================================================
-- MIGRAÇÃO: Plano de Estudos Personalizado por TRI
-- =====================================================

-- 1. Conteúdos ENEM organizados por faixa TRI
CREATE TABLE IF NOT EXISTS study_contents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  area TEXT NOT NULL CHECK (area IN ('LC', 'CH', 'CN', 'MT')),
  habilidade TEXT NOT NULL, -- H1, H2, H3, etc
  conteudo TEXT NOT NULL,
  tri_score DECIMAL(6,1) NOT NULL, -- Score TRI exato do CSV
  tri_faixa TEXT NOT NULL, -- 'baixo' (<500), 'medio' (500-650), 'alto' (>650)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para busca rápida
CREATE INDEX IF NOT EXISTS idx_study_contents_area ON study_contents(area);
CREATE INDEX IF NOT EXISTS idx_study_contents_tri_faixa ON study_contents(tri_faixa);
CREATE INDEX IF NOT EXISTS idx_study_contents_habilidade ON study_contents(habilidade);
CREATE INDEX IF NOT EXISTS idx_study_contents_tri_score ON study_contents(tri_score);

-- 2. Listas de exercícios disponíveis
CREATE TABLE IF NOT EXISTS exercise_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  area TEXT NOT NULL CHECK (area IN ('LC', 'CH', 'CN', 'MT')),
  tri_min INTEGER NOT NULL,
  tri_max INTEGER NOT NULL,
  titulo TEXT NOT NULL,
  arquivo_url TEXT NOT NULL, -- URL no Supabase Storage
  arquivo_nome TEXT NOT NULL,
  arquivo_tipo TEXT DEFAULT 'docx', -- docx, pdf
  tamanho_bytes INTEGER,
  ordem INTEGER DEFAULT 1, -- Ordem dentro da faixa (Lista 1, 2, 3...)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_exercise_lists_area ON exercise_lists(area);
CREATE INDEX IF NOT EXISTS idx_exercise_lists_tri ON exercise_lists(tri_min, tri_max);

-- 3. Plano de estudos gerado para cada aluno
CREATE TABLE IF NOT EXISTS student_study_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  area TEXT NOT NULL CHECK (area IN ('LC', 'CH', 'CN', 'MT')),
  tri_atual DECIMAL(6,1) NOT NULL,
  tri_faixa TEXT NOT NULL,
  conteudos_prioritarios JSONB DEFAULT '[]', -- [{conteudo, habilidade, tri_score}]
  listas_recomendadas JSONB DEFAULT '[]', -- [exercise_list_id, ...]
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(student_id, exam_id, area)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_student_study_plans_student ON student_study_plans(student_id);
CREATE INDEX IF NOT EXISTS idx_student_study_plans_exam ON student_study_plans(exam_id);

-- 4. Controle de liberação de listas por aluno
CREATE TABLE IF NOT EXISTS student_list_releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  exercise_list_id UUID NOT NULL REFERENCES exercise_lists(id) ON DELETE CASCADE,
  released_at TIMESTAMPTZ DEFAULT NOW(),
  downloaded_at TIMESTAMPTZ,
  download_count INTEGER DEFAULT 0,
  UNIQUE(student_id, exercise_list_id)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_student_list_releases_student ON student_list_releases(student_id);

-- 5. Função para determinar faixa TRI
CREATE OR REPLACE FUNCTION get_tri_faixa(tri_score DECIMAL)
RETURNS TEXT AS $$
BEGIN
  IF tri_score < 500 THEN
    RETURN 'baixo';
  ELSIF tri_score < 650 THEN
    RETURN 'medio';
  ELSE
    RETURN 'alto';
  END IF;
END;
$$ LANGUAGE plpgsql;

-- 6. RLS Policies (Row Level Security)

-- study_contents: leitura pública (conteúdo educacional)
ALTER TABLE study_contents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "study_contents_select_all" ON study_contents FOR SELECT USING (true);

-- exercise_lists: leitura pública
ALTER TABLE exercise_lists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "exercise_lists_select_all" ON exercise_lists FOR SELECT USING (true);

-- student_study_plans: aluno vê apenas seu próprio plano
ALTER TABLE student_study_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "student_study_plans_select_own" ON student_study_plans
  FOR SELECT USING (auth.uid() = student_id);
CREATE POLICY "student_study_plans_insert_service" ON student_study_plans
  FOR INSERT WITH CHECK (true); -- Service role only
CREATE POLICY "student_study_plans_update_service" ON student_study_plans
  FOR UPDATE USING (true); -- Service role only

-- student_list_releases: aluno vê apenas suas liberações
ALTER TABLE student_list_releases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "student_list_releases_select_own" ON student_list_releases
  FOR SELECT USING (auth.uid() = student_id);
CREATE POLICY "student_list_releases_insert_service" ON student_list_releases
  FOR INSERT WITH CHECK (true); -- Service role only
CREATE POLICY "student_list_releases_update_own" ON student_list_releases
  FOR UPDATE USING (auth.uid() = student_id);

-- =====================================================
-- COMENTÁRIOS PARA DOCUMENTAÇÃO
-- =====================================================
COMMENT ON TABLE study_contents IS 'Conteúdos ENEM organizados por área, habilidade e faixa TRI';
COMMENT ON TABLE exercise_lists IS 'Listas de exercícios em PDF/DOCX organizadas por área e faixa TRI';
COMMENT ON TABLE student_study_plans IS 'Plano de estudos personalizado gerado para cada aluno baseado no TRI';
COMMENT ON TABLE student_list_releases IS 'Controle de quais listas foram liberadas para cada aluno';
