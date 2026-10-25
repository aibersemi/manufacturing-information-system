import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createMisTestClient, loadMisConfig } from './mis-package.mjs';

const cfg = loadMisConfig();
const { client } = await createMisTestClient(cfg);
const filePath = `${cfg.SUPABASE_STORAGE_PREFIX}/test/${randomUUID()}.png`;
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const bucket = client.storage.from(cfg.SUPABASE_STORAGE_BUCKET);
try {
  const anonymous = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const refused = await anonymous.storage.from(cfg.SUPABASE_STORAGE_BUCKET)
    .upload(filePath, image, { contentType: 'image/png' });
  assert.ok(refused.error, 'Upload anonim harus ditolak.');
  const { error: uploadError } = await bucket.upload(filePath, image, { contentType: 'image/png' });
  assert.ifError(uploadError);
  const { data: signed, error: signedError } = await bucket.createSignedUrl(filePath, 60);
  assert.ifError(signedError);
  const response = await fetch(signed.signedUrl);
  assert.ok(response.ok, 'Signed URL yang sah harus berfungsi.');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), image);
  const { data: files, error: listError } = await bucket.list(`${cfg.SUPABASE_STORAGE_PREFIX}/test`);
  assert.ifError(listError);
  assert.ok(files.some((file) => file.name === filePath.split('/').at(-1)));
  console.log('PASS Storage MIS: sesi pengguna biasa, prefix uji, signed URL, dan penolakan anonim.');
} finally {
  const { error } = await bucket.remove([filePath]);
  await client.auth.signOut({ scope: 'local' });
  assert.ifError(error);
}
