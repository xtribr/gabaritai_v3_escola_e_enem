-- Migration: Update handle_new_user trigger to support allowed_series
-- This fixes the coordinator creation flow to properly set allowed_series

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_school_id UUID;
  v_role TEXT;
  v_name TEXT;
  v_student_number TEXT;
  v_turma TEXT;
  v_allowed_series TEXT[];
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
      '[<>"'';`]', '', 'g'
    ), 1, 255
  );

  v_student_number := SUBSTRING(
    REGEXP_REPLACE(
      COALESCE(NEW.raw_user_meta_data->>'student_number', ''),
      '[^a-zA-Z0-9_-]', '', 'g'
    ), 1, 50
  );

  v_turma := SUBSTRING(
    REGEXP_REPLACE(
      COALESCE(NEW.raw_user_meta_data->>'turma', ''),
      '[<>"'';`]', '', 'g'
    ), 1, 50
  );

  -- Parse allowed_series from JSON array in user_metadata
  v_allowed_series := NULL;
  IF NEW.raw_user_meta_data->'allowed_series' IS NOT NULL
     AND jsonb_typeof(NEW.raw_user_meta_data->'allowed_series') = 'array' THEN
    SELECT ARRAY_AGG(elem::TEXT)
    INTO v_allowed_series
    FROM jsonb_array_elements_text(NEW.raw_user_meta_data->'allowed_series') AS elem;
  END IF;

  -- Inserir profile com dados validados
  INSERT INTO profiles (id, email, name, role, school_id, student_number, turma, allowed_series)
  VALUES (
    NEW.id,
    NEW.email,
    v_name,
    v_role,
    v_school_id,
    NULLIF(v_student_number, ''),
    NULLIF(v_turma, ''),
    v_allowed_series
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

COMMENT ON FUNCTION handle_new_user() IS 'Trigger para criar profile com validação de inputs e suporte a allowed_series - SECURITY DEFINER';
