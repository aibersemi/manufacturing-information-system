import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const projectRoot = process.cwd();
const envPath = path.join(projectRoot, '.env');

function parseEnv(filePath) {
  if (!fs.existsSync(filePath)) throw new Error('.env not found');
  const content = fs.readFileSync(filePath, 'utf-8');
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

const env = parseEnv(envPath);
const supabaseUrl = env.SUPABASE_URL;
const anonKey = env.SUPABASE_ANON_KEY;

console.log('--- VERIFIKASI FASE 1: AUTH, RLS & DATA POSTGRESQL ---');
console.log('Supabase URL:', supabaseUrl);

const supabase = createClient(supabaseUrl, anonKey);

async function runVerification() {
  const superUser = env.SUPER_USER_USERNAME;
  const superPass = env.SUPER_USER_PASSWORD;
  const email = superUser.includes('@') ? superUser : `${superUser}@mis.mrmads.net`;

  console.log(`1. Melakukan login sebagai ${email}...`);
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email,
    password: superPass,
  });

  if (authError) {
    throw new Error(`Auth login gagal: ${authError.message}`);
  }

  console.log(`✓ Login berhasil. User ID: ${authData.user.id}`);

  console.log('2. Menguji query tabel public.company via RLS client terautentikasi...');
  const { data: companies, error: compError } = await supabase
    .from('company')
    .select('*')
    .eq('is_active', true);

  if (compError) {
    throw new Error(`Gagal membaca company: ${compError.message}`);
  }
  console.log(`✓ Berhasil membaca ${companies.length} company:`, companies.map(c => `${c.code} - ${c.name}`));

  console.log('3. Menguji query user_company_assignment via RLS...');
  const { data: assignments, error: assignError } = await supabase
    .from('user_company_assignment')
    .select('*');

  if (assignError) {
    throw new Error(`Gagal membaca assignment: ${assignError.message}`);
  }
  console.log(`✓ Berhasil membaca ${assignments.length} assignments untuk user.`);

  const activeCompanyId = companies[0].id;

  console.log('4. Menguji query ledger_account (COA) untuk company aktif via RLS...');
  const { data: accounts, error: accError } = await supabase
    .from('ledger_account')
    .select('id, code, name, level1, account_type, is_control')
    .eq('company_id', activeCompanyId)
    .limit(5);

  if (accError) {
    throw new Error(`Gagal membaca ledger_account: ${accError.message}`);
  }
  console.log(`✓ Berhasil membaca COA. Sampel 5 akun:`, accounts.map(a => `${a.code} [${a.name}]`));

  console.log('5. Menguji query accounting_period...');
  const { data: periods, error: periodError } = await supabase
    .from('accounting_period')
    .select('*')
    .eq('company_id', activeCompanyId);

  if (periodError) {
    throw new Error(`Gagal membaca accounting_period: ${periodError.message}`);
  }
  console.log(`✓ Berhasil membaca periode akuntansi:`, periods.map(p => `${p.period_month} (${p.status})`));

  console.log('6. Menguji query document_sequence...');
  const { data: sequences, error: seqError } = await supabase
    .from('document_sequence')
    .select('*')
    .eq('company_id', activeCompanyId);

  if (seqError) {
    throw new Error(`Gagal membaca document_sequence: ${seqError.message}`);
  }
  console.log(`✓ Berhasil membaca ${sequences.length} sequence penomoran.`);

  console.log('7. Menguji query access_permission...');
  const { data: permissions, error: permError } = await supabase
    .from('access_permission')
    .select('*')
    .eq('company_id', activeCompanyId)
    .eq('role', 'owner')
    .limit(5);

  if (permError) {
    throw new Error(`Gagal membaca access_permission: ${permError.message}`);
  }
  console.log(`✓ Berhasil membaca matriks izin (sample 5):`, permissions.map(p => p.menu_key));

  console.log('8. Sign out...');
  await supabase.auth.signOut();

  console.log('9. Menguji login sebagai e2e_playwright@mis.mrmads.net...');
  const e2eUser = env.E2E_USER_USERNAME;
  const e2ePass = env.E2E_USER_PASSWORD;
  const e2eEmail = e2eUser.includes('@') ? e2eUser : `${e2eUser}@mis.mrmads.net`;

  const { data: e2eAuth, error: e2eError } = await supabase.auth.signInWithPassword({
    email: e2eEmail,
    password: e2ePass,
  });
  if (e2eError) {
    throw new Error(`e2e login gagal: ${e2eError.message}`);
  }
  console.log(`✓ Login e2e berhasil. User ID: ${e2eAuth.user.id}`);

  const { data: e2eCompanies } = await supabase.from('company').select('*');
  console.log(`✓ e2e user dapat mengakses ${e2eCompanies?.length} company.`);

  await supabase.auth.signOut();
  console.log('✓ Seluruh verifikasi fungsional Fase 1 Sukses 100%!');
}

runVerification().catch((err) => {
  console.error('VERIFIKASI GAGAL:', err);
  process.exit(1);
});
