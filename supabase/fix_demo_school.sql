-- Execute este SQL no Supabase Dashboard → SQL Editor

-- Inserir escola demo (ignora se já existir)
INSERT INTO schools (id, name, slug)
VALUES ('00000000-0000-0000-0000-000000000001', 'Escola Demo XTRI', 'demo')
ON CONFLICT (id) DO NOTHING;

-- Verificar se foi inserido
SELECT * FROM schools;
