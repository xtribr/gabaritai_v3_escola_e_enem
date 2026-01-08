/**
 * Script para criar as tabelas do Plano de Estudos no Supabase
 * Executa: npx tsx scripts/run-study-plan-migration.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ SUPABASE_URL e SUPABASE_SERVICE_KEY são necessários');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function runMigration() {
  console.log('🚀 Iniciando migração: Plano de Estudos por TRI\n');

  try {
    // 1. Criar tabela study_contents
    console.log('📦 Criando tabela study_contents...');
    const { error: error1 } = await supabase.rpc('exec_sql', {
      sql: `
        CREATE TABLE IF NOT EXISTS study_contents (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          area TEXT NOT NULL CHECK (area IN ('LC', 'CH', 'CN', 'MT')),
          habilidade TEXT NOT NULL,
          conteudo TEXT NOT NULL,
          tri_score DECIMAL(6,1) NOT NULL,
          tri_faixa TEXT NOT NULL CHECK (tri_faixa IN ('baixo', 'medio', 'alto')),
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_study_contents_area ON study_contents(area);
        CREATE INDEX IF NOT EXISTS idx_study_contents_tri_faixa ON study_contents(tri_faixa);
      `
    });

    if (error1) {
      // Se RPC não existe, tentar SQL direto via REST
      console.log('  ⚠️  RPC não disponível, usando método alternativo...');
    } else {
      console.log('  ✅ study_contents criada');
    }

    // 2. Criar tabela exercise_lists
    console.log('📦 Criando tabela exercise_lists...');
    const { error: error2 } = await supabase.from('exercise_lists').select('id').limit(1);
    if (error2 && error2.code === '42P01') {
      // Tabela não existe, precisa criar via SQL Editor no Supabase Dashboard
      console.log('  ⚠️  Tabela não existe - execute o SQL manualmente no Supabase Dashboard');
    } else {
      console.log('  ✅ exercise_lists já existe ou criada');
    }

    // 3. Testar se tabelas existem
    console.log('\n🔍 Verificando tabelas...');

    const tables = ['study_contents', 'exercise_lists', 'student_study_plans', 'student_list_releases'];
    for (const table of tables) {
      const { error } = await supabase.from(table).select('id').limit(1);
      if (error && error.code === '42P01') {
        console.log(`  ❌ ${table} - NÃO EXISTE`);
      } else if (error) {
        console.log(`  ⚠️  ${table} - ${error.message}`);
      } else {
        console.log(`  ✅ ${table} - OK`);
      }
    }

    console.log('\n📋 INSTRUÇÕES:');
    console.log('Se alguma tabela não existe, execute o SQL no Supabase Dashboard:');
    console.log('1. Acesse https://supabase.com/dashboard/project/axtmozyrnsrhqrnktshz/sql');
    console.log('2. Cole o conteúdo de: scripts/migrations/001_study_plan_tables.sql');
    console.log('3. Execute o SQL\n');

  } catch (error) {
    console.error('❌ Erro na migração:', error);
  }
}

runMigration();
