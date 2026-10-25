import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

export function loadMisConfig() {
  const file = process.env.MIS_ENV_FILE || path.resolve('.env');
  const cfg = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index < 0) continue;
    cfg[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  cfg.SUPABASE_PUBLISHABLE_KEY ||= cfg.SUPABASE_ANON_KEY;
  for (const key of ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_USER_EMAIL', 'SUPABASE_USER_PASSWORD', 'SUPABASE_USER_ID', 'SUPABASE_COMPANY_ID', 'SUPABASE_STORAGE_BUCKET', 'SUPABASE_STORAGE_PREFIX']) {
    if (!cfg[key]) throw new Error(`Konfigurasi paket MIS belum lengkap: ${key}`);
  }
  if (cfg.SUPABASE_SCHEMA !== 'public' || cfg.SUPABASE_STORAGE_PREFIX !== cfg.SUPABASE_COMPANY_ID) {
    throw new Error('Schema atau prefix pengujian MIS tidak sesuai paket.');
  }
  return cfg;
}

export async function createMisTestClient(cfg = loadMisConfig()) {
  const client = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY, {
    db: { schema: 'public' },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email: cfg.SUPABASE_USER_EMAIL, password: cfg.SUPABASE_USER_PASSWORD,
  });
  if (error || data.user?.id !== cfg.SUPABASE_USER_ID) throw new Error('Login akun teknis MIS tidak sesuai paket.');
  const { data: companies, error: companyError } = await client.from('company')
    .select('id, code').eq('id', cfg.SUPABASE_COMPANY_ID);
  if (companyError || companies?.length !== 1 || companies[0].code !== 'DUMMY_KONVEKSI') {
    await client.auth.signOut({ scope: 'local' });
    throw new Error('Pengujian hanya boleh dijalankan pada perusahaan uji dari paket MIS.');
  }
  return { client, cfg, user: data.user };
}
