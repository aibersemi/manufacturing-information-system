import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const projectRoot = process.cwd();
const envPath = path.join(projectRoot, '.env');
const migrationPath = path.join(projectRoot, 'supabase', 'migrations', '20260913000001_foundation_schema.sql');

function parseEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
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
const user = env.POSTGRES_USER || 'postgres';
const tenant = 'your-tenant-id';
const dbUser = user.includes('.') ? user : `${user}.${tenant}`;
const password = env.POSTGRES_PASSWORD || '';
const host = env.POSTGRES_HOST || '127.0.0.1';
const port = env.POSTGRES_PORT || '5123';
const db = env.POSTGRES_DB || 'postgres';

console.log(`Menjalankan migrasi SQL: ${migrationPath} ke ${host}:${port}/${db}...`);

try {
  execSync(
    `PGPASSWORD="${password}" psql -h "${host}" -p "${port}" -U "${dbUser}" -d "${db}" -v ON_ERROR_STOP=1 -f "${migrationPath}"`,
    { stdio: 'inherit' }
  );
  console.log('Migrasi foundation_schema berhasil diterapkan ke database!');
} catch (err) {
  console.error('Gagal menerapkan migrasi:', err.message);
  process.exit(1);
}
