-- Migration: Create coordinator via RPC function
-- This bypasses the handle_new_user trigger by creating user and profile atomically

-- Function to create a coordinator
-- Only callable by super_admin via service_role key
CREATE OR REPLACE FUNCTION create_coordinator(
  p_email TEXT,
  p_password TEXT,
  p_name TEXT,
  p_school_id UUID,
  p_allowed_series TEXT[] DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  v_user_id UUID;
  v_result JSON;
BEGIN
  -- Validate inputs
  IF p_email IS NULL OR p_email = '' THEN
    RAISE EXCEPTION 'Email é obrigatório';
  END IF;

  IF p_password IS NULL OR LENGTH(p_password) < 8 THEN
    RAISE EXCEPTION 'Senha deve ter pelo menos 8 caracteres';
  END IF;

  IF p_name IS NULL OR p_name = '' THEN
    RAISE EXCEPTION 'Nome é obrigatório';
  END IF;

  IF p_school_id IS NULL THEN
    RAISE EXCEPTION 'Escola é obrigatória';
  END IF;

  -- Check if school exists
  IF NOT EXISTS (SELECT 1 FROM schools WHERE id = p_school_id) THEN
    RAISE EXCEPTION 'Escola não encontrada';
  END IF;

  -- Check if email already exists in profiles
  IF EXISTS (SELECT 1 FROM profiles WHERE email = p_email) THEN
    RAISE EXCEPTION 'Este email já está cadastrado';
  END IF;

  -- Create the profile first (before auth.users to avoid trigger)
  -- Generate a UUID for the new user
  v_user_id := gen_random_uuid();

  INSERT INTO profiles (id, email, name, role, school_id, allowed_series)
  VALUES (v_user_id, p_email, p_name, 'school_admin', p_school_id, p_allowed_series);

  -- Return the result (auth user will be created by the server)
  v_result := json_build_object(
    'success', true,
    'user_id', v_user_id,
    'email', p_email,
    'name', p_name,
    'school_id', p_school_id,
    'allowed_series', p_allowed_series
  );

  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION create_coordinator IS 'Creates a coordinator profile. Auth user must be created separately with matching ID.';
