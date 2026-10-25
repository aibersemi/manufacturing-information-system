# MIS Supabase Package

Paket ini menghubungkan aplikasi MIS ke workspace yang sudah ada pada Supabase bersama. Schema bisnisnya `public`; tabel dan RPC MIS sudah tersedia. Akun teknis hanya menjadi owner pada perusahaan uji yang ditetapkan admin. Pengguna produksi tetap login dengan akun masing-masing. Akun teknis tidak dapat menambahkan pengguna luar ke perusahaan uji; penambahan anggota diajukan kepada admin.

## Configuration

Semua nilai berada di `.env`. URL dan publishable key boleh digunakan frontend. Password akun teknis, sesi, dan token tidak boleh masuk frontend, log, atau Git. Paket tidak menyediakan service-role key, password database, URI PostgreSQL administratif, atau login Studio.

| Variabel | Kegunaan |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Koneksi SDK publik |
| `SUPABASE_SCHEMA` | Schema bisnis MIS |
| `SUPABASE_WORKSPACE_ID`, `SUPABASE_WORKSPACE_SLUG` | Identitas workspace |
| `SUPABASE_USER_ID`, `SUPABASE_USER_EMAIL`, `SUPABASE_USER_PASSWORD` | Akun teknis pengembangan |
| `SUPABASE_COMPANY_ID` | Perusahaan uji yang diizinkan |
| `SUPABASE_STORAGE_BUCKET`, `SUPABASE_STORAGE_PREFIX` | Bucket dan prefix file uji |

## Windows Connection

Gunakan Node.js 22 atau lebih baru. Salin paket ke folder pengembangan dan pasang SDK dengan versi terkunci:

```powershell
npm install --save-exact @supabase/supabase-js@2.116.0
```

Simpan contoh berikut sebagai `check-supabase.mjs`:

```js
import { createClient } from '@supabase/supabase-js'
const env = process.env
const client = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
  db: { schema: 'public' },
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})
const { error: loginError } = await client.auth.signInWithPassword({
  email: env.SUPABASE_USER_EMAIL, password: env.SUPABASE_USER_PASSWORD,
})
if (loginError) throw new Error('Login MIS gagal; hubungi admin tanpa membagikan password.')
try {
  const { data, error } = await client.from('company').select('id, code, name')
    .eq('id', env.SUPABASE_COMPANY_ID)
  if (error || data.length !== 1) throw new Error('Perusahaan uji tidak dapat diakses.')
  console.log('Koneksi MIS dan akses perusahaan uji berhasil.')
} finally {
  await client.auth.signOut({ scope: 'local' })
}
```

```powershell
node --env-file=.env check-supabase.mjs
```

Filter pada client hanya memilih data. RLS, guard RPC, dan registry perusahaan di server tetap menentukan hak akses ketika filter atau ID lokal diubah.

## Storage

Gunakan SDK sesudah login dengan bucket dari konfigurasi. Path file harus berbentuk `${SUPABASE_STORAGE_PREFIX}/<folder>/<nama-file>`. Bucket MIS membatasi MIME type; gunakan PNG/JPEG/WebP/SVG, PDF, atau format video yang diizinkan admin, bukan file text/plain untuk pemeriksaan upload.

```js
const path = `${env.SUPABASE_STORAGE_PREFIX}/checks/${crypto.randomUUID()}.png`
const bucket = client.storage.from(env.SUPABASE_STORAGE_BUCKET)
// pngBytes berisi file PNG valid milik pengujian.
const { error } = await bucket.upload(path, pngBytes, { contentType: 'image/png' })
if (error) throw new Error('Upload file uji gagal.')
// Setelah selesai, hapus hanya path yang dibuat pada run ini.
await bucket.remove([path])
```

Listing, download, update, delete, serta pembuatan signed URL untuk prefix lain ditolak. Signed URL yang sudah diterbitkan berlaku sampai expiry; jangan membagikannya kepada pihak yang tidak berhak.

## Database Changes and Types

Developer menulis usulan migration di repository MIS. Admin meninjau dan menerapkan file tersebut dari platform, lalu menyediakan artifact `database.types.ts`. Untuk mengimpor artifact ke source MIS:

```powershell
npm run types:db -- --from .\database.types.ts
```

Command aplikasi tidak menjalankan migration, membuat pengguna Auth, mengatur bucket, atau membuka koneksi PostgreSQL administratif. Minta operasi tersebut kepada admin platform.

## Troubleshooting

- Login gagal: verifikasi konfigurasi bersama admin; alamat akun teknis adalah identitas login, bukan mailbox.
- `403` atau kode `42501`: operasi berada di luar workspace, perusahaan, atau actor yang diizinkan. Jangan mencoba service-role key sebagai pengganti.
- Hasil kosong pada perusahaan lain atau Storage `404`: data dapat tersembunyi oleh RLS; kondisi ini tidak membuktikan object tersebut tidak ada.
- `SUPABASE_ANON_KEY` masih diterima aplikasi sebagai fallback konfigurasi lama; paket menggunakan `SUPABASE_PUBLISHABLE_KEY`.
- Paket menyediakan pembatas aplikasi dan kredensial; administrator OS/server tetap berada di luar batas tersebut.

## Platform Administration

Migration database, provisioning akun Auth, konfigurasi bucket, ekspor tipe, dan backup database dijalankan operator dari repository platform Supabase menggunakan `python3 scripts/mis-admin.py`. Kredensial administratif tidak disimpan dalam proyek MIS. Entry point administratif lama hanya memberikan petunjuk command pengganti dan keluar tanpa operasi privileged.
