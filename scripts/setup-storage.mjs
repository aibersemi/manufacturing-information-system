import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const projectRoot = process.cwd();
const envPath = path.join(projectRoot, '.env');

function parseEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error('.env file not found at: ' + filePath);
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

const BUCKET_NAME = 'manufacturing-media';
const FILE_SIZE_LIMIT = 52428800; // 50MB
const ALLOWED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
  'video/mp4',
  'video/webm',
  'application/pdf',
];

async function setupStorage() {
  console.log('=== Konfigurasi Supabase Storage ===\n');

  const env = parseEnv(envPath);
  const supabaseUrl = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  // 1. Periksa dan buat/perbarui bucket melalui Supabase Storage API
  console.log(`1. Memeriksa keberadaan bucket '${BUCKET_NAME}'...`);
  const { data: bucket, error: getBucketError } = await supabase.storage.getBucket(BUCKET_NAME);

  if (getBucketError && !getBucketError.message.toLowerCase().includes('not found')) {
    console.warn(`Peringatan getBucket: ${getBucketError.message}. Mencoba membuat bucket...`);
  }

  if (!bucket) {
    console.log(`Bucket '${BUCKET_NAME}' belum ada. Membuat bucket baru (private, 50MB limit)...`);
    const { data: created, error: createError } = await supabase.storage.createBucket(BUCKET_NAME, {
      public: false,
      fileSizeLimit: FILE_SIZE_LIMIT,
      allowedMimeTypes: ALLOWED_MIME_TYPES,
    });

    if (createError) {
      throw new Error(`Gagal membuat bucket '${BUCKET_NAME}': ${createError.message}`);
    }
    console.log(`✓ Bucket '${BUCKET_NAME}' berhasil dibuat:`, created);
  } else {
    console.log(`Bucket '${BUCKET_NAME}' sudah ada. Memperbarui konfigurasi bucket...`);
    const { data: updated, error: updateError } = await supabase.storage.updateBucket(BUCKET_NAME, {
      public: false,
      fileSizeLimit: FILE_SIZE_LIMIT,
      allowedMimeTypes: ALLOWED_MIME_TYPES,
    });

    if (updateError) {
      throw new Error(`Gagal memperbarui bucket '${BUCKET_NAME}': ${updateError.message}`);
    }
    console.log(`✓ Bucket '${BUCKET_NAME}' berhasil diperbarui:`, updated);
  }

  // 2. Menerapkan Row Level Security (RLS) Policies pada PostgreSQL
  console.log('\n2. Mengonfigurasi Row Level Security (RLS) policies di PostgreSQL...');

  const sqlStatements = `
-- 1. Kebijakan SELECT pada storage.buckets agar pengguna terautentikasi dapat membaca metadata bucket
DROP POLICY IF EXISTS "Authenticated users can select buckets" ON storage.buckets;
CREATE POLICY "Authenticated users can select buckets"
ON storage.buckets FOR SELECT
TO authenticated
USING (true);

-- 2. Kebijakan SELECT pada storage.objects untuk bucket manufacturing-media
DROP POLICY IF EXISTS "Authenticated users can select manufacturing-media objects" ON storage.objects;
CREATE POLICY "Authenticated users can select manufacturing-media objects"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = '${BUCKET_NAME}');

-- 3. Kebijakan INSERT pada storage.objects untuk bucket manufacturing-media
DROP POLICY IF EXISTS "Authenticated users can insert manufacturing-media objects" ON storage.objects;
CREATE POLICY "Authenticated users can insert manufacturing-media objects"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = '${BUCKET_NAME}');

-- 4. Kebijakan UPDATE pada storage.objects (diperlukan untuk fitur replace/upsert file)
DROP POLICY IF EXISTS "Authenticated users can update manufacturing-media objects" ON storage.objects;
CREATE POLICY "Authenticated users can update manufacturing-media objects"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = '${BUCKET_NAME}')
WITH CHECK (bucket_id = '${BUCKET_NAME}');

-- 5. Kebijakan DELETE pada storage.objects untuk bucket manufacturing-media
DROP POLICY IF EXISTS "Authenticated users can delete manufacturing-media objects" ON storage.objects;
CREATE POLICY "Authenticated users can delete manufacturing-media objects"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = '${BUCKET_NAME}');
`;

  try {
    execSync('docker exec -i supabase-db psql -U postgres -d postgres', {
      input: sqlStatements,
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    console.log('✓ RLS policies berhasil diterapkan pada PostgreSQL.');
  } catch (err) {
    throw new Error(`Gagal menerapkan RLS policies: ${err.message}`);
  }

  // 3. Verifikasi konfigurasi
  console.log('\n3. Memverifikasi konfigurasi akhir...');
  const verifyOutput = execSync(
    `docker exec -i supabase-db psql -U postgres -d postgres -c "SELECT id, name, public, file_size_limit FROM storage.buckets WHERE id = '${BUCKET_NAME}';" -c "SELECT policyname, cmd, roles FROM pg_policies WHERE schemaname = 'storage' AND (tablename = 'objects' OR tablename = 'buckets');"`,
    { encoding: 'utf-8' }
  );
  console.log(verifyOutput);

  console.log('=== Konfigurasi Supabase Storage Selesai dengan Sukses ===');
}

setupStorage().catch((err) => {
  console.error('Error saat konfigurasi storage:', err.message);
  process.exit(1);
});
