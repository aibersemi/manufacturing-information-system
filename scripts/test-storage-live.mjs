import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const projectRoot = process.cwd();
const envPath = path.join(projectRoot, '.env');

function parseEnv(filePath) {
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

async function testStorageLive() {
  console.log('=== Uji Coba Fungsional Live: Supabase Storage + RLS ===\n');

  const env = parseEnv(envPath);
  const supabaseUrl = env.SUPABASE_URL;
  const anonKey = env.SUPABASE_ANON_KEY;
  const e2eUser = env.E2E_USER_USERNAME;
  const e2ePass = env.E2E_USER_PASSWORD;

  const email = e2eUser.includes('@') ? e2eUser : `${e2eUser}@mis.mrmads.net`;

  // 1. Inisialisasi client publik seperti halnya Angular di browser
  const client = createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  // Test 1: Coba upload file tanpa login (anon) -> Harus Ditolak oleh RLS
  console.log('1. Menguji pencegahan upload tanpa autentikasi (Anon User)...');
  const samplePng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );
  const anonUploadRes = await client.storage
    .from('manufacturing-media')
    .upload('test/anon-sample.png', samplePng, { contentType: 'image/png' });

  if (anonUploadRes.error) {
    console.log(`✓ Akses Anonim Berhasil Ditolak oleh RLS: ${anonUploadRes.error.message}`);
  } else {
    throw new Error('KEGAGALAN KEAMANAN: Anon user diizinkan mengunggah ke private bucket!');
  }

  // Test 2: Login sebagai pengguna terautentikasi (E2E User)
  console.log(`\n2. Melakukan autentikasi sebagai [${email}]...`);
  const { data: authData, error: authError } = await client.auth.signInWithPassword({
    email,
    password: e2ePass,
  });

  if (authError || !authData.session) {
    throw new Error(`Login gagal: ${authError?.message}`);
  }
  console.log(`✓ Berhasil login. Role: ${authData.user.app_metadata?.role || 'head'}`);

  // Test 3: Upload file tipe tidak diizinkan -> Harus Ditolak oleh MIME type validation
  console.log('\n3. Menguji validasi tipe MIME (text/plain harus ditolak)...');
  const invalidMimeRes = await client.storage
    .from('manufacturing-media')
    .upload('test/invalid.txt', Buffer.from('not allowed'), { contentType: 'text/plain' });
  if (invalidMimeRes.error) {
    console.log(`✓ Validasi MIME Berhasil Menolak text/plain: ${invalidMimeRes.error.message}`);
  } else {
    throw new Error('Validasi MIME gagal: text/plain diizinkan!');
  }

  // Test 4: Upload file yang valid (image/png) sebagai pengguna terautentikasi
  const testFileName = `test/qc-sample-${Date.now()}.png`;
  console.log(`\n4. Mengunggah file gambar valid [${testFileName}] sebagai pengguna terautentikasi...`);
  const { data: uploadData, error: uploadError } = await client.storage
    .from('manufacturing-media')
    .upload(testFileName, samplePng, {
      contentType: 'image/png',
      upsert: true,
    });

  if (uploadError) {
    throw new Error(`Gagal mengunggah file: ${uploadError.message}`);
  }
  console.log('✓ File gambar berhasil diunggah:', uploadData);

  // Test 4: Generate Signed URL untuk file privat
  console.log('\n4. Menghasilkan Signed URL sementara (60 detik)...');
  const { data: signedData, error: signedError } = await client.storage
    .from('manufacturing-media')
    .createSignedUrl(testFileName, 60);

  if (signedError || !signedData?.signedUrl) {
    throw new Error(`Gagal menghasilkan signed URL: ${signedError?.message}`);
  }
  console.log('✓ Signed URL berhasil diperoleh:', signedData.signedUrl);

  // Test 5: Mengunduh konten melalui fetch ke Signed URL
  console.log('\n5. Mengunduh konten file melalui Signed URL...');
  const fetchRes = await fetch(signedData.signedUrl);
  if (!fetchRes.ok) {
    throw new Error(`Gagal mengambil file melalui signed URL: HTTP ${fetchRes.status}`);
  }
  const downloadedText = await fetchRes.text();
  console.log(`✓ Konten file berhasil diunduh (${downloadedText.length} bytes): "${downloadedText.slice(0, 40)}..."`);

  // Test 6: List files dalam folder
  console.log('\n6. Menjelajahi daftar file di folder "test"...');
  const { data: listData, error: listError } = await client.storage
    .from('manufacturing-media')
    .list('test');

  if (listError) {
    throw new Error(`Gagal memuat list files: ${listError.message}`);
  }
  console.log(`✓ Berhasil memuat daftar file (${listData.length} item ditemukan):`);
  listData.forEach((f) => console.log(`   - ${f.name} (${f.metadata?.size || 'N/A'} bytes)`));

  // Test 7: Hapus file uji coba
  console.log('\n7. Membersihkan (menghapus) file uji coba...');
  const { error: removeError } = await client.storage
    .from('manufacturing-media')
    .remove([testFileName]);

  if (removeError) {
    throw new Error(`Gagal menghapus file: ${removeError.message}`);
  }
  console.log('✓ File uji coba berhasil dihapus.');

  console.log('\n=== Seluruh Uji Coba Supabase Storage & RLS Lolos 100% ===');
}

testStorageLive().catch((err) => {
  console.error('Error pengujian storage:', err.message);
  process.exit(1);
});
