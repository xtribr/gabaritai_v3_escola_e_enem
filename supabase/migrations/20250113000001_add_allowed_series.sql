-- Migration: Add allowed_series column to profiles table
-- This enables segmented coordinator access (e.g., only 3rd grade or only 1st/2nd grade)

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS allowed_series text[] DEFAULT NULL;

-- NULL means unrestricted access (super_admin or legacy school_admin)
-- Example values:
--   ['3ª Série'] - Coordinator for 3rd grade only
--   ['1ª Série', '2ª Série'] - Coordinator for 1st and 2nd grade
--   NULL - Full access (super_admin or school-wide coordinator)

COMMENT ON COLUMN profiles.allowed_series IS 'Array of series/grades this coordinator can access. NULL = unrestricted.';
