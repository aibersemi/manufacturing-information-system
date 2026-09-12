import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const projectRoot = process.cwd();
const envPath = path.join(projectRoot, '.env');
const targetPath = path.join(projectRoot, 'src', 'types', 'database.types.ts');

function parseEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
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
const password = env.POSTGRES_PASSWORD || '';
const host = env.POSTGRES_HOST || '127.0.0.1';
const port = env.POSTGRES_PORT || '5123';
const db = env.POSTGRES_DB || 'postgres';
const tenant = 'your-tenant-id';

const dbUrl = `postgresql://${user}.${tenant}:${password}@${host}:${port}/${db}`;

console.log('Generating Supabase TypeScript types from database schema...');
fs.mkdirSync(path.dirname(targetPath), { recursive: true });

try {
  const output = execSync(`npx supabase gen types --db-url "${dbUrl}" --schema public`, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  fs.writeFileSync(targetPath, output);
  console.log(`Types generated successfully -> ${targetPath}`);
} catch (err) {
  console.error('Failed to generate Supabase types:', err.message);
  process.exit(1);
}
