# Security Architecture and Guidelines

Dokumen ini menetapkan arsitektur keamanan, standar *defense-in-depth*, dan panduan operasional resmi untuk Manufacturing Information System (MIS). Panduan ini mengintegrasikan standar keamanan resmi dari [Angular Security Guide](https://angular.dev/guide/security) dan [Supabase Production Security Best Practices](https://supabase.com/docs/guides/database/postgres/row-level-security).

> [!IMPORTANT]
> Seluruh nilai rahasia, kredensial, token administratif, password database, dan alamat IP infrastruktur hanya disimpan di dalam file `.env` dan dilarang keras dicantumkan secara langsung pada dokumentasi maupun kode publik. Dokumen ini hanya merujuk nama variabel lingkungan.

---

## Prinsip Utama Keamanan

Sistem manufaktur multi-company ini menerapkan model keamanan berlapis (*Defense-in-Depth*):

1. **Client Guard ≠ Server Security**:
   * *Route guards* di Angular (`authGuard`) bertindak sebagai pengendali UX dan navigasi visual, **bukan** batas keamanan utama.
   * Batas keamanan mutlak (*source of truth*) ditegakkan di level database melalui **Row Level Security (RLS)** PostgreSQL dan autentikasi GoTrue JWT Supabase.
2. **Principle of Least Privilege**:
   * Setiap modul dan pengguna hanya memiliki akses minimum yang dibutuhkan untuk menjalankan perannya.
3. **Isolasi Lingkungan Ketat (Strict Credential Isolation)**:
   * Pemisahan absolut antara kredensial publik yang boleh dikirim ke browser dengan kredensial rahasia server.

---

## Frontend Security (Standar Resmi Angular v22)

### Pencegahan Cross-Site Scripting (XSS)
Angular secara *default* memperlakukan semua nilai dinamis sebagai data yang tidak tepercaya (*untrusted*):
- **Sanitasi Otomatis**: Seluruh interpolasi template (`{{ value }}`) dan properti binding (`[property]="value"`) otomatis dibersihkan oleh Angular sebelum dirender ke DOM.
- **Larangan Keras Manipulasi DOM Langsung**:
  * Dilarang menggunakan API DOM browser mentah seperti `element.innerHTML`, `element.outerHTML`, atau `document.write()`.
  * Gunakan template Angular native atau `Renderer2`.
- **Penggunaan `DomSanitizer` yang Terbatas**:
  * Hindari memanggil fungsi bypass keamanan (`bypassSecurityTrustHtml`, `bypassSecurityTrustScript`) kecuali telah melalui audit dan verifikasi ketat.
- **Kompilasi AOT (Ahead-of-Time)**:
  * Seluruh template Angular wajib dikompilasi saat build (`ng build`), mencegah eksekusi injeksi template runtime di sisi klien.

### Content Security Policy (CSP) & Perlindungan Klik
Header CSP dikonfigurasi pada Caddy edge server untuk membatasi asal sumber daya yang dapat dijalankan browser:
- `default-src 'self'`: Membatasi seluruh aset dari origin aplikasi.
- `script-src 'self'`: Mencegah eksekusi script eksternal dan inline script tanpa otorisasi.
- `connect-src 'self' ${SUPABASE_URL} wss://${SUPABASE_DOMAIN}`: Mengizinkan komunikasi REST API dan WebSocket Realtime hanya ke gateway Supabase resmi.
- `img-src 'self' data: blob: ${SUPABASE_URL}`: Mengizinkan gambar dari origin dan Supabase Storage.
- `frame-ancestors 'self'` & `X-Frame-Options: SAMEORIGIN`: Mencegah serangan *Clickjacking* (pembungkusan iframe oleh situs asing).

### Isolasi Kredensial Client
- **Hanya Dua Variabel Publik**: Bundle frontend hanya diizinkan mengakses `SUPABASE_URL` dan `SUPABASE_ANON_KEY`.
- **Kunci Rahasia Terlarang**: Variabel `SUPABASE_SERVICE_ROLE_KEY`, `POSTGRES_PASSWORD`, dan kredensial administratif lainnya **dilarang keras** diimpor atau dibungkus ke dalam file TypeScript frontend (seperti `src/environments/`).
- File `src/environments/environment.ts` otomatis di-generate saat build dari `.env` lokal dan diabaikan oleh Git (`.gitignore`).

---

## Database & Backend Security (Standar Resmi Supabase & PostgreSQL)

### Wajib Row Level Security (RLS) di Setiap Tabel
Supabase mengekspos skema `public` secara langsung melalui REST API PostgREST. Oleh karena itu:
- **Setiap tabel baru wajib mengaktifkan RLS**:
  ```sql
  alter table public.orders enable row level security;
  alter table public.orders force row level security;
  ```
- **Tabel tanpa RLS akan terbuka penuh untuk publik**. Tidak ada tabel di skema `public` yang boleh dibuat tanpa kebijakan (*policy*) RLS.

### Isolasi Multi-Company / Multi-Tenant (Tenant Scope)
Karena MIS beroperasi dalam lingkungan multi-company:
- Seluruh tabel operasional dan transaksi (misal: `inventory`, `purchasing`, `production`, `sales`) wajib memiliki kolom `company_id`.
- Kebijakan RLS wajib memvalidasi kepemilikan tenant aktif dari user yang sedang login:
  ```sql
  create policy "Users can only access their active company data"
    on public.orders
    for all
    to authenticated
    using (
      company_id = (select auth.jwt() -> 'app_metadata' ->> 'active_company_id')::uuid
    );
  ```

### Optimasi Kinerja Kebijakan RLS
Mengikuti *Supabase Postgres Performance & Security Rules*:
- **Bungkus fungsi di dalam `SELECT`**:
  * Gunakan `(select auth.uid())` daripada `auth.uid()` langsung, agar engine PostgreSQL dapat melakukan *caching* nilai auth per query dan tidak mengevaluasinya berulang kali untuk setiap baris data (bisa meningkatkan kecepatan hingga ratusan kali lipat).
- **Index Kolom Pemeriksaan RLS**:
  * Seluruh kolom yang digunakan di dalam klausa `USING` atau `WITH CHECK` (seperti `user_id`, `company_id`) wajib memiliki indeks B-Tree.

### Keamanan Database Functions (`SECURITY DEFINER`)
Fungsi yang dieksekusi dengan hak akses pembuat (*elevated privileges*):
- Wajib menyetel `search_path` kosong untuk mencegah serangan pembajakan skema:
  ```sql
  create or replace function public.perform_sensitive_action()
  returns void
  language plpgsql
  security definer
  set search_path = ''
  as $$
  begin
    -- Selalu verifikasi auth.uid() di dalam fungsi
    if (select auth.uid()) is null then
      raise exception 'Unauthorized';
    end if;
    ...
  end;
  $$;
  ```
- Cabut izin eksekusi dari role publik jika fungsi hanya digunakan secara internal:
  ```sql
  revoke execute on function public.perform_sensitive_action() from public, anon;
  ```

---

## Network & Infrastructure Security

```text
[Internet / Browser]
        │ HTTPS (TLS 1.3 / HSTS)
        ▼
[VPS Edge Server / Caddy] ── WAF & Security Headers
        │ WireGuard Mesh (${TUNNEL_VPS_WIREGUARD_IP} -> ${APP_WIREGUARD_IP})
        ▼
[Host Server MIS]
 ├── Port ${APP_PORT}      -> Angular Frontend Application
 └── Port ${SUPABASE_PORT} -> Supabase Envoy Gateway (Auth, REST, Storage, Realtime)
```

1. **Enkripsi Transit (TLS 1.3 & HSTS)**:
   * Seluruh trafik eksternal diterminasi menggunakan HTTPS modern oleh Caddy dengan header `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`.
2. **Tunneling Terisolasi (WireGuard)**:
   * Komunikasi antara VPS Edge dan Host Server MIS berjalan melalui antarmuka WireGuard internal privat (`10.50.0.x`). Port aplikasi tidak diekspos langsung ke alamat IP publik host.
3. **Penyimpanan Kredensial**:
   * Kredensial murni berada di `.env` (izin file dibatasi ke user `mrdev`). Template publik [.env.example](file:///.env.example) hanya memuat nama variabel kosong tanpa data sensitif.

---

## Security Verification Checklist

Sebelum kode fitur atau tabel baru digabungkan ke cabang utama:

- [ ] **Database**: RLS aktif di tabel (`enable row level security`).
- [ ] **Tenant Check**: Kebijakan RLS membatasi baris data berdasarkan `company_id` dan `auth.uid()`.
- [ ] **Indexes**: Indeks terpasang pada kolom-kolom RLS.
- [ ] **Frontend**: Tidak ada penggunaan `bypassSecurityTrust*` atau `innerHTML` langsung.
- [ ] **Secrets Check**: Tidak ada hardcoded secret di file `.ts`, `.html`, `.json`, maupun `.md`.
- [ ] **Auditing**: `npm audit` dijalankan dengan 0 kerentanan kritis.
- [ ] **Build Check**: `npm run build` dan `npm test` lulus tanpa error.
