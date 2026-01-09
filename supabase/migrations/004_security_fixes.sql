-- ============================================================================
-- MIGRATION 004: Security Fixes
-- Corrige vulnerabilidades críticas de segurança
-- ============================================================================

-- ============================================================================
-- 1. ADICIONAR school_id À TABELA PROJETOS
-- ============================================================================

-- Adicionar coluna school_id (nullable inicialmente para não quebrar dados existentes)
ALTER TABLE projetos ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id) ON DELETE CASCADE;

-- Criar índice para performance
CREATE INDEX IF NOT EXISTS idx_projetos_school ON projetos(school_id);

-- ============================================================================
-- 2. CORRIGIR POLICIES DA TABELA PROJETOS
-- ============================================================================

-- Remover policy insegura que permite acesso total
DROP POLICY IF EXISTS "Service role full access" ON projetos;

-- Super admin tem acesso total
CREATE POLICY "super_admin_full_access_projetos" ON projetos
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  );

-- School admin acessa apenas projetos da própria escola
CREATE POLICY "school_admin_access_projetos" ON projetos
  FOR ALL
  USING (
    school_id IN (
      SELECT school_id FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'school_admin'
    )
  )
  WITH CHECK (
    school_id IN (
      SELECT school_id FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'school_admin'
    )
  );

-- Projetos sem school_id são acessíveis apenas por super_admin (legado)
CREATE POLICY "legacy_projetos_super_admin_only" ON projetos
  FOR ALL
  USING (
    school_id IS NULL
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  );

-- ============================================================================
-- 3. ADICIONAR POLICY DELETE PARA STUDENT_ANSWERS
-- ============================================================================

-- Verificar se a policy já existe antes de criar
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'student_answers'
    AND policyname = 'Admins delete answers'
  ) THEN
    CREATE POLICY "Admins delete answers" ON student_answers
      FOR DELETE
      USING (
        school_id IN (
          SELECT school_id FROM profiles
          WHERE profiles.id = auth.uid()
          AND profiles.role IN ('super_admin', 'school_admin')
        )
      );
  END IF;
END $$;

-- ============================================================================
-- 4. CORRIGIR TRIGGER handle_new_user COM VALIDAÇÃO
-- ============================================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_school_id UUID;
  v_role TEXT;
  v_name TEXT;
  v_student_number TEXT;
  v_turma TEXT;
BEGIN
  -- Validar e sanitizar role (apenas valores permitidos)
  v_role := LOWER(COALESCE(NEW.raw_user_meta_data->>'role', 'student'));
  IF v_role NOT IN ('super_admin', 'school_admin', 'student') THEN
    v_role := 'student'; -- Default seguro
  END IF;

  -- Validar school_id se fornecido
  v_school_id := NULL;
  IF NEW.raw_user_meta_data->>'school_id' IS NOT NULL
     AND NEW.raw_user_meta_data->>'school_id' != '' THEN
    BEGIN
      v_school_id := (NEW.raw_user_meta_data->>'school_id')::UUID;
      -- Verificar se escola existe
      IF NOT EXISTS (SELECT 1 FROM schools WHERE id = v_school_id) THEN
        v_school_id := NULL;
        RAISE WARNING 'School ID não encontrado: %', NEW.raw_user_meta_data->>'school_id';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_school_id := NULL;
      RAISE WARNING 'School ID inválido: %', NEW.raw_user_meta_data->>'school_id';
    END;
  END IF;

  -- Sanitizar campos de texto (limitar tamanho e remover caracteres perigosos)
  v_name := SUBSTRING(
    REGEXP_REPLACE(
      COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
      '[<>"\''`;]', '', 'g'
    ), 1, 255
  );

  v_student_number := SUBSTRING(
    REGEXP_REPLACE(
      COALESCE(NEW.raw_user_meta_data->>'student_number', ''),
      '[^a-zA-Z0-9\-_]', '', 'g'
    ), 1, 50
  );

  v_turma := SUBSTRING(
    REGEXP_REPLACE(
      COALESCE(NEW.raw_user_meta_data->>'turma', ''),
      '[<>"\''`;]', '', 'g'
    ), 1, 50
  );

  -- Inserir profile com dados validados
  INSERT INTO profiles (id, email, name, role, school_id, student_number, turma)
  VALUES (
    NEW.id,
    NEW.email,
    v_name,
    v_role,
    v_school_id,
    NULLIF(v_student_number, ''),
    NULLIF(v_turma, '')
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Log do erro mas não falha o signup
  RAISE WARNING 'Erro ao criar profile para usuário %: %', NEW.id, SQLERRM;
  -- Criar profile mínimo
  INSERT INTO profiles (id, email, name, role)
  VALUES (NEW.id, NEW.email, split_part(NEW.email, '@', 1), 'student');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 5. ADICIONAR CONSTRAINTS DE SEGURANÇA
-- ============================================================================

-- Garantir que role só pode ter valores válidos
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'profiles' AND constraint_name = 'profiles_role_check'
  ) THEN
    ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
      CHECK (role IN ('super_admin', 'school_admin', 'student'));
  END IF;
END $$;

-- ============================================================================
-- 6. REVOGAR PERMISSÕES EXCESSIVAS DO ROLE anon
-- ============================================================================

-- Revogar ALL do anon (manter apenas o necessário)
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

-- anon só pode fazer SELECT em tabelas públicas necessárias para signup
-- (na prática, o signup usa service_role via backend)

-- ============================================================================
-- COMENTÁRIOS E DOCUMENTAÇÃO
-- ============================================================================

COMMENT ON POLICY "super_admin_full_access_projetos" ON projetos IS 'Super admin tem acesso total a todos os projetos';
COMMENT ON POLICY "school_admin_access_projetos" ON projetos IS 'School admin só acessa projetos da própria escola';
COMMENT ON POLICY "Admins delete answers" ON student_answers IS 'Apenas admins podem deletar respostas de alunos';
COMMENT ON FUNCTION handle_new_user() IS 'Trigger para criar profile com validação de inputs - SECURITY DEFINER';
