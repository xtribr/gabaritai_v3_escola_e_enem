-- =============================================================================
-- GabaritAI - Arquitetura de 3 Níveis de Acesso
-- =============================================================================
-- PERFIL 1: SUPER_ADMIN (Xandão / XTRI) - Administrador da plataforma
-- PERFIL 2: SCHOOL_ADMIN (Coordenador/Diretor) - Funcionário da escola
-- PERFIL 3: STUDENT (Aluno) - Aluno de uma escola
-- =============================================================================

-- 1. GARANTIR QUE A TABELA SCHOOLS EXISTE E TEM TODAS AS COLUNAS
-- =============================================================================
CREATE TABLE IF NOT EXISTS schools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  cnpj TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  logo_url TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Adicionar colunas que podem estar faltando (se tabela já existia)
DO $$
BEGIN
  -- active
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'schools' AND column_name = 'active') THEN
    ALTER TABLE schools ADD COLUMN active BOOLEAN DEFAULT true;
  END IF;
  -- cnpj
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'schools' AND column_name = 'cnpj') THEN
    ALTER TABLE schools ADD COLUMN cnpj TEXT;
  END IF;
  -- address
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'schools' AND column_name = 'address') THEN
    ALTER TABLE schools ADD COLUMN address TEXT;
  END IF;
  -- city
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'schools' AND column_name = 'city') THEN
    ALTER TABLE schools ADD COLUMN city TEXT;
  END IF;
  -- state
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'schools' AND column_name = 'state') THEN
    ALTER TABLE schools ADD COLUMN state TEXT;
  END IF;
  -- contact_email
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'schools' AND column_name = 'contact_email') THEN
    ALTER TABLE schools ADD COLUMN contact_email TEXT;
  END IF;
  -- contact_phone
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'schools' AND column_name = 'contact_phone') THEN
    ALTER TABLE schools ADD COLUMN contact_phone TEXT;
  END IF;
  -- logo_url
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'schools' AND column_name = 'logo_url') THEN
    ALTER TABLE schools ADD COLUMN logo_url TEXT;
  END IF;
  -- updated_at
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'schools' AND column_name = 'updated_at') THEN
    ALTER TABLE schools ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;

-- Índices para schools
CREATE INDEX IF NOT EXISTS idx_schools_slug ON schools(slug);
CREATE INDEX IF NOT EXISTS idx_schools_active ON schools(active);

-- 2. MIGRAR ROLES EXISTENTES
-- =============================================================================
-- Atualizar constraint do role
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

-- Migrar dados: admin -> super_admin, teacher -> school_admin
UPDATE profiles SET role = 'super_admin' WHERE role = 'admin';
UPDATE profiles SET role = 'school_admin' WHERE role = 'teacher';

-- Adicionar nova constraint
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('super_admin', 'school_admin', 'student'));

-- 3. GARANTIR CAMPOS NECESSÁRIOS NA TABELA PROFILES
-- =============================================================================
-- Garantir que school_id existe e tem FK
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'school_id'
  ) THEN
    ALTER TABLE profiles ADD COLUMN school_id UUID REFERENCES schools(id);
  END IF;
END $$;

-- Índice para school_id
CREATE INDEX IF NOT EXISTS idx_profiles_school_id ON profiles(school_id);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);

-- 4. REMOVER POLÍTICAS RLS ANTIGAS
-- =============================================================================
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON profiles;
DROP POLICY IF EXISTS "Admins can manage all profiles" ON profiles;
DROP POLICY IF EXISTS "profiles_select_policy" ON profiles;
DROP POLICY IF EXISTS "profiles_insert_policy" ON profiles;
DROP POLICY IF EXISTS "profiles_update_policy" ON profiles;
DROP POLICY IF EXISTS "profiles_delete_policy" ON profiles;

DROP POLICY IF EXISTS "student_answers_select_policy" ON student_answers;
DROP POLICY IF EXISTS "student_answers_insert_policy" ON student_answers;
DROP POLICY IF EXISTS "student_answers_update_policy" ON student_answers;
DROP POLICY IF EXISTS "student_answers_delete_policy" ON student_answers;

DROP POLICY IF EXISTS "exams_select_policy" ON exams;
DROP POLICY IF EXISTS "exams_insert_policy" ON exams;
DROP POLICY IF EXISTS "exams_update_policy" ON exams;
DROP POLICY IF EXISTS "exams_delete_policy" ON exams;

DROP POLICY IF EXISTS "schools_select_policy" ON schools;
DROP POLICY IF EXISTS "schools_insert_policy" ON schools;
DROP POLICY IF EXISTS "schools_update_policy" ON schools;
DROP POLICY IF EXISTS "schools_delete_policy" ON schools;

-- 5. HABILITAR RLS
-- =============================================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE exams ENABLE ROW LEVEL SECURITY;

-- 6. FUNÇÃO AUXILIAR PARA VERIFICAR ROLE
-- =============================================================================
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION get_user_school_id()
RETURNS UUID AS $$
  SELECT school_id FROM profiles WHERE id = auth.uid();
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin');
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- 7. POLÍTICAS RLS PARA SCHOOLS
-- =============================================================================
-- SUPER_ADMIN: acesso total
CREATE POLICY "super_admin_full_access_schools" ON schools
  FOR ALL USING (is_super_admin());

-- SCHOOL_ADMIN: pode ver apenas sua escola
CREATE POLICY "school_admin_view_own_school" ON schools
  FOR SELECT USING (id = get_user_school_id());

-- STUDENT: pode ver apenas sua escola
CREATE POLICY "student_view_own_school" ON schools
  FOR SELECT USING (id = get_user_school_id());

-- 8. POLÍTICAS RLS PARA PROFILES
-- =============================================================================
-- SUPER_ADMIN: acesso total a todos os perfis
CREATE POLICY "super_admin_full_access_profiles" ON profiles
  FOR ALL USING (is_super_admin());

-- SCHOOL_ADMIN: pode ver perfis da sua escola
CREATE POLICY "school_admin_view_school_profiles" ON profiles
  FOR SELECT USING (
    school_id = get_user_school_id()
    AND get_user_role() = 'school_admin'
  );

-- STUDENT: pode ver apenas seu próprio perfil
CREATE POLICY "student_view_own_profile" ON profiles
  FOR SELECT USING (
    id = auth.uid()
    AND get_user_role() = 'student'
  );

-- Todos podem atualizar seu próprio perfil (campos limitados)
CREATE POLICY "users_update_own_profile" ON profiles
  FOR UPDATE USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- 9. POLÍTICAS RLS PARA STUDENT_ANSWERS
-- =============================================================================
-- SUPER_ADMIN: acesso total
CREATE POLICY "super_admin_full_access_answers" ON student_answers
  FOR ALL USING (is_super_admin());

-- SCHOOL_ADMIN: pode ver respostas dos alunos da sua escola
CREATE POLICY "school_admin_view_school_answers" ON student_answers
  FOR SELECT USING (
    school_id = get_user_school_id()
    AND get_user_role() = 'school_admin'
  );

-- STUDENT: pode ver apenas suas próprias respostas
CREATE POLICY "student_view_own_answers" ON student_answers
  FOR SELECT USING (
    student_id = auth.uid()
    AND get_user_role() = 'student'
  );

-- 10. POLÍTICAS RLS PARA EXAMS (se existir)
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'exams') THEN
    -- SUPER_ADMIN: acesso total
    EXECUTE 'CREATE POLICY "super_admin_full_access_exams" ON exams FOR ALL USING (is_super_admin())';

    -- SCHOOL_ADMIN: pode ver exames da sua escola
    EXECUTE 'CREATE POLICY "school_admin_view_school_exams" ON exams FOR SELECT USING (school_id = get_user_school_id() AND get_user_role() = ''school_admin'')';

    -- STUDENT: pode ver exames da sua escola
    EXECUTE 'CREATE POLICY "student_view_school_exams" ON exams FOR SELECT USING (school_id = get_user_school_id() AND get_user_role() = ''student'')';
  END IF;
END $$;

-- 11. CRIAR ESCOLA DEMO SE NÃO EXISTIR
-- =============================================================================
INSERT INTO schools (id, name, slug, contact_email)
SELECT
  '00000000-0000-0000-0000-000000000001'::uuid,
  'Escola Demo',
  'demo',
  'demo@gabaritai.com'
WHERE NOT EXISTS (SELECT 1 FROM schools WHERE slug = 'demo');

-- 12. TRIGGER PARA ATUALIZAR updated_at
-- =============================================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS schools_updated_at ON schools;
CREATE TRIGGER schools_updated_at
  BEFORE UPDATE ON schools
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- 13. COMENTÁRIOS PARA DOCUMENTAÇÃO
-- =============================================================================
COMMENT ON TABLE schools IS 'Escolas cadastradas na plataforma GabaritAI';
COMMENT ON COLUMN profiles.role IS 'Nível de acesso: super_admin, school_admin, student';
COMMENT ON COLUMN profiles.school_id IS 'Escola do usuário (null apenas para super_admin)';

-- 14. GRANT PERMISSIONS
-- =============================================================================
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;
