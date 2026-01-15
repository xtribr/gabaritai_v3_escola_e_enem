-- Migration: Simplified handle_new_user trigger
-- This version does NOT parse allowed_series - server handles that via UPDATE

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
    v_role := 'student';
  END IF;

  -- Validar school_id se fornecido
  v_school_id := NULL;
  IF NEW.raw_user_meta_data->>'school_id' IS NOT NULL
     AND NEW.raw_user_meta_data->>'school_id' != '' THEN
    BEGIN
      v_school_id := (NEW.raw_user_meta_data->>'school_id')::UUID;
      IF NOT EXISTS (SELECT 1 FROM schools WHERE id = v_school_id) THEN
        v_school_id := NULL;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_school_id := NULL;
    END;
  END IF;

  -- Sanitizar campos de texto
  v_name := SUBSTRING(
    REGEXP_REPLACE(
      COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
      '[<>"''`;]', '', 'g'
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
      '[<>"''`;]', '', 'g'
    ), 1, 50
  );

  -- Inserir profile SEM allowed_series (servidor faz UPDATE depois)
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
  RAISE WARNING 'Erro ao criar profile para usuário %: %', NEW.id, SQLERRM;
  INSERT INTO profiles (id, email, name, role)
  VALUES (NEW.id, NEW.email, split_part(NEW.email, '@', 1), 'student');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
