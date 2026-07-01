# Administrasi Konveksi dan Pengguna

## Domain Model

- `Tenant` merepresentasikan konveksi. `slug` adalah identitas stabil dan tidak dapat diubah setelah dibuat.
- `Membership` menghubungkan akun ke tenant beserta satu role aktif. `finance` dapat memiliki membership aktif pada beberapa tenant. `kepala_konveksi` dan `operator` hanya dapat memiliki satu membership aktif.
- Role aktif satu akun wajib konsisten pada seluruh membership. `super_admin` dibuat dan disinkronkan oleh `ensure_superadmin` dari `SUPER_ADMIN_USERNAME` di `.env`; user `is_superuser` server-side mendapat role efektif `super_admin` pada semua tenant aktif tanpa membership eksplisit per tenant. UI hanya menampilkannya sebagai data read-only.
- `Operator` selalu memiliki `User` melalui relasi wajib berstrategi `PROTECT`. Pembuatan akun, membership, dan profil Operator dilakukan dalam satu transaksi melalui API administrasi.
- Tenant baru memberi membership `super_admin` kepada pembuat. Data referensi tenant dapat dilengkapi dengan perintah `bootstrap_tenants`.

## Permission Matrix

| Kapabilitas | Super Admin | Kepala Konveksi | Finance | Operator |
| --- | --- | --- | --- | --- |
| Kelola tenant | Ya | Tidak | Tidak | Tidak |
| Kelola Kepala Konveksi/Finance | Ya | Tidak | Tidak | Tidak |
| Kelola Operator tenant aktif | Ya | Ya | Tidak | Tidak |
| Reset password akun lain | Ya | Tidak | Tidak | Tidak |
| Ganti password sendiri | Ya | Ya | Ya | Ya |

Guard frontend hanya mengatur visibilitas dan navigasi. Setiap keputusan otorisasi tetap divalidasi backend. Akses Operator oleh Kepala Konveksi selalu menggunakan tenant aktif dari session dan tidak menerima tenant ID arbitrer dari client.

## Lifecycle

- Penonaktifan akun atau operator membutuhkan alasan dan berlaku pada request berikutnya karena pemeriksaan session memvalidasi ulang status user dan membership.
- Pengguna tidak dapat menonaktifkan atau menghapus akunnya sendiri.
- Hard delete memerlukan alasan, konfirmasi nama/username, dan password pelaksana. Eligibility dihitung server-side: akun belum pernah login serta tidak memiliki audit/relasi bisnis; Operator dihapus sebagai bundle akun–membership–profil jika seluruh bundle belum digunakan.
- Tenant hanya dapat dihapus ketika tidak memiliki data selain bootstrap dan membership pembuat yang diizinkan.
- Perubahan tenant, role, membership, status, password, dan delete menghasilkan `AuditEvent`. Nilai password tidak pernah dimasukkan ke detail audit atau response.

## API dan UI

- API autentikasi: `POST /api/auth/change-password`.
- API administrasi: `/api/administration/tenants`, `/api/administration/users`, dan `/api/administration/operators` beserta endpoint aktivasi, reset password, dan delete.
- UI: `/dashboard/settings/tenants`, `/dashboard/settings/users`, dan `/dashboard/settings/operators`.
- List API mendukung pencarian, filter, sort allowlist, dan pagination dengan batas maksimal 100 baris.
