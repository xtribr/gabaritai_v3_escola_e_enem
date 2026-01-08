/**
 * Script para importar listas de exercícios para Supabase Storage
 * Executa: npx tsx scripts/import-exercise-lists.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Mapeamento de pastas para códigos de área
const FOLDER_TO_AREA: Record<string, string> = {
  'Ciências da Natureza': 'CN',
  'Ciências Humanas': 'CH',
  'Linguagens': 'LC',
  'Matemática': 'MT'
};

// Parsear faixa TRI do nome da pasta
function parseTRIRange(folderName: string): { min: number; max: number } | null {
  // Formatos: "200 - 500", "200-500", "500", "700-1000"
  const cleanName = folderName.replace(/\s+/g, '');

  if (cleanName.includes('-')) {
    const parts = cleanName.split('-');
    const min = parseInt(parts[0]);
    const max = parseInt(parts[1]);
    if (!isNaN(min) && !isNaN(max)) {
      return { min, max };
    }
  } else {
    const single = parseInt(cleanName);
    if (!isNaN(single)) {
      // Para faixas como "500", "600", "700", assumir range de ±50
      return { min: single - 50, max: single + 50 };
    }
  }
  return null;
}

// Extrair número da lista do nome do arquivo
function extractListOrder(filename: string): number {
  const match = filename.match(/lista\s*(\d+)/i);
  return match ? parseInt(match[1]) : 1;
}

async function ensureBucketExists() {
  const bucketName = 'exercise-lists';

  // Verificar se bucket existe
  const { data: buckets } = await supabase.storage.listBuckets();
  const exists = buckets?.some(b => b.name === bucketName);

  if (!exists) {
    console.log('📦 Criando bucket "exercise-lists"...');
    const { error } = await supabase.storage.createBucket(bucketName, {
      public: false,
      fileSizeLimit: 52428800, // 50MB
      allowedMimeTypes: [
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/pdf'
      ]
    });
    if (error) {
      console.error('❌ Erro ao criar bucket:', error.message);
      return false;
    }
    console.log('✅ Bucket criado');
  } else {
    console.log('✅ Bucket "exercise-lists" já existe');
  }
  return true;
}

async function importExerciseLists() {
  console.log('🚀 Importando listas de exercícios para Supabase\n');

  const listsPath = path.join(process.cwd(), 'data', 'Listas TRI');

  if (!fs.existsSync(listsPath)) {
    console.error('❌ Pasta não encontrada:', listsPath);
    process.exit(1);
  }

  // Garantir que o bucket existe
  const bucketReady = await ensureBucketExists();
  if (!bucketReady) {
    console.error('❌ Não foi possível criar/acessar o bucket');
    process.exit(1);
  }

  // Limpar tabela existente
  console.log('\n🗑️  Limpando tabela exercise_lists...');
  const { error: deleteError } = await supabase
    .from('exercise_lists')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');

  if (deleteError && deleteError.code === '42P01') {
    console.error('❌ Tabela exercise_lists não existe!');
    console.log('\n📋 Execute primeiro o SQL de criação das tabelas no Supabase Dashboard\n');
    process.exit(1);
  }

  // Coletar arquivos
  const records: Array<{
    area: string;
    tri_min: number;
    tri_max: number;
    titulo: string;
    arquivo_url: string;
    arquivo_nome: string;
    arquivo_tipo: string;
    tamanho_bytes: number;
    ordem: number;
  }> = [];

  // Iterar pelas pastas de área
  const areaDirs = fs.readdirSync(listsPath);

  for (const areaDir of areaDirs) {
    if (areaDir.startsWith('.')) continue;

    const area = FOLDER_TO_AREA[areaDir];
    if (!area) {
      console.log(`⚠️  Área desconhecida: "${areaDir}"`);
      continue;
    }

    const areaPath = path.join(listsPath, areaDir);
    if (!fs.statSync(areaPath).isDirectory()) continue;

    console.log(`\n📁 Processando ${areaDir} (${area})...`);

    // Iterar pelas pastas de faixa TRI
    const triDirs = fs.readdirSync(areaPath);

    for (const triDir of triDirs) {
      if (triDir.startsWith('.')) continue;

      const triRange = parseTRIRange(triDir);
      if (!triRange) {
        console.log(`  ⚠️  Faixa TRI não reconhecida: "${triDir}"`);
        continue;
      }

      const triPath = path.join(areaPath, triDir);
      if (!fs.statSync(triPath).isDirectory()) continue;

      // Iterar pelos arquivos
      const files = fs.readdirSync(triPath);

      for (const filename of files) {
        if (filename.startsWith('.')) continue;

        const ext = path.extname(filename).toLowerCase();
        if (ext !== '.docx' && ext !== '.pdf') continue;

        const filePath = path.join(triPath, filename);
        const stats = fs.statSync(filePath);
        const fileContent = fs.readFileSync(filePath);

        // Upload para Supabase Storage
        const storagePath = `${area}/${triRange.min}-${triRange.max}/${filename}`;

        console.log(`  📤 Upload: ${filename}`);

        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('exercise-lists')
          .upload(storagePath, fileContent, {
            contentType: ext === '.pdf'
              ? 'application/pdf'
              : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            upsert: true
          });

        if (uploadError) {
          console.error(`    ❌ Erro no upload: ${uploadError.message}`);
          continue;
        }

        // Gerar URL pública (signed URL válida por 1 ano)
        const { data: urlData } = await supabase.storage
          .from('exercise-lists')
          .createSignedUrl(storagePath, 31536000); // 1 ano em segundos

        const fileUrl = urlData?.signedUrl || '';

        // Criar título amigável
        const titulo = `Lista ${extractListOrder(filename)} - ${area} (${triRange.min}-${triRange.max})`;

        records.push({
          area,
          tri_min: triRange.min,
          tri_max: triRange.max,
          titulo,
          arquivo_url: fileUrl,
          arquivo_nome: filename,
          arquivo_tipo: ext.replace('.', ''),
          tamanho_bytes: stats.size,
          ordem: extractListOrder(filename)
        });
      }
    }
  }

  console.log(`\n\n📊 Total de arquivos processados: ${records.length}`);

  // Inserir registros no banco
  if (records.length > 0) {
    console.log('\n📤 Inserindo registros na tabela exercise_lists...');

    const { data, error } = await supabase
      .from('exercise_lists')
      .insert(records)
      .select('id');

    if (error) {
      console.error('❌ Erro ao inserir:', error.message);
    } else {
      console.log(`✅ ${data?.length || 0} registros inseridos`);
    }
  }

  // Estatísticas por área
  const stats: Record<string, number> = {};
  for (const r of records) {
    stats[r.area] = (stats[r.area] || 0) + 1;
  }

  console.log('\n📊 Listas por área:');
  for (const [area, count] of Object.entries(stats)) {
    console.log(`   ${area}: ${count} listas`);
  }

  console.log('\n✅ Importação concluída!');
}

importExerciseLists().catch(console.error);
