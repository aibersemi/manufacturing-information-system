# Application Architecture and Angular Integration

Dokumen ini menjelaskan arsitektur aplikasi Manufacturing Information System (MIS) yang dibangun menggunakan Angular v22+, integrasi reaktif dengan Supabase, pengelolaan environment, dan perintah operasional.

---

## Technical Stack

- **Framework**: Angular v22 (Standalone components, Zoneless change detection)
- **Language**: TypeScript (Strict mode)
- **State Management**: Angular Signals (`signal()`, `computed()`, `linkedSignal()`, `resource()`)
- **UI Library**: spartan/ui v1.4.1 (Brain primitives + Helm components bergaya Luma)
- **Styling**: Tailwind CSS v4 dengan CSS design tokens OKLCH
- **Typography**: `@fontsource-variable/inter` (Inter Variable)
- **Icons**: `@ng-icons/core` & `@ng-icons/phosphor-icons` (Phosphor Regular)
- **Notifications**: `@spartan-ng/brain/sonner` & `@spartan-ng/helm/sonner`
- **Backend SDK**: `@supabase/supabase-js` dengan schema types otomatis dari PostgreSQL

---

## Directory Structure

```text
src/
├── app/
│   ├── core/
│   │   ├── guards/
│   │   │   ├── auth.guard.ts           # Functional route guard (CanActivateFn) dengan returnUrl
│   │   │   ├── guest.guard.ts          # Guard pencegah akses login untuk sesi aktif
│   │   │   └── owner.guard.ts          # Guard pembatasan akses khusus peran Owner
│   │   ├── services/
│   │   │   ├── auth.service.ts         # Reactive session & user state via Signals + waitForAuthReady()
│   │   │   ├── company.service.ts      # Multi-company context, RLS tenant scope, & local storage persistence
│   │   │   ├── master-data.service.ts  # Layanan CRUD UOM, Pelanggan, Pemasok, Material, Produk, BOM, Pegawai, & Tarif Upah
│   │   │   ├── production.service.ts   # Layanan Operasional Pabrik: Perintah Produksi, SPK 4 Tahap, Catat Potong/Sablon, Bundle, & Repair
│   │   │   ├── purchasing-inventory.service.ts # Layanan Pengadaan (Bahan, Perlengkapan, Non-Produksi, Pembayaran) & Inventaris
│   │   │   ├── settings.service.ts     # Layanan CRUD Perusahaan, Penugasan Pengguna, Matriks Izin, Profil, & Audit
│   │   │   ├── storage.service.ts      # Layanan upload, signed URL, & manajemen file Supabase Storage
│   │   │   └── supabase.service.ts     # Singleton Supabase client wrapper (PKCE Flow)
│   │   └── utils/
│   │       └── url.util.ts             # Sanitasi URL & mitigasi Open Redirect
│   ├── features/
│   │   ├── auth/login/                 # Komponen halaman masuk login
│   │   ├── dashboard/                  # Komponen overview metrik manufaktur
│   │   ├── inventory/                  # Modul Buku Besar Inventaris, Kartu Mutasi, & Roll (/workspace/inventory)
│   │   ├── master-data/                # Modul Master Data & Bill of Materials
│   │   │   ├── bom/                    # Komponen resep Bill of Materials (/workspace/bom)
│   │   │   ├── customers/              # Komponen pelanggan (/workspace/customers)
│   │   │   ├── employees/              # Komponen tenaga kerja/operator (/workspace/employees)
│   │   │   ├── materials/              # Komponen bahan baku & inventory cost (/workspace/materials)
│   │   │   ├── products/               # Komponen produk SKU & alur routing (/workspace/products)
│   │   │   ├── suppliers/              # Komponen pemasok bahan baku (/workspace/suppliers)
│   │   │   ├── uom/                    # Komponen satuan pengukuran standar (/workspace/materials/uom)
│   │   │   └── wage-rates/             # Komponen matriks tarif upah borongan (/workspace/wage-rates)
│   │   ├── production/                 # Modul Operasional Pabrik & Produksi
│   │   │   ├── orders/                 # Manajemen Perintah Produksi (PP) (/workspace/production-orders)
│   │   │   ├── spk/                    # Surat Perintah Kerja 4 Tahap (/workspace/spk)
│   │   │   ├── operator-cutting/       # Catat Hasil Potong Roll Kain Operator (/workspace/operator-cutting)
│   │   │   ├── operator-printing/      # Catat Pengerjaan Sablon Operator (/workspace/operator-printing)
│   │   │   ├── repairs/                # Kasus Perbaikan & Penugasan Ulang (/workspace/production-repairs)
│   │   │   └── progress/               # Pipeline Progres Produksi & Visualisasi (/workspace/production-progress)
│   │   ├── purchasing/                 # Modul Pengadaan & Pembelian
│   │   │   ├── materials/              # Pengadaan Bahan Baku (/workspace/purchase-materials)
│   │   │   ├── supplies/               # Pengadaan Perlengkapan Pabrik (/workspace/purchase-supplies)
│   │   │   ├── non-production/         # Belanja Non-Produksi & Umum (/workspace/purchase-non-production)
│   │   │   └── payments/               # Pembayaran Hutang & Kas Keluar (/workspace/purchase-payments)
│   │   └── settings/
│   │       ├── companies/              # Manajemen fasilitas manufaktur & multi-company (/workspace/companies)
│   │       ├── users-access/           # Penugasan staf & matriks izin akses per peran (/workspace/users-access)
│   │       └── profile/                # Profil pribadi, data rekening bank, & ganti password (/workspace/profile)
│   ├── layout/
│   │   └── dashboard-layout/           # Layout utama (sidebar navigasi + header profil)
│   ├── app.config.ts                   # Provider zoneless, router, & error listeners
│   ├── app.routes.ts                   # Rute modular dengan lazy loading & guard otorisasi
│   └── app.ts                          # Root component
├── environments/
│   ├── environment.example.ts          # Template deklarasi variabel environment
│   ├── environment.ts                  # Di-generate otomatis dari .env (di-ignore git)
│   └── environment.development.ts      # Di-generate otomatis dari .env (di-ignore git)
├── types/
│   └── database.types.ts               # Tipe data TypeScript skema PostgreSQL Supabase
├── main.ts                             # Entry point bootstrap aplikasi zoneless
└── styles.css                          # Global CSS design tokens & utilities
```

---

## Environment & Security Management

- Frontend hanya mengakses variabel publik: `SUPABASE_URL` dan `SUPABASE_ANON_KEY`.
- Variabel rahasia seperti `SERVICE_ROLE_KEY` dilarang keras masuk ke dalam bundle klien.
- File konfigurasi `src/environments/environment.ts` dibuat secara otomatis sebelum build atau start menggunakan script `scripts/generate-env.mjs` yang membaca nilai langsung dari `.env` lokal tanpa meng-commit file environment ke repositori.

---

## Operational Commands

| Perintah | Deskripsi |
| :--- | :--- |
| `npm start` | Menjalankan generate environment dan start server development (`ng serve`) |
| `npm run build` | Melakukan kompilasi bundle produksi aplikasi (`ng build`) |
| `npm run serve:prod` | Menjalankan web server statis produksi (SPA fallback di port `${APP_PORT}`) |
| `npm test` | Menjalankan pengujian unit berbasis Vitest (`ng test`) |
| `npm run lint` | Menjalankan analisis statis kode dan template HTML menggunakan angular-eslint |
| `npm run types:db` | Meng-generate ulang `src/types/database.types.ts` dari skema database aktif |
| `sudo systemctl status manufacturing-information-system` | Memeriksa status unit systemd service produksi |
| `sudo journalctl -u manufacturing-information-system -f` | Memantau log realtime service |

---

## AI Pair Programming & MCP Tools

Proyek ini telah dikonfigurasi dengan:
- **Local Agent Skills**: `.agents/skills/angular-developer`, `.agents/skills/angular-new-app`, `.agents/skills/spartan`, `.agents/skills/supabase`, dan `.agents/skills/supabase-postgres-best-practices`.
- **Local MCP Servers**: [.agents/mcp_config.json](../.agents/mcp_config.json) yang mencakup **Angular CLI MCP** (`get_best_practices`, `run_target`, `devserver`), **Spartan MCP** (`spartan_components_get`, `spartan_blocks_get`, `spartan_accessibility_check`, dokumentasi UI), dan **Supabase DB MCP** (`query`, `execute`, `list_tables`, `describe_table`).
- **Frontend Guidelines**: [.agents/rules/angular.md](../.agents/rules/angular.md) untuk memastikan penulisan kode modern bebas dari pola legacy.
- **UI/UX Design System Standards**: [docs/ui-ux-standards.md](ui-ux-standards.md) sebagai acuan baku tata letak, ukuran font, palet, dan blueprint halaman baru.

---

## Examples

Contoh modern standalone component Angular v22+ dengan signals dan native control flow:

```ts
import { Component, signal } from '@angular/core';

@Component({
  selector: 'app-server-status',
  templateUrl: './server-status.component.html',
  styleUrl: './server-status.component.css',
})
export class ServerStatusComponent {
  protected readonly isServerRunning = signal(true);

  toggleServerStatus(): void {
    this.isServerRunning.update(running => !running);
  }
}
```

```css
.container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;

  button {
    margin-top: 10px;
  }
}
```

```html
<section class="container">
  @if (isServerRunning()) {
    <span>Yes, the server is running</span>
  } @else {
    <span>No, the server is not running</span>
  }
  <button type="button" (click)="toggleServerStatus()">Toggle Server Status</button>
</section>
```

Saat memperbarui komponen, tempatkan logic di dalam file `.ts`, styles di dalam file `.css`, dan HTML template di dalam file `.html` menggunakan relative paths.

### Integrasi Supabase Storage di Angular Component

```ts
import { Component, inject, signal } from '@angular/core';
import { StorageService } from '../../core/services/storage.service';

@Component({
  selector: 'app-qc-upload',
  template: `
    <input type="file" (change)="onFileSelected($event)" accept="image/*,video/*,.pdf" />
    @if (previewUrl()) {
      <img [src]="previewUrl()" alt="QC Preview" class="w-48 h-48 rounded object-cover" />
    }
  `
})
export class QcUploadComponent {
  private readonly storage = inject(StorageService);
  protected readonly previewUrl = signal<string | null>(null);

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    // 1. Upload ke bucket privat manufacturing-media
    const uploaded = await this.storage.uploadFile(file, undefined, { folder: 'qc-inspections' });

    // 2. Buat Signed URL sementara untuk preview aman di browser
    const signedUrl = await this.storage.getSignedUrl(uploaded.path, 1800);
    this.previewUrl.set(signedUrl);
  }
}
```

---

## Modul Master Data & Bill of Materials (BOM)

Modul Master Data mengelola seluruh entitas pondasi proses manufaktur:

1. **Satuan Pengukuran (`unit_definition`)** (`/workspace/materials/uom`):
   - Standarisasi UOM global & multi-company (`m`, `yard`, `kg`, `gram`, `pcs`, `lusin`, dll).
2. **Pelanggan (`customer`)** (`/workspace/customers`):
   - Data kontak, telepon, dan alamat pengiriman pesanan produksi.
3. **Pemasok (`supplier`)** (`/workspace/suppliers`):
   - Rekanan vendor bahan baku dengan nomor kontak dan alamat.
4. **Bahan Baku (`material`)** (`/workspace/materials`):
   - Master material dengan kalkulasi unit price otomatis (`default_price / unit_size`).
5. **Produk & SKU (`product`)** (`/workspace/products`):
   - Pengelolaan SKU unik per perusahaan, harga jual, dan alur proses routing cetak/sablon (`production_product_routing`).
6. **Bill of Materials (`bom`)** (`/workspace/bom`):
   - Definisi resep komponen bahan baku (`bom_item`), rasio kebutuhan per output produk, dan estimasi biaya standar.
7. **Tenaga Kerja (`employee`)** (`/workspace/employees`):
   - Master operator/karyawan dan stasiun kerja utama (Cutting, Sewing, Finishing, QC, Packing).
8. **Matriks Tarif Upah (`wage_rate`)** (`/workspace/wage-rates`):
   - Tarif upah borongan per produk dan tahap pengerjaan (`cutting`, `sewing`, `finishing`, dll) dengan format kode `WR-${SKU}-${service_kind}`.

---

## Modul Pengadaan (Purchasing) & Buku Besar Inventaris (Inventory Ledger)

Modul ini mengelola siklus lengkap pengadaan barang operasional dan pencatatan buku besar inventaris perpetual yang terintegrasi secara ACID:

1. **Pengadaan Bahan Baku (`purchase_material`)** (`/workspace/purchase-materials`):
   - Pengadaan kain dan material utama tekstil dengan penomoran otomatis `BL-YYMMDD-###`.
   - Pemilihan pemasok terdaftar (`master_record` kind `supplier`), metode pembayaran (*Hutang/Payable* vs *Tunai/Cash*), dan penentuan rincian unit kemasan fisik roll kain.
   - Posting dokumen via stored procedure atomik `post_purchase_document`:
     - Menghasilkan buku besar mutasi stok (`inventory_movement`) tipe `purchase_receipt`.
     - Meng-generate unit fisik roll kain (`production_material_unit`) dengan kode fisik unik `BL-YYMMDD-###-L{line}-{roll}` berstatus `available`.
     - Mencatat jurnal akuntansi persediaan dan buku pembantu hutang dagang (`subledger_entry` kind `supplier_payable`).
   - Pembatalan transaksi dokumen berstatus posted via `void_purchase_document` yang membatalkan mutasi stok, menandai roll `voided`, dan membalikkan jurnal keuangan.

2. **Pengadaan Perlengkapan Pabrik (`purchase_supply`)** (`/workspace/purchase-supplies`):
   - Pengadaan perlengkapan operasional pabrik (benang, kancing, jarum, plastik kemasan, dll) dengan prefix nomor `BP-YYMMDD-###`.
   - Pencatatan mutasi stok perpetual perlengkapan manufaktur (`inventory_state = 'production_supply'`).

3. **Belanja Non-Produksi & Umum (`purchase_non_production`)** (`/workspace/purchase-non-production`):
   - Pengeluaran belanja umum, ATK kantor, dan operasional non-manufaktur dengan prefix nomor `BN-YYMMDD-###`.
   - Pembebanan langsung ke akun biaya/beban operasional tanpa mutasi inventaris fisik.

4. **Pembayaran Hutang & Kas Keluar (`purchase_payment`)** (`/workspace/purchase-payments`):
   - Mengelola pelunasan kewajiban hutang pemasok atas pembelian berstatus posted yang belum lunas (`paid_amount < total_amount`).
   - Posting pembayaran via stored procedure `post_purchase_payment`:
     - Membuat bukti pengeluaran kas (`business_document` kind `purchase_payment`) dengan nomor `KK-YYMMDD-###`.
     - Mengurangi saldo hutang pada dokumen pembelian acuan (`paid_amount`).
     - Mencatat pergerakan kas keluar (`cash_movement` jenis `expense`) terhadap akun kas/bank yang dipilih.
     - Mengupdate buku pembantu hutang pemasok (`subledger_entry`) dan membukukan jurnal debet hutang dagang vs kredit kas/bank.
   - Menyediakan tab riwayat pembayaran kas keluar lengkap beserta detail bukti transaksi.

5. **Buku Besar Inventaris & Pelacakan Roll (`inventory`)** (`/workspace/inventory`):
   - **Ringkasan Valuasi Stok (`get_inventory_summary`)**: Menampilkan posisi stok terkini, kuantitas masuk, kuantitas keluar, harga rata-rata bergerak (*Moving Average Cost*), dan estimasi total valuasi aset gudang per item.
   - **Buku Besar Kartu Mutasi (`inventory_movement`)**: Jejak transaksi mutasi persediaan perpetual berurutan waktu lengkap dengan referensi dokumen acuan.
   - **Pelacakan Unit Fisik Roll Kain (`production_material_unit`)**: Pemantauan fisik unit kemasan roll kain, kuantitas awal, sisa kuantitas dasar, satuan stok, dan status fisik (`available`, `allocated`, `consumed`, `voided`).

---

## Modul Operasional Pabrik & Produksi (Production & SPK Workflows)

Modul ini mengelola alur manufaktur end-to-end dari penetapan target produksi hingga pembentukan barang jadi, mencakup 4 tahapan operasional (*Cutting*, *Printing*, *Sewing*, *Packing*), pelacakan ikatan/bundle, kasus perbaikan (*repair cases*), dan perhitungan upah borongan:

1. **Perintah Produksi / Production Order (`production_order`)** (`/workspace/production-orders`):
   - Mengelola dokumen induk pesanan manufaktur dengan penomoran urut otomatis `PP-YYMMDD-###` via RPC `create_production_order`.
   - Snapshot jalur routing sablon fail-closed (`production_product_routing`) untuk setiap SKU terdaftar.
   - Target kuantitas diatur dalam satuan bilangan bulat positif (`PCS`).
   - Invariant penguncian permanen: saat SPK Potong pertama kali dibuat untuk PP ini, field `data.code_locked` otomatis terkunci menjadi `true` guna mencegah perubahan spesifikasi di tengah proses pabrikasi.

2. **Surat Perintah Kerja 4 Tahap (`spk_*`)** (`/workspace/spk`):
   - Penerbitan SPK untuk 4 tahapan stasiun kerja pabrik melalui RPC atomik `create_spk`:
     - **SPK Potong**: `SPK-POT-YYMMDD-###` (khusus operator dengan profil `operator_potong`).
     - **SPK Sablon**: `SPK-SAB-YYMMDD-###` (khusus operator dengan profil `operator_sablon`).
     - **SPK Jahit**: `SPK-JAH-YYMMDD-###` (khusus operator dengan profil `operator_jahit`).
     - **SPK Packing**: `SPK-PAK-YYMMDD-###` (khusus operator dengan profil `operator_packing`).
   - Menyediakan pemilihan ikatan komponen (*bundles*) yang memenuhi syarat (*eligible bundles*) untuk diproses pada stasiun kerja terkait.
   - Mengunci dan mencatat reservasi bundle ke dalam tabel `production_bundle_reservation` agar tidak terjadi penugasan ganda.

3. **Catat Potong Roll Operator (`cutting_output`)** (`/workspace/operator-cutting`):
   - Konfirmasi pengerjaan pemotongan bahan kain fisik berbasis roll utuh (`production_material_unit`) via RPC `confirm_operator_cutting`.
   - Validasi kesesuaian formula Bill of Materials (BOM) aktif terhadap material roll kain yang dipotong.
   - Mengonsumsi roll kain secara utuh (`status = 'consumed'`), membentuk Cutting Lot (`production_cutting_lot`), dan menerbitkan dokumen aktual `ACT-POT-YYMMDD-###`.
   - Menghasilkan ikatan komponen fisik (`production_bundle`) berformat `LOT-YYMMDD-###-SKU-##` dengan ukuran, kuantitas aktif, dan kondisi `available` pada tahap `cutting`.
   - Membukukan mutasi inventori WIP komponen potong (`cut_components`) dan menghitung kewajiban upah borongan pemotongan (`wage_liability`).

4. **Catat Pengerjaan Sablon Operator (`printing_output`)** (`/workspace/operator-printing`):
   - Konfirmasi hasil pengerjaan sablon per ikatan komponen via RPC `confirm_operator_printing`.
   - Mengalokasikan hasil ke dalam 3 kategori kuantitas:
     - **Kuantitas Sukses**: Komponen lolos sablon yang dipindahkan ke mutasi inventori `printed_components` dan siap masuk stasiun Jahit.
     - **Kuantitas Butuh Perbaikan**: Komponen cacat tinta/noda yang otomatis memicu pembentukan Kasus Perbaikan (`production_repair_case`).
     - **Kuantitas Reject**: Komponen rusak permanen yang dicatat ke `final_rejected_quantity`.
   - Membukukan kewajiban upah borongan sablon (`wage_liability`) berdasarkan kuantitas yang diproses dan melepaskan reservasi bundle.
   - Mengubah status SPK Sablon menjadi `completed` jika seluruh bundle terkait telah selesai dikonfirmasi.

5. **Kasus Perbaikan & Penugasan SPK Repair (`repair_case`)** (`/workspace/production-repairs`):
   - Manajemen pemantauan komponen cacat produksi dengan alur status: `open` -> `assigned` -> `in_progress` -> `completed` / `scrapped`.
   - Penugasan penanganan kasus perbaikan kepada operator via RPC `assign_repair_spk`:
     - Menerbitkan SPK Perbaikan khusus `SPK-REP-YYMMDD-###`.
     - Mendukung 3 mode upah borongan:
       - `none` / Penalty: Tarif upah Rp 0 (pengerjaan ulang akibat kelalaian pengerjaan).
       - `reference`: Mengadopsi tarif standar layanan asli dari tabel `wage_rate`.
       - `custom` / `special_rate`: Menetapkan tarif upah khusus yang disepakati secara manual.

6. **Pipeline Progres Produksi & Visualisasi Metrik (`production_progress`)** (`/workspace/production-progress`):
   - Pemantauan kemajuan terintegrasi seluruh Perintah Produksi melalui fungsi analitik `get_production_progress_summary`.
   - Visualisasi pipeline kuantitas per tahapan: **Target PP** -> **Potong (Cut)** -> **Sablon (Print)** -> **Jahit (Sew)** -> **Kemas (Pack)**.
   - Menghitung persentase penyelesaian pesanan (`completionPercentage`), jumlah ikatan aktif yang sedang beredar di lantai pabrik (*active bundles*), dan kasus perbaikan yang belum selesai (*active repairs*).
   - Pemantauan status dokumen, target tanggal penyelesaian, dan indikator penguncian spesifikasi teknis (*code locked*).



