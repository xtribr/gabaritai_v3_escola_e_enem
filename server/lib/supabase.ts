import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../shared/database.types';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabaseAdmin = createClient<Database>(supabaseUrl, supabaseServiceKey);
