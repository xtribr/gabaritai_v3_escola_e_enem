import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function check() {
  const { data: listas, error } = await supabase
    .from('exercise_lists')
    .select('area, tri_min, tri_max, titulo, ordem')
    .order('area')
    .order('tri_min')
    .order('ordem');

  if (error) {
    console.log('Erro:', error.message);
    return;
  }

  const grouped: Record<string, string[]> = {};
  for (const l of listas || []) {
    const key = `${l.area} (${l.tri_min}-${l.tri_max})`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(l.titulo);
  }

  console.log('=== Listas por Area e Faixa TRI ===');
  for (const key of Object.keys(grouped).sort()) {
    console.log(`${key}: ${grouped[key].length} listas`);
  }
}

check().catch(e => console.log('Erro:', e.message));
