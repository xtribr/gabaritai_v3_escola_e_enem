-- Add must_change_password column to profiles table
-- This flag forces students to change their password on first login

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT false;

-- Add comment
COMMENT ON COLUMN profiles.must_change_password IS 'When true, user must change password on next login';

-- Set must_change_password to true for all students who have the flag in user_metadata
-- (This syncs existing auth users who were created with must_change_password in metadata)
UPDATE profiles p
SET must_change_password = true
WHERE p.role = 'student'
AND EXISTS (
  SELECT 1 FROM auth.users u
  WHERE u.id = p.id
  AND (u.raw_user_meta_data->>'must_change_password')::boolean = true
);
