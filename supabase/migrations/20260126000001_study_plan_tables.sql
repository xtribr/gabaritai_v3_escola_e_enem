-- Migration: Create study plan related tables
-- Tables: study_contents, exercise_lists, student_study_plans, student_list_releases, list_downloads

-- ============================================================================
-- 1. study_contents - Content for study plans based on TRI scores
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.study_contents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    area TEXT NOT NULL CHECK (area IN ('LC', 'CH', 'CN', 'MT')),
    habilidade TEXT NOT NULL,
    conteudo TEXT NOT NULL,
    tri_score DECIMAL(6,1) NOT NULL,
    tri_faixa TEXT NOT NULL CHECK (tri_faixa IN ('baixo', 'medio', 'alto')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster queries by area and tri_score
CREATE INDEX IF NOT EXISTS idx_study_contents_area_tri ON public.study_contents(area, tri_score);

-- RLS
ALTER TABLE public.study_contents ENABLE ROW LEVEL SECURITY;

-- Super admins can manage content
CREATE POLICY "Super admins can manage study_contents" ON public.study_contents
    FOR ALL USING (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin')
    );

-- Students and school admins can read
CREATE POLICY "Authenticated users can read study_contents" ON public.study_contents
    FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================================================
-- 2. exercise_lists - Exercise lists categorized by area and TRI range
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.exercise_lists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    area TEXT NOT NULL CHECK (area IN ('LC', 'CH', 'CN', 'MT')),
    tri_min DECIMAL(6,1) NOT NULL,
    tri_max DECIMAL(6,1) NOT NULL,
    titulo TEXT NOT NULL,
    arquivo_url TEXT NOT NULL,
    arquivo_nome TEXT NOT NULL,
    arquivo_tipo TEXT NOT NULL DEFAULT 'application/pdf',
    tamanho_bytes BIGINT,
    ordem INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT valid_tri_range CHECK (tri_min <= tri_max)
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_exercise_lists_area_tri ON public.exercise_lists(area, tri_min, tri_max);

-- RLS
ALTER TABLE public.exercise_lists ENABLE ROW LEVEL SECURITY;

-- Super admins can manage lists
CREATE POLICY "Super admins can manage exercise_lists" ON public.exercise_lists
    FOR ALL USING (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin')
    );

-- Authenticated users can read
CREATE POLICY "Authenticated users can read exercise_lists" ON public.exercise_lists
    FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================================================
-- 3. student_study_plans - Personalized study plans per student/exam/area
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.student_study_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    student_number TEXT,
    exam_id UUID NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
    area TEXT NOT NULL CHECK (area IN ('LC', 'CH', 'CN', 'MT')),
    tri_atual DECIMAL(6,1) NOT NULL,
    tri_faixa TEXT NOT NULL CHECK (tri_faixa IN ('baixo', 'medio', 'alto')),
    conteudos_prioritarios JSONB DEFAULT '[]'::jsonb,
    listas_recomendadas TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_student_exam_area UNIQUE (student_id, exam_id, area)
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_student_study_plans_student ON public.student_study_plans(student_id);
CREATE INDEX IF NOT EXISTS idx_student_study_plans_exam ON public.student_study_plans(exam_id);

-- RLS
ALTER TABLE public.student_study_plans ENABLE ROW LEVEL SECURITY;

-- Students can read their own plans
CREATE POLICY "Students can read own study_plans" ON public.student_study_plans
    FOR SELECT USING (student_id = auth.uid());

-- Students can update their own plans
CREATE POLICY "Students can update own study_plans" ON public.student_study_plans
    FOR UPDATE USING (student_id = auth.uid());

-- Super admins and school admins can manage
CREATE POLICY "Admins can manage study_plans" ON public.student_study_plans
    FOR ALL USING (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('super_admin', 'school_admin'))
    );

-- ============================================================================
-- 4. student_list_releases - Track which lists are released to which students
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.student_list_releases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    exercise_list_id UUID NOT NULL REFERENCES public.exercise_lists(id) ON DELETE CASCADE,
    released_at TIMESTAMPTZ DEFAULT NOW(),
    downloaded_at TIMESTAMPTZ,
    download_count INTEGER DEFAULT 0,
    CONSTRAINT unique_student_list UNIQUE (student_id, exercise_list_id)
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_student_list_releases_student ON public.student_list_releases(student_id);
CREATE INDEX IF NOT EXISTS idx_student_list_releases_list ON public.student_list_releases(exercise_list_id);

-- RLS
ALTER TABLE public.student_list_releases ENABLE ROW LEVEL SECURITY;

-- Students can read their own releases
CREATE POLICY "Students can read own releases" ON public.student_list_releases
    FOR SELECT USING (student_id = auth.uid());

-- Students can update their own releases (for download tracking)
CREATE POLICY "Students can update own releases" ON public.student_list_releases
    FOR UPDATE USING (student_id = auth.uid());

-- Admins can manage releases
CREATE POLICY "Admins can manage releases" ON public.student_list_releases
    FOR ALL USING (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('super_admin', 'school_admin'))
    );

-- ============================================================================
-- 5. list_downloads - Track when students download lists (coordinator reporting)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.list_downloads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    list_id UUID NOT NULL REFERENCES public.exercise_lists(id) ON DELETE CASCADE,
    school_id UUID REFERENCES public.schools(id) ON DELETE SET NULL,
    turma TEXT,
    downloaded_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_student_download UNIQUE (student_id, list_id)
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_list_downloads_school ON public.list_downloads(school_id);
CREATE INDEX IF NOT EXISTS idx_list_downloads_turma ON public.list_downloads(turma);
CREATE INDEX IF NOT EXISTS idx_list_downloads_student ON public.list_downloads(student_id);

-- RLS
ALTER TABLE public.list_downloads ENABLE ROW LEVEL SECURITY;

-- Students can insert and read their own downloads
CREATE POLICY "Students can manage own downloads" ON public.list_downloads
    FOR ALL USING (student_id = auth.uid());

-- School admins can read downloads from their school
CREATE POLICY "School admins can read school downloads" ON public.list_downloads
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = auth.uid()
            AND p.role = 'school_admin'
            AND p.school_id = list_downloads.school_id
        )
    );

-- Super admins can read all
CREATE POLICY "Super admins can read all downloads" ON public.list_downloads
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin')
    );

-- ============================================================================
-- Grant permissions
-- ============================================================================
GRANT ALL ON public.study_contents TO authenticated;
GRANT ALL ON public.exercise_lists TO authenticated;
GRANT ALL ON public.student_study_plans TO authenticated;
GRANT ALL ON public.student_list_releases TO authenticated;
GRANT ALL ON public.list_downloads TO authenticated;
