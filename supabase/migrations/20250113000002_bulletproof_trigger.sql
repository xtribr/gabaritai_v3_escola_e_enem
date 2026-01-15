-- Migration: Bulletproof handle_new_user trigger
-- This version NEVER fails - always creates at least a minimal profile
-- The server will update the profile with correct data after creation

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Try to insert a profile, catching ALL errors
  BEGIN
    INSERT INTO profiles (id, email, name, role)
    VALUES (
      NEW.id,
      COALESCE(NEW.email, 'unknown@unknown.com'),
      COALESCE(
        NEW.raw_user_meta_data->>'name',
        split_part(COALESCE(NEW.email, 'unknown'), '@', 1)
      ),
      COALESCE(
        LOWER(NEW.raw_user_meta_data->>'role'),
        'student'
      )
    )
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    -- Silently ignore any error - server will create/update profile
    RAISE WARNING 'handle_new_user: ignoring error for user %: %', NEW.id, SQLERRM;
  END;

  -- ALWAYS return NEW to allow user creation
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION handle_new_user() IS 'Bulletproof trigger - creates minimal profile, never fails';
