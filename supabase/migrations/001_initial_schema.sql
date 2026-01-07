-- ============================================================================
-- GABARITAI v3 - SUPABASE SCHEMA
-- ============================================================================

-- 1. ESCOLAS
CREATE TABLE IF NOT EXISTS schools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. PERFIS (extende auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'teacher', 'student')),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  student_number TEXT,
  turma TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_school ON profiles(school_id);
CREATE INDEX IF NOT EXISTS idx_profiles_student_number ON profiles(school_id, student_number);

-- 3. PROVAS
CREATE TABLE IF NOT EXISTS exams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  created_by UUID REFERENCES profiles(id),
  title TEXT NOT NULL,
  template_type TEXT DEFAULT 'ENEM',
  total_questions INTEGER DEFAULT 45,
  answer_key TEXT[],
  question_contents JSONB,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exams_school ON exams(school_id);

-- 4. RESPOSTAS DOS ALUNOS
CREATE TABLE IF NOT EXISTS student_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_name TEXT NOT NULL,
  student_number TEXT,
  turma TEXT,
  answers TEXT[] NOT NULL,
  score DECIMAL(5,2),
  correct_answers INTEGER,
  wrong_answers INTEGER,
  blank_answers INTEGER,
  tri_theta DECIMAL(6,3),
  tri_score DECIMAL(6,2),
  tri_lc DECIMAL(6,2),
  tri_ch DECIMAL(6,2),
  tri_cn DECIMAL(6,2),
  tri_mt DECIMAL(6,2),
  confidence DECIMAL(5,2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(exam_id, student_number)
);

CREATE INDEX IF NOT EXISTS idx_answers_exam ON student_answers(exam_id);
CREATE INDEX IF NOT EXISTS idx_answers_student ON student_answers(student_id);
CREATE INDEX IF NOT EXISTS idx_answers_school ON student_answers(school_id);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_answers ENABLE ROW LEVEL SECURITY;

-- SCHOOLS
CREATE POLICY "Users view their school" ON schools FOR SELECT
  USING (id IN (SELECT school_id FROM profiles WHERE id = auth.uid()));

-- PROFILES
CREATE POLICY "Users view profiles in school" ON profiles FOR SELECT
  USING (school_id IN (SELECT school_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users update own profile" ON profiles FOR UPDATE
  USING (id = auth.uid());

-- EXAMS
CREATE POLICY "Users view exams in school" ON exams FOR SELECT
  USING (school_id IN (SELECT school_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Admins manage exams" ON exams FOR ALL
  USING (school_id IN (
    SELECT school_id FROM profiles
    WHERE id = auth.uid() AND role IN ('admin', 'teacher')
  ));

-- STUDENT_ANSWERS
CREATE POLICY "Admins view all answers" ON student_answers FOR SELECT
  USING (school_id IN (
    SELECT school_id FROM profiles
    WHERE id = auth.uid() AND role IN ('admin', 'teacher')
  ));

CREATE POLICY "Students view own answers" ON student_answers FOR SELECT
  USING (student_id = auth.uid());

CREATE POLICY "Admins manage answers" ON student_answers FOR INSERT
  WITH CHECK (school_id IN (
    SELECT school_id FROM profiles
    WHERE id = auth.uid() AND role IN ('admin', 'teacher')
  ));

CREATE POLICY "Admins update answers" ON student_answers FOR UPDATE
  USING (school_id IN (
    SELECT school_id FROM profiles
    WHERE id = auth.uid() AND role IN ('admin', 'teacher')
  ));

-- ============================================================================
-- TRIGGER: Criar profile após signup
-- ============================================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, name, role, school_id, student_number, turma)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'student'),
    (NEW.raw_user_meta_data->>'school_id')::UUID,
    NEW.raw_user_meta_data->>'student_number',
    NEW.raw_user_meta_data->>'turma'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================================
-- ESCOLA DEMO
-- ============================================================================

INSERT INTO schools (id, name, slug)
VALUES ('00000000-0000-0000-0000-000000000001', 'Escola Demo XTRI', 'demo')
ON CONFLICT (slug) DO NOTHING;
