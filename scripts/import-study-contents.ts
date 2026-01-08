/**
 * Script para importar CSV de conteúdos ENEM para Supabase
 * Executa: npx tsx scripts/import-study-contents.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Mapeamento de áreas do CSV para códigos
const AREA_MAP: Record<string, string> = {
  'Linguagens': 'LC',
  'Humanas': 'CH',
  'Natureza': 'CN',
  'Matematica': 'MT',
  'Matemática': 'MT'
};

// Função para determinar faixa TRI
function getTriFaixa(triScore: number): 'baixo' | 'medio' | 'alto' {
  if (triScore < 500) return 'baixo';
  if (triScore < 650) return 'medio';
  return 'alto';
}

async function importCSV() {
  console.log('🚀 Importando conteúdos ENEM para Supabase\n');

  const csvPath = path.join(process.cwd(), 'data', 'conteudos ENEM separados por TRI.csv');

  if (!fs.existsSync(csvPath)) {
    console.error('❌ Arquivo CSV não encontrado:', csvPath);
    process.exit(1);
  }

  // Ler CSV
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const lines = csvContent.split('\n').filter(line => line.trim());

  console.log(`📄 ${lines.length} linhas encontradas no CSV\n`);

  // Parsear linhas
  const records: Array<{
    area: string;
    habilidade: string;
    conteudo: string;
    tri_score: number;
    tri_faixa: string;
  }> = [];

  let skipped = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // CSV usa ; como delimitador e , como decimal
    // Formato: Area;Habilidade;Conteúdo;TRI
    const parts = line.split(';');

    if (parts.length < 4) {
      skipped++;
      continue;
    }

    const [areaRaw, habilidade, conteudo, triRaw] = parts;

    // Converter área
    const area = AREA_MAP[areaRaw.trim()];
    if (!area) {
      console.log(`⚠️  Área desconhecida: "${areaRaw}" na linha ${i + 1}`);
      skipped++;
      continue;
    }

    // Converter TRI (usa , como decimal)
    const triScore = parseFloat(triRaw.trim().replace(',', '.'));
    if (isNaN(triScore)) {
      skipped++;
      continue;
    }

    records.push({
      area,
      habilidade: habilidade.trim(),
      conteudo: conteudo.trim(),
      tri_score: triScore,
      tri_faixa: getTriFaixa(triScore)
    });
  }

  console.log(`✅ ${records.length} registros válidos parseados`);
  console.log(`⚠️  ${skipped} linhas ignoradas\n`);

  // Estatísticas por área
  const stats: Record<string, { total: number; baixo: number; medio: number; alto: number }> = {};
  for (const r of records) {
    if (!stats[r.area]) stats[r.area] = { total: 0, baixo: 0, medio: 0, alto: 0 };
    stats[r.area].total++;
    stats[r.area][r.tri_faixa as 'baixo' | 'medio' | 'alto']++;
  }

  console.log('📊 Estatísticas por área:');
  for (const [area, s] of Object.entries(stats)) {
    console.log(`   ${area}: ${s.total} total (baixo: ${s.baixo}, medio: ${s.medio}, alto: ${s.alto})`);
  }
  console.log('');

  // Limpar tabela existente
  console.log('🗑️  Limpando tabela study_contents...');
  const { error: deleteError } = await supabase
    .from('study_contents')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all

  if (deleteError) {
    if (deleteError.code === '42P01') {
      console.error('❌ Tabela study_contents não existe!');
      console.log('\n📋 Execute primeiro o SQL de criação das tabelas no Supabase Dashboard:');
      console.log('   scripts/migrations/001_study_plan_tables.sql\n');
      process.exit(1);
    }
    console.error('❌ Erro ao limpar tabela:', deleteError.message);
  } else {
    console.log('✅ Tabela limpa\n');
  }

  // Inserir em batches de 500
  const BATCH_SIZE = 500;
  let inserted = 0;
  let errors = 0;

  console.log('📤 Inserindo registros...');
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);

    const { data, error } = await supabase
      .from('study_contents')
      .insert(batch)
      .select('id');

    if (error) {
      console.error(`❌ Erro no batch ${i / BATCH_SIZE + 1}:`, error.message);
      errors += batch.length;
    } else {
      inserted += data?.length || 0;
      process.stdout.write(`\r   Progresso: ${inserted}/${records.length}`);
    }
  }

  console.log(`\n\n✅ Importação concluída!`);
  console.log(`   Inseridos: ${inserted}`);
  console.log(`   Erros: ${errors}`);

  // Verificar contagem final
  const { count } = await supabase
    .from('study_contents')
    .select('*', { count: 'exact', head: true });

  console.log(`   Total na tabela: ${count}`);
}

importCSV().catch(console.error);
