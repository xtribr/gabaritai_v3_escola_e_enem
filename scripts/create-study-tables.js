/**
 * Criar tabelas do Plano de Estudos no Supabase
 * Executa: node scripts/create-study-tables.js
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function createTables() {
  console.log('🚀 Criando tabelas do Plano de Estudos...\n');

  // SQL para criar tabelas (sem RLS para simplificar)
  const createSQL = `
    -- 1. study_contents
    CREATE TABLE IF NOT EXISTS study_contents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      area TEXT NOT NULL,
      habilidade TEXT NOT NULL,
      conteudo TEXT NOT NULL,
      tri_score DECIMAL(6,1) NOT NULL,
      tri_faixa TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- 2. exercise_lists
    CREATE TABLE IF NOT EXISTS exercise_lists (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      area TEXT NOT NULL,
      tri_min INTEGER NOT NULL,
      tri_max INTEGER NOT NULL,
      titulo TEXT NOT NULL,
      arquivo_url TEXT NOT NULL,
      arquivo_nome TEXT NOT NULL,
      arquivo_tipo TEXT DEFAULT 'docx',
      tamanho_bytes INTEGER,
      ordem INTEGER DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- 3. student_study_plans
    CREATE TABLE IF NOT EXISTS student_study_plans (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID NOT NULL,
      exam_id UUID NOT NULL,
      area TEXT NOT NULL,
      tri_atual DECIMAL(6,1) NOT NULL,
      tri_faixa TEXT NOT NULL,
      conteudos_prioritarios JSONB DEFAULT '[]',
      listas_recomendadas JSONB DEFAULT '[]',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- 4. student_list_releases
    CREATE TABLE IF NOT EXISTS student_list_releases (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID NOT NULL,
      exercise_list_id UUID NOT NULL,
      released_at TIMESTAMPTZ DEFAULT NOW(),
      downloaded_at TIMESTAMPTZ,
      download_count INTEGER DEFAULT 0,
      UNIQUE(student_id, exercise_list_id)
    );
  `;

  // Tentar criar via pg-meta (funciona em alguns projetos Supabase)
  try {
    // Verificar se tabelas existem tentando inserir
    const { data, error } = await supabase
      .from('study_contents')
      .select('id')
      .limit(1);

    if (error && error.code === '42P01') {
      console.log('❌ Tabelas não existem.');
      console.log('\n📋 Execute o seguinte SQL no Supabase Dashboard:\n');
      console.log('URL: https://supabase.com/dashboard/project/axtmozyrnsrhqrnktshz/sql/new\n');
      console.log('--- COPIE A PARTIR DAQUI ---\n');
      console.log(createSQL);
      console.log('\n--- ATÉ AQUI ---\n');
    } else if (error) {
      console.log('⚠️  Erro:', error.message);
    } else {
      console.log('✅ Tabela study_contents já existe!');
    }

    // Verificar outras tabelas
    const tables = ['exercise_lists', 'student_study_plans', 'student_list_releases'];
    for (const table of tables) {
      const { error: err } = await supabase.from(table).select('id').limit(1);
      if (err && err.code === '42P01') {
        console.log(`❌ ${table} não existe`);
      } else if (!err) {
        console.log(`✅ ${table} existe`);
      }
    }

  } catch (err) {
    console.error('Erro:', err);
  }
}

createTables();
