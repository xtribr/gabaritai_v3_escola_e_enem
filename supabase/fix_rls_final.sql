-- Execute este SQL no Supabase Dashboard → SQL Editor
-- Verifica e corrige as políticas RLS da tabela profiles

-- 1. Remove TODAS as políticas existentes
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Users can view school profiles" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Profiles are viewable by users in same school" ON profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON profiles;
DROP POLICY IF EXISTS "profiles_select_own" ON profiles;
DROP POLICY IF EXISTS "profiles_select_school" ON profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
DROP POLICY IF EXISTS "profiles_insert" ON profiles;

-- 2. Certifica que RLS está habilitado
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- 3. Cria política simples e direta para SELECT
CREATE POLICY "profiles_select_own" ON profiles
  FOR SELECT
  USING (id = auth.uid());

-- 4. Cria política para UPDATE
CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE
  USING (id = auth.uid());

-- 5. Cria política para INSERT (trigger precisa disso)
CREATE POLICY "profiles_insert" ON profiles
  FOR INSERT
  WITH CHECK (id = auth.uid());

-- 6. Verificar as políticas criadas
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE tablename = 'profiles';

-- 7. Testar se existe profile para o usuário
-- (substitua o UUID pelo ID do usuário logado se necessário)
SELECT id, name, email, role, school_id FROM profiles LIMIT 5;
