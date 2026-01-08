import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load env file
const envPath = path.join(__dirname, '..', '.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const envVars = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) {
    envVars[match[1]] = match[2];
  }
});

const SUPABASE_URL = envVars.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = envVars.SUPABASE_SERVICE_KEY;

console.log('URL:', SUPABASE_URL);
console.log('Key:', SUPABASE_SERVICE_KEY ? SUPABASE_SERVICE_KEY.substring(0, 30) + '...' : 'NOT SET');

if (!SUPABASE_SERVICE_KEY) {
  console.error('SUPABASE_SERVICE_KEY not found in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false }
});

async function checkState() {
  console.log('\n=== Current Profiles ===');
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, role')
    .limit(5);

  if (error) {
    console.log('Error:', error.message);
  } else {
    data.forEach(p => console.log('  -', p.name, ':', p.role));
  }

  console.log('\n=== Schools Table ===');
  const { data: schools, error: schoolsErr } = await supabase
    .from('schools')
    .select('*')
    .limit(1);

  if (schoolsErr) {
    console.log('Status:', schoolsErr.message);
    return false;
  } else {
    console.log('Exists, rows:', schools.length);
    if (schools.length > 0) {
      console.log('Sample:', schools[0]);
    }
    return true;
  }
}

async function runMigration() {
  console.log('\n=== Running Migration ===\n');

  // Since we can't run raw SQL via supabase-js, we need to do what we can via the API
  // The main things we need to do:
  // 1. Update existing profiles roles (admin -> super_admin, teacher -> school_admin)

  // Update admin -> super_admin
  console.log('1. Updating admin -> super_admin...');
  const { error: e1 } = await supabase
    .from('profiles')
    .update({ role: 'super_admin' })
    .eq('role', 'admin');
  console.log(e1 ? `   Error: ${e1.message}` : '   Done');

  // Update teacher -> school_admin
  console.log('2. Updating teacher -> school_admin...');
  const { error: e2 } = await supabase
    .from('profiles')
    .update({ role: 'school_admin' })
    .eq('role', 'teacher');
  console.log(e2 ? `   Error: ${e2.message}` : '   Done');

  // Check if demo school exists
  console.log('3. Checking demo school...');
  const { data: existingSchool } = await supabase
    .from('schools')
    .select('id')
    .eq('slug', 'demo')
    .single();

  if (!existingSchool) {
    console.log('   Creating demo school...');
    const { error: e3 } = await supabase
      .from('schools')
      .insert({
        id: '00000000-0000-0000-0000-000000000001',
        name: 'Escola Demo',
        slug: 'demo',
        contact_email: 'demo@gabaritai.com'
      });
    console.log(e3 ? `   Error: ${e3.message}` : '   Done');
  } else {
    console.log('   Demo school already exists');
  }

  console.log('\n=== Migration Complete ===');
}

async function main() {
  const schoolsExist = await checkState();

  if (!schoolsExist) {
    console.log('\n⚠️  Schools table does not exist!');
    console.log('You need to run the full SQL migration in Supabase Dashboard.');
    console.log('\nCopy the content of: supabase/migrations/002_role_architecture.sql');
    console.log('And paste it in: https://supabase.com/dashboard/project/axtmozyrnsrhqrnktshz/sql/new');
    process.exit(1);
  }

  await runMigration();
  await checkState();
}

main().catch(console.error);
