-- Script para criar coordenadores de teste
-- Executar no Supabase SQL Editor

-- 1. Coordenador da 3ª Série
UPDATE profiles
SET allowed_series = ARRAY['3ª Série']
WHERE email = 'coordenador3serie@escola.com';

-- 2. Coordenador do Ensino Médio (1ª e 2ª Série)
UPDATE profiles
SET allowed_series = ARRAY['1ª Série', '2ª Série']
WHERE email = 'coordenadorEM@escola.com';

-- 3. Coordenador Geral (acesso total) - deixar NULL
UPDATE profiles
SET allowed_series = NULL
WHERE email = 'coordenacao@literato.edu.br';

-- Verificar configuração
SELECT email, name, role, allowed_series
FROM profiles
WHERE role = 'school_admin';
