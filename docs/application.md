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
│   │   │   ├── asset.service.ts        # Layanan Aset Tetap: Pengadaan, Register Fisik, Penyusutan Bulanan, & Pelepasan
│   │   │   ├── auth.service.ts         # Reactive session & user state via Signals + waitForAuthReady()
│   │   │   ├── company.service.ts      # Multi-company context, RLS tenant scope, & local storage persistence
│   │   │   ├── finance.service.ts      # Layanan Keuangan & Buku Besar: COA, Kas/Bank, Biaya, Upah, Prepaid, SA, Jurnal, Periode
│   │   │   ├── master-data.service.ts  # Layanan CRUD UOM, Pelanggan, Pemasok, Material, Produk, BOM, Pegawai, & Tarif Upah
│   │   │   ├── production.service.ts   # Layanan Operasional Pabrik: Perintah Produksi, SPK 4 Tahap, Catat Potong/Sablon/Jahit/Packing, Bundle, & Repair
│   │   │   ├── purchasing-inventory.service.ts # Layanan Pengadaan (Bahan, Perlengkapan, Non-Produksi, Pembayaran) & Inventaris
│   │   │   ├── report.service.ts       # Layanan Laporan Keuangan, HPP Pabrikasi & Rekonsiliasi Audit Subledger-GL (Fase 9)
│   │   │   ├── sales.service.ts        # Layanan Penjualan & Piutang: Customer PO, Faktur Penjualan, Penerimaan Piutang, & Pemenuhan
│   │   │   ├── settings.service.ts     # Layanan CRUD Perusahaan, Penugasan Pengguna, Matriks Izin, Profil, & Audit
│   │   │   ├── storage.service.ts      # Layanan upload, signed URL, & manajemen file Supabase Storage
│   │   │   └── supabase.service.ts     # Singleton Supabase client wrapper (PKCE Flow)
│   │   └── utils/
│   │       └── url.util.ts             # Sanitasi URL & mitigasi Open Redirect
│   ├── features/
│   │   ├── assets/                     # Modul Aset Tetap & Penyusutan (Fase 8)
│   │   │   ├── purchases/              # Pengadaan Aset Tetap (/workspace/asset-purchases)
│   │   │   ├── register/               # Register & Pengaturan Parameter Aset (/workspace/assets)
│   │   │   ├── depreciation/           # Pratinjau & Eksekusi Penyusutan Bulanan (/workspace/depreciation)
│   │   │   └── disposals/              # Pelepasan Aset, Laba/Rugi & Kas Masuk (/workspace/asset-disposals)
│   │   ├── auth/login/                 # Komponen halaman masuk login
│   │   ├── dashboard/                  # Komponen overview metrik manufaktur
│   │   ├── finance/                    # Modul Keuangan, Akuntansi & Buku Besar (Fase 7)
│   │   │   ├── cash-bank/              # Manajemen Likuiditas Kas & Transfer Antar Bank (/workspace/finance/cash-bank)
│   │   │   ├── coa/                    # Bagan Akun & Pemetaan Sistem 21 Akun (/workspace/finance/coa)
│   │   │   ├── expenses/               # Biaya Operasional Tunai & Akrual (/workspace/finance/expenses)
│   │   │   ├── journals/               # Jurnal Memorial & Jurnal Pembalik (/workspace/finance/journals)
│   │   │   ├── opening-balance/        # Saldo Awal Neraca & Kas Terseimbang (/workspace/finance/opening-balance)
│   │   │   ├── period-close/           # Audit 4 Kontrol & Penutupan Periode Buku (/workspace/finance/period-close)
│   │   │   ├── prepaid/                # Biaya Dibayar Dimuka & Amortisasi (/workspace/finance/prepaid)
│   │   │   └── wages/                  # Pembayaran Upah & Gaji Borongan Operator (/workspace/finance/wages)
│   │   ├── inventory/                  # Modul 5 Kategori Stok, Buku Besar Inventaris, Mutasi, & Roll (/workspace/inventory)
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
│   │   │   ├── operator-sewing/        # Catat Hasil Jahit Operator (/workspace/operator-sewing)
│   │   │   ├── operator-packing/       # Catat Hasil Kemas & Packing Operator (/workspace/operator-packing)
│   │   │   ├── repairs/                # Kasus Perbaikan & Penugasan Ulang (/workspace/production-repairs)
│   │   │   └── progress/               # Pipeline Progres Produksi & Visualisasi (/workspace/production-progress)
│   │   ├── purchasing/                 # Modul Pengadaan & Pembelian
│   │   │   ├── materials/              # Pengadaan Bahan Baku (/workspace/purchase-materials)
│   │   │   ├── supplies/               # Pengadaan Perlengkapan Pabrik (/workspace/purchase-supplies)
│   │   │   ├── non-production/         # Belanja Non-Produksi & Umum (/workspace/purchase-non-production)
│   │   │   └── payments/               # Pembayaran Hutang & Kas Keluar (/workspace/purchase-payments)
│   │   ├── reports/                    # Modul Laporan Keuangan, HPP & Rekonsiliasi (Fase 9)
│   │   │   ├── balance-sheet/          # Neraca Keuangan Sesuai Standar Akuntansi (/workspace/reports/balance-sheet)
│   │   │   ├── cash-flow/              # Laporan Arus Kas Metode Langsung (/workspace/reports/cash-flow)
│   │   │   ├── general-ledger/         # Buku Besar Detail per Akun dengan Running Balance (/workspace/reports/general-ledger)
│   │   │   ├── hpp/                    # Laporan HPP & Biaya Pabrikasi 3 Unsur (/workspace/reports/hpp)
│   │   │   ├── profit-loss/            # Laporan Laba Rugi Komprehensif (/workspace/reports/profit-loss)
│   │   │   ├── reconciliation/         # Matriks Rekonsiliasi 6 Pos Kontrol Subledger vs GL (/workspace/reports/reconciliation)
│   │   │   └── trial-balance/          # Neraca Saldo Debet/Kredit Terseimbang (/workspace/reports/trial-balance)
│   │   ├── sales/                      # Modul Penjualan & Piutang Dagang (Accounts Receivable)
│   │   │   ├── orders/                 # Pesanan Penjualan Pelanggan / Customer PO (/workspace/sales-orders)
│   │   │   ├── invoices/               # Faktur Penjualan & Pengurangan Stok Jadi (/workspace/sales)
│   │   │   ├── receipts/               # Penerimaan Pembayaran Piutang (/workspace/sales-receipts)
│   │   │   └── fulfillment/            # Pelacakan Pengiriman & Pemenuhan Pesanan (/workspace/sales-fulfillment)
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

## Layout & Navigasi Aplikasi (Dashboard Shell & Core Business Modules)

Antarmuka utama Manufacturing Information System (MIS) dibungkus oleh komponen shell `DashboardLayoutComponent` (`src/app/layout/dashboard-layout/`) yang menyatukan header profil/tenant switcher dan sidebar navigasi collapsible. Navigasi aplikasi dikelompokkan ke dalam 8 modul bisnis utama berbasis alur operasional konveksi:

### Struktur 8 Modul Navigasi Bisnis Utama

1. **Penjualan (Sales & Customer Orders)**:
   - **Rute Menu**:
     - *Daftar PO (PO Masuk)*: `/workspace/sales-orders` (Manajemen pesanan penjualan pelanggan / Customer PO).
     - *Penjualan*: `/workspace/sales` (Penerbitan faktur penjualan / Sales Invoice & pengurangan stok barang jadi).
     - *Penerimaan Piutang*: `/workspace/sales-receipts` (Pencatatan kas masuk pelunasan piutang pelanggan / AR Receipts).
     - *Pengiriman & Pemenuhan*: `/workspace/sales-fulfillment` (Pelacakan surat jalan logistik & pemenuhan pesanan).
   - **Tujuan Operasional**: Mengelola siklus pesanan pelanggan dari konfirmasi PO, penagihan piutang, pelunasan pembayaran, hingga serah terima barang jadi.

2. **Pembelian (Purchasing & Material Procurement)**:
   - **Rute Menu**:
     - *Bahan Produksi*: `/workspace/purchase-materials` (Pengadaan kain utama & pembentukan roll fisik `production_material_unit`).
     - *Perlengkapan Produksi*: `/workspace/purchase-supplies` (Pengadaan aksesoris/perlengkapan pabrik: benang, kancing, resleting).
     - *Non-Produksi*: `/workspace/purchase-non-production` (Belanja operasional kantor & kebutuhan umum/ATK).
     - *Belanja Aset*: `/workspace/asset-purchases` (Pengadaan mesin & barang modal manufaktur / CapEx).
   - **Tujuan Operasional**: Memastikan ketersediaan bahan baku dan perlengkapan lantai kerja melalui pengadaan yang tercatat langsung ke mutasi persediaan perpetual dan hutang usaha pemasok.

3. **Produksi (Production Planning & SPK Management / Kepala Konveksi)**:
   - **Rute Menu**:
     - *SPK Potong*: `/workspace/spk` (Penerbitan surat perintah kerja pemotongan roll kain per lot).
     - *SPK Jahit*: `/workspace/spk` (Penerbitan surat perintah kerja perakitan komponen jahit).
     - *Progress SPK*: `/workspace/production-progress` (Visualisasi metrik pipeline tahapan manufaktur: Potong → Sablon → Jahit → Kemas).
     - *Perintah Produksi*: `/workspace/production-orders` (Dokumen induk target pesanan pabrikasi / Production Order).
     - *Kasus Perbaikan*: `/workspace/production-repairs` (Audit dan penerbitan SPK perbaikan ikatan komponen cacat).
   - **Tujuan Operasional**: Memberikan kendali penuh kepada Kepala Konveksi untuk menerbitkan instruksi kerja resmi (SPK), memonitor throughput lini pabrik, serta menangani komponen rework/defect.

4. **Operator (Shop Floor Execution & Labor Confirmations)**:
   - **Rute Menu**:
     - *Catat Potongan*: `/workspace/operator-cutting` (Konfirmasi pemotongan roll kain menjadi ikatan komponen via `confirm_operator_cutting`).
     - *Catat Sablon*: `/workspace/operator-printing` (Konfirmasi hasil pengerjaan sablon/cetak via `confirm_operator_printing`).
     - *Catat Jahit*: `/workspace/operator-sewing` (Konfirmasi hasil jahit komponen via `confirm_operator_sewing`).
     - *Catat Packing*: `/workspace/operator-packing` (Konfirmasi penyelesaian dan kemas barang jadi via `confirm_operator_packing`).
   - **Tujuan Operasional**: Antarmuka ringkas khusus lantai kerja bagi operator stasiun kerja untuk mengonfirmasi hasil fisik per bundle, yang secara otomatis membukukan mutasi WIP/produk jadi dan menghitung kewajiban upah borongan (`wage_liability`).

5. **Stok (Warehouse Inventory & 5-View Breakdown)**:
   - **Rute Menu**: `/workspace/inventory` dengan parameter URL:
     - *Stok Bahan*: `?tab=stok-bahan` (Posisi persediaan bahan baku kain, UOM, dan nilai valuasi perolehan).
     - *Stok Masuk*: `?tab=stok-masuk` (Riwayat mutasi penerimaan barang dari pembelian vendor).
     - *Stok Keluar*: `?tab=stok-keluar` (Riwayat pengeluaran bahan untuk produksi, penjualan, atau limbah).
     - *Stok Produksi*: `?tab=stok-produksi` (Pelacakan ikatan komponen WIP yang sedang berproses di stasiun pabrik).
     - *Stok Produk Jadi*: `?tab=stok-produk-jadi` (Inventori produk siap jual dari gudang dan hasil packing).
   - **Tujuan Operasional**: Memberikan visibilitas terperinci atas 5 kategori kondisi stok fisik dengan sinkronisasi URL query parameter dan kartu ringkasan metrik KPI terintegrasi.

6. **Transaksi (Operational Transactions & Disbursements)**:
   - **Rute Menu**:
     - *Bayar Pembelian*: `/workspace/purchase-payments` (Pelunasan faktur hutang dagang kepada pemasok).
     - *Bayar Pegawai*: `/workspace/finance/wages` (Pembayaran kewajiban upah borongan operator SPK dan gaji).
     - *Biaya Operasional*: `/workspace/finance/expenses` (Pencairan kas/bank untuk beban operasional umum tunai/akrual).
     - *Terima Pembayaran Penjualan*: `/workspace/sales-receipts` (Penerimaan kas pelunasan piutang pelanggan).
   - **Tujuan Operasional**: Eksekusi pergerakan kas keluar dan kas masuk harian yang langsung memperbarui buku pembantu kas (*subledger*) dan jurnal umum akuntansi.

7. **Keuangan (Finance, Accounting & Financial Reports)**:
   - **Rute Menu**:
     - *Buku Besar & Jurnal*: `/workspace/finance/journals` (Jurnal Memorial & Pembalik), `/workspace/reports/general-ledger` (Buku Besar Akun), `/workspace/reports/trial-balance` (Neraca Saldo).
     - *Laporan Finansial Standar*: `/workspace/reports/profit-loss` (Laba Rugi Periodik), `/workspace/reports/balance-sheet` (Neraca Keuangan Kumulatif), `/workspace/reports/cash-flow` (Arus Kas Metode Langsung).
     - *Analitik Pabrikasi & Audit*: `/workspace/reports/hpp` (Laporan HPP Pabrikasi 3 Unsur), `/workspace/reports/reconciliation` (Audit Integritas 6 Pos Subledger vs GL).
     - *Aset Tetap*: `/workspace/assets` (Register Fisik Aset), `/workspace/depreciation` (Penyusutan Bulanan), `/workspace/asset-disposals` (Pelepasan & Laba/Rugi Aset).
   - **Tujuan Operasional**: Penyelenggaraan pembukuan PSAK berpasangan (*Double-Entry Bookkeeping*), pelaporan HPP pabrikasi riil, tata kelola depresiasi aset modal, dan verifikasi kontrol internal.

8. **Pengaturan (Settings & Administration)**:
   - **Rute Menu**:
     - *Konveksi (Multi Tenant)*: `/workspace/companies` (Pendaftaran entitas pabrik, alihan tenant aktif, dan bootstrap data awal).
     - *Pengguna & Akses*: `/workspace/users-access` (Penugasan pengguna dan konfigurasi matriks izin akses per peran).
     - *Profil Pengguna*: `/workspace/profile` (Pengaturan identitas akun pengguna, rekening bank pembayaran upah, dan keamanan sandi).
   - **Tujuan Operasional**: Tata kelola isolasi data multi-perusahaan, administrasi akun pengguna, dan penegakan matriks otorisasi sistem.

*(Catatan: Menu tambahan **Master Data** (`/workspace/customers`, `/workspace/suppliers`, `/workspace/materials`, `/workspace/bom`, `/workspace/products`, `/workspace/materials/uom`, `/workspace/employees`, `/workspace/wage-rates`) serta **Dashboard Utama** (`/`) melengkapi navigasi sistem secara menyeluruh).*

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

## Modul Pengadaan (Purchasing)

Modul ini mengelola siklus lengkap pengadaan barang operasional pabrik yang terintegrasi secara ACID dengan pencatatan hutang usaha dan mutasi persediaan:

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

---

## Modul Stok & Inventori Gudang (Warehouse Inventory & Stock Management)

Modul Stok dan Inventori Gudang (`/workspace/inventory`) menyediakan kontrol persediaan perpetual berbasis waktu nyata (*real-time perpetual inventory*) dengan pemisahan 5 tampilan tab stok spesifik, integrasi filter URL query parameter, kartu ringkasan metrik KPI terpadu, dan pelacakan audit trail unit fisik:

### 1. Pemisahan 5 Tampilan Tab Stok Utama

1. **Stok Bahan (`stok-bahan`)** (`/workspace/inventory?tab=stok-bahan`):
   - Menyajikan daftar inventori bahan baku tekstil dan material produksi aktif (`item_kind = 'material'`).
   - Menampilkan nama material, unit pengukuran standar (UOM), kuantitas stok fisik saat ini (*Current Stock*), harga rata-rata bergerak (*Moving Average Cost*), dan estimasi total valuasi aset bahan baku.
2. **Stok Masuk (`stok-masuk`)** (`/workspace/inventory?tab=stok-masuk`):
   - Melacak seluruh pergerakan persediaan masuk dari pengadaan (*Purchase Receipts* bertipe `purchase_receipt` atau mutasi kuantitas positif).
   - Menampilkan nomor dokumen pengadaan acuan (`BL-YYMMDD-###` / `BP-YYMMDD-###`), nama material/item, tanggal transaksi, tanggal bisnis, dan kuantitas masuk.
3. **Stok Keluar (`stok-keluar`)** (`/workspace/inventory?tab=stok-keluar`):
   - Merekam seluruh jejak pengurangan persediaan baik untuk konsumsi produksi (*Production Issue*), pengiriman penjualan (*Sales Issue*), komponen afkir (*Production Reject*), maupun limbah kain (*Waste*).
   - Menampilkan nomor dokumen referensi pemotongan/penjualan, jenis mutasi persediaan, tanggal pencatatan, dan kuantitas keluar.
4. **Stok Produksi (WIP) (`stok-produksi`)** (`/workspace/inventory?tab=stok-produksi`):
   - Memantau komponen ikatan (*production bundles*) yang sedang aktif dalam pengerjaan pabrikasi (*Work in Process* / WIP) sebelum tahap akhir packing selesai.
   - Menyajikan kode ikatan unik (*bundle code*), nama dan SKU produk jadi, kode lot pemotongan (*lot code*), stasiun kerja aktif (Cutting, Printing, Sewing), kondisi kerja (`available`, `repair_hold`), dan sisa kuantitas aktif.
5. **Stok Produk Jadi (`stok-produk-jadi`)** (`/workspace/inventory?tab=stok-produk-jadi`):
   - Menggabungkan posisi stok produk jadi di gudang (berdasarkan ringkasan inventori produk SKU) serta ikatan komponen yang telah tuntas melalui proses pengemasan (*completed bundles* dari SPK Packing).
   - Menampilkan SKU produk, nama artikel, satuan unit (`pcs`), status siap distribusi, dan kuantitas siap jual.

### 2. Integrasi URL Query Parameter & Deep Linking

- Komponen `InventoryComponent` mengikat status tab aktif secara reaktif ke URL query parameter `?tab=`:
  - `?tab=stok-bahan`
  - `?tab=stok-masuk`
  - `?tab=stok-keluar`
  - `?tab=stok-produksi`
  - `?tab=stok-produk-jadi`
- Pengguna dapat melakukan bookmark, membagikan tautan langsung ke tab tertentu, atau bernavigasi langsung dari sub-menu sidebar tanpa kehilangan konteks visual.

### 3. Kartu Metrik KPI Terintegrasi

Di bagian atas modul stok, tersedia 5 kartu metrik analitik ringkasan yang dikalkulasi secara reaktif melalui Angular Signals:
- **Total Valuasi Bahan**: Akumulasi nilai moneter persediaan bahan baku aktif di gudang (kalkulasi $\sum (\text{stok} \times \text{moving\_avg\_cost})$).
- **Total Barang Masuk**: Akumulasi kuantitas fisik persediaan yang telah diterima ke gudang dari seluruh transaksi pembelian.
- **Total Barang Keluar & Waste**: Akumulasi kuantitas stok yang telah dikonsumsi produksi, dikirim ke pelanggan, atau dialokasikan sebagai reject/waste.
- **Total WIP Ikatan**: Akumulasi kuantitas komponen setengah jadi yang sedang beredar di stasiun kerja pabrik.
- **Total Produk Jadi Siap Jual**: Total kuantitas pakaian jadi yang siap dipenuhi untuk pesanan pelanggan.

### 4. Fitur Audit Trail & Pelacakan Unit Fisik Roll

Selain 5 tab operasional utama, modul inventori menyediakan alat audit mendalam:
- **Pencarian Reaktif Cepat**: Kolom pencarian teks terpadu untuk menyaring data seketika berdasarkan nama item, nomor dokumen, kode lot, maupun SKU produk.
- **Buku Besar Kartu Mutasi (`inventory_movement`)**: Jejak transaksi mutasi persediaan perpetual berurutan waktu lengkap dengan referensi dokumen acuan dan waktu posting.
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

5. **Catat Hasil Jahit Operator (`sewing_output`)** (`/workspace/operator-sewing`):
   - Konfirmasi hasil pengerjaan jahit per ikatan komponen (*bundle*) via RPC atomik `confirm_operator_sewing`.
   - Validasi invariant kuantitas: total alokasi kuantitas hasil jahit wajib tepat sama dengan kuantitas aktif ikatan (`success_quantity + repair_quantity + reject_quantity = active_quantity`).
   - Alokasi hasil pengerjaan ke dalam 3 kategori kuantitas:
     - **Kuantitas Sukses**: Komponen lolos jahit yang dipindahkan ke pembukuan mutasi inventori `sewn_components` (tercatat sebagai state `sewn_wip` pada `inventory_movement` tipe `production_wip_transfer`) dan siap diproses pada SPK Packing.
     - **Kuantitas Butuh Perbaikan (Repair)**: Komponen jahitan bermasalah/cacat yang otomatis membentuk Kasus Perbaikan (`production_repair_case`) berstatus `pending_assignment`, serta menandai kondisi kerja ikatan bundle menjadi tertahan (`repair_hold`).
     - **Kuantitas Reject**: Komponen rusak permanen yang dialokasikan ke `final_rejected_quantity` dan dicatat ke mutasi persediaan limbah (`inventory_movement` state `waste`, tipe `production_reject`).
   - Melepaskan reservasi ikatan dari tabel `production_bundle_reservation`.
   - Menghitung dan membukukan kewajiban upah borongan jahit (`wage_liability`) bagi operator jahit berdasarkan kuantitas yang dikerjakan penuh dikalikan tarif upah master `wage_rate` (default tarif standar Rp 15.000 / pcs jika belum dikonfigurasi).
   - Penomoran otomatis dokumen aktual `ACT-JAH-YYMMDD-###` dan pembaruan status SPK Jahit menjadi `completed` jika seluruh bundle terdaftar telah tuntas diproses.

6. **Catat Hasil Kemas & Packing Operator (`packing_output`)** (`/workspace/operator-packing`):
   - Konfirmasi hasil kemas dan penyelesaian akhir pakaian jadi per ikatan komponen (*bundle*) via RPC atomik `confirm_operator_packing`.
   - Validasi kesesuaian kuantitas hasil packing: kuantitas berhasil wajib tepat sama dengan kuantitas aktif ikatan bundle (`success_quantity = active_quantity`).
   - Pemindahan ke stok barang jadi siap jual: mencatat mutasi inventori `packed_finished_goods` (`inventory_movement` tipe `production_receipt` berstatus posted).
   - Penandaan status ikatan komponen (*bundle*) menjadi selesai penuh (`stage = 'packing'`, `work_condition = 'completed'`).
   - Melepaskan reservasi ikatan dari tabel `production_bundle_reservation`.
   - Menghitung dan membukukan kewajiban upah borongan packing (`wage_liability`) bagi operator kemas berdasarkan kuantitas yang diproses dikalikan tarif upah master `wage_rate` (default tarif standar Rp 1.000 / pcs jika belum dikonfigurasi).
   - Penomoran otomatis dokumen aktual `ACT-PCK-YYMMDD-###` dan pembaruan status SPK Packing menjadi `completed` jika seluruh bundle terdaftar telah selesai dikemas.

7. **Kasus Perbaikan & Penugasan SPK Repair (`repair_case`)** (`/workspace/production-repairs`):
   - Manajemen pemantauan komponen cacat produksi dengan alur status: `open` -> `assigned` -> `in_progress` -> `completed` / `scrapped`.
   - Penugasan penanganan kasus perbaikan kepada operator via RPC `assign_repair_spk`:
     - Menerbitkan SPK Perbaikan khusus `SPK-REP-YYMMDD-###`.
     - Mendukung 3 mode upah borongan:
       - `none` / Penalty: Tarif upah Rp 0 (pengerjaan ulang akibat kelalaian pengerjaan).
       - `reference`: Mengadopsi tarif standar layanan asli dari tabel `wage_rate`.
       - `custom` / `special_rate`: Menetapkan tarif upah khusus yang disepakati secara manual.

8. **Pipeline Progres Produksi & Visualisasi Metrik (`production_progress`)** (`/workspace/production-progress`):
   - Pemantauan kemajuan terintegrasi seluruh Perintah Produksi melalui fungsi analitik `get_production_progress_summary`.
   - Visualisasi pipeline kuantitas per tahapan: **Target PP** -> **Potong (Cut)** -> **Sablon (Print)** -> **Jahit (Sew)** -> **Kemas (Pack)**.
   - Menghitung persentase penyelesaian pesanan (`completionPercentage`), jumlah ikatan aktif yang sedang beredar di lantai pabrik (*active bundles*), dan kasus perbaikan yang belum selesai (*active repairs*).
   - Pemantauan status dokumen, target tanggal penyelesaian, dan indikator penguncian spesifikasi teknis (*code locked*).

---

## Modul Penjualan & Piutang Dagang (Sales & Accounts Receivable)

Modul ini mengelola siklus pesanan penjualan dari pelanggan, pembuatan faktur penjualan, penerimaan piutang dagang, dan pemenuhan pengiriman produk jadi:

1. **Pesanan Pelanggan / Sales Orders (`customer_order`)** (`/workspace/sales-orders`):
   - Pencatatan pesanan produk jadi dari pelanggan dengan nomor otomatis `SO-YYMMDD-###`.
   - Tracking status alur pesanan: `draft` -> `confirmed` -> `fulfilled` / `cancelled`.
   - Integrasi permintaan kuantitas terhadap ketersediaan persediaan barang jadi atau pemicu Perintah Produksi (PP).

2. **Faktur Penjualan (`sales_invoice`)** (`/workspace/sales`):
   - Penerbitan faktur tagihan penjualan dengan penomoran `FJ-YYMMDD-###`.
   - Metode pembayaran: **Tunai (Cash)** langsung ke akun kas/bank atau **Kredit (Term)** yang mencatat piutang dagang pelanggan (`customer_receivable`).
   - Pengurangan stok barang jadi secara otomatis dari inventaris gudang (`inventory_movement` jenis `sales_issue`).
   - Pembukuan jurnal penjualan: Debit Kas/Piutang Usaha vs Kredit Pendapatan Penjualan dan HPP vs Persediaan Barang Jadi.

3. **Penerimaan Pembayaran Piutang (`sales_receipt`)** (`/workspace/sales-receipts`):
   - Penerimaan pelunasan piutang pelanggan atas faktur yang belum lunas dengan bukti transaksi `KM-YYMMDD-###`.
   - Mengurangi saldo piutang faktur terkait (`paid_amount`) dan membukukan mutasi kas masuk (`cash_movement` jenis `revenue`).
   - Pencatatan buku pembantu piutang (`subledger_entry` kind `customer_receivable`).

4. **Pengiriman & Pemenuhan Pesanan (`sales_fulfillment`)** (`/workspace/sales-fulfillment`):
   - Pencatatan Surat Jalan Pengiriman (`SJ-YYMMDD-###`) dan pelacakan status ekspedisi logistik.
   - Konfirmasi serah terima barang kepada pelanggan dan pemenuhan status SO.

---

## Modul Keuangan, Akuntansi & Buku Besar (Finance, Accounting & General Ledger)

Modul Keuangan & Akuntansi (Fase 7) mengimplementasikan sistem buku besar berpasangan (*Double-Entry Bookkeeping*) berstandar PSAK dengan kontrol validasi ketat dan fungsi transaksi atomik PostgreSQL:

1. **Bagan Akun Standar (COA) & Pemetaan Sistem 21 Akun (`ledger_account`)** (`/workspace/finance/coa`):
   - Bagan akun 5 klasifikasi: **Aset (1)**, **Kewajiban (2)**, **Ekuitas (3)**, **Pendapatan (4)**, dan **Beban (5)**.
   - Penomoran akun terstruktur: `[Tipe]-[Level1].[Level2].[Nomor]` (misal: `1-1.1.01 Kas Utama`, `2-1.1.01 Hutang Usaha`).
   - **System Mapping (21 Akun Standar)**: Menghubungkan logika transaksi otomatis dari seluruh modul bisnis (pembelian, penjualan, persediaan, upah, amortisasi) ke akun buku besar yang kompatibel.
   - **Report Mapping**: Pengelompokan akun ke dalam pos manajemen laporan keuangan (*Revenue, COGS, Operating Expense, Payroll*) dan aktivitas arus kas (*Operating, Investing, Financing*).
   - Akun khusus `3-3.0.00` (*Laba Tahun Berjalan*) adalah virtual presentation-only account yang dikalkulasi secara reaktif dan dilarang menerima posting jurnal langsung.

2. **Manajemen Likuiditas Kas & Bank (`cash_bank`)** (`/workspace/finance/cash-bank`):
   - Pengelolaan seluruh akun kas fisik, rekening bank, dan dompet digital perusahaan.
   - Monitoring saldo likuiditas real-time dan buku pembantu mutasi kas masuk/keluar (`cash_movement`).
   - **Transfer Antar Rekening Kas/Bank**: Stored procedure `post_cash_transfer` yang memindahkan likuiditas antar rekening secara atomik dengan validasi kecukupan saldo pengirim dan menghasilkan dokumen `TRF-YYYYMM-XXXX`.

3. **Biaya Operasional Multi-Akun (`operating_expense`)** (`/workspace/finance/expenses`):
   - Pencatatan pengeluaran operasional perusahaan dengan nomor dokumen `BO-YYYYMM-XXXX`.
   - Mendukung dua metode pendanaan: **Kas Langsung (Tunai)** atau **Hutang Biaya Akrual (Payable)** ke rekanan/vendor.
   - Multi-line allocation: Mendistribusikan satu bukti pengeluaran ke berbagai pos akun beban GL yang berbeda.
   - Pembatalan transaksi aman via stored procedure `void_operating_expense` yang membalikkan jurnal dan mutasi kas secara utuh disertai alasan pembatalan untuk audit trail.

4. **Pembayaran Upah & Gaji Borongan (`wage_payment`)** (`/workspace/finance/wages`):
   - Pelunasan kewajiban hutang upah operator produksi borongan (`wage_liability`) yang tercatat dari SPK 4 tahap pengerjaan (*Cutting, Printing, Sewing, Finishing, QC, Packing*).
   - Multi-selection per operator: Menjamin 1 voucher pengeluaran kas (`KK-UP-YYYYMM-XXXX`) dialokasikan khusus untuk satu penerima.
   - Stored procedure `post_wage_payment` secara atomik menandai kewajiban `is_paid = true`, mengurangi hutang tenaga kerja di buku besar, dan memotong saldo rekening kas pembayar.

5. **Biaya Dibayar Dimuka & Amortisasi (`prepaid_expense`)** (`/workspace/finance/prepaid`):
   - Pencatatan aset dibayar dimuka (sewa gedung tahunan, polis asuransi pabrik, dsb) dengan jadwal amortisasi proporsional bulanan.
   - Pendaftaran kontrak baru via `create_prepaid_expense` menetapkan akun aset prepaid, akun beban pengakuan, durasi bulan, dan total nilai kontrak.
   - Posting amortisasi bulanan via `post_prepaid_amortization` mendebit akun beban dan mengkredit akun aset prepaid, mencatat riwayat entri pada `prepaid_amortization_entry`, dan memperbarui persentase progress penyerapan.

6. **Saldo Awal Neraca & Kas (`opening_balance`)** (`/workspace/finance/opening-balance`):
   - Inisialisasi posisi awal seluruh akun neraca (Aset, Kewajiban, Ekuitas) saat pembukuan baru perusahaan dimulai.
   - Monitor Keseimbangan Real-time: Memvalidasi Total Debit = Total Kredit ($\Delta = 0$) sebelum tombol posting diaktifkan.
   - Stored procedure `post_opening_balance` menerbitkan dokumen `SA-YYYYMM-XXXX`, membukukan jurnal pembuka ke `general_ledger_line`, dan menyelaraskan saldo kas awal ke `cash_movement`.

7. **Jurnal Memorial / Manual (`manual_journal`)** (`/workspace/finance/journals`):
   - Pencatatan jurnal penyesuaian akhir periode, koreksi pembukuan, atau transaksi memorial non-operasional dengan nomor dokumen `JU-YYYYMM-XXXX`.
   - Validasi keseimbangan multi-baris otomatis (total debit = total kredit) dan larangan posting ke akun virtual `3-3.0.00`.
   - Fitur Pembalik Jurnal (*Reversal*): Stored procedure `reverse_manual_journal` membuat entri jurnal pembalik otomatis yang memutar balik posisi debit dan kredit dari jurnal sumber dengan penanda relasi `reversal_of_id`.

8. **Penutupan Periode Akuntansi (`period_close`)** (`/workspace/finance/period-close`):
   - Penguncian pembukuan bulanan (`accounting_period`) untuk menjaga integritas laporan historis.
   - **Pre-close Verification (4 Control Checks)**:
     1. *Keseimbangan Jurnal*: Total debit = total kredit pada seluruh jurnal umum periode tersebut.
     2. *Transaksi Draf Gantung*: Tidak ada transaksi berstatus draft yang belum diselesaikan.
     3. *Rekonsiliasi Kas*: Seluruh mutasi likuiditas kas & bank terverifikasi sah.
     4. *Konsistensi Subledger*: Buku pembantu piutang, hutang, dan upah sinkron dengan saldo buku besar.
   - Penutupan via `close_accounting_period` mengunci periode dari penambahan, pengubahan, atau pembatalan transaksi dengan tanggal pada periode tersebut.
   - Pembukaan kembali (*Reopen*) via `reopen_accounting_period` dibatasi secara ketat hanya dapat dieksekusi oleh peran **Owner** dengan menyertakan alasan resmi untuk audit trail.

---

## Modul Aset Tetap & Penyusutan (Fixed Assets & Depreciation)

Modul Aset Tetap & Penyusutan (Fase 8) mengimplementasikan tata kelola siklus hidup aset berwujud manufaktur secara menyeluruh (*End-to-End Asset Lifecycle Management*) berstandar PSAK 16 / IFRS, terintegrasi langsung dengan Buku Besar (*General Ledger*) dan modul Pengadaan (*Purchasing*):

1. **Pengadaan Aset Tetap (`asset_purchase`)** (`/workspace/asset-purchases`):
   - Pencatatan dokumen faktur pembelian/pengadaan aset tetap dari pemasok dengan nomor dokumen terstruktur `PO-AST-YYMMDD-###` (Draf) dan `AP-AST-YYMMDD-###` (Posted).
   - Mendukung multi-baris belanja modal (*Capital Expenditure / CapEx*) dengan kuantitas unit fisik.
   - **Pemecahan Unit Fisik Individual Atomik**: Stored procedure `post_asset_purchase` memecah satu baris invoice dengan kuantitas $N$ menjadi $N$ unit record aset fisik mandiri pada tabel `asset_record` dengan kode unik berakhiran suffix ordinal (`-1`, `-2`, ..., `-N`) dan membagi rata biaya perolehan (`acquisition_cost`) secara presisi tanpa sisa pembulatan.
   - **Pencatatan Jurnal Akuntansi Berpasangan**: Saat diposting, otomatis membukukan jurnal umum berimbang:
     - **Debit**: Aset Tetap / *Fixed Assets* (`1-2.0.04`) sebesar total biaya perolehan.
     - **Kredit**: Hutang Usaha / *Supplier Payable* (`2-1.1.01`) sebesar total kewajiban pembelian.
   - Pencatatan buku pembantu hutang (`subledger_entry` kind `supplier_payable`).
   - **Pembatalan Aman (`cancel_asset_purchase`)**: Dokumen dapat dibatalkan secara atomik (dengan alasan wajib) membalikkan jurnal dan menandai status `cancelled`, dengan proteksi invariant ketat: pembatalan ditolak keras jika ada unit aset terkait yang sudah disusutkan (`accumulated_depreciation > 0`).

2. **Register Aset Tetap & Kunci Parameter Akuntansi (`asset_record`)** (`/workspace/assets`):
   - Manajemen inventaris fisik seluruh unit mesin pabrik (mesin jahit, obras, overdeck, sablon, boiler), komputer desain, dan kendaraan operasional.
   - Status aset fisik: `candidate` (baru dibeli, menunggu setup parameter), `active` (siap disusutkan), `disposed` (sudah dilepas/dijual), dan `cancelled` (dibatalkan).
   - Pengaturan parameter penyusutan via `update_asset_parameters`:
     - Kategori Aset (`asset_category`)
     - Metode Penyusutan (`straight_line` / `declining_balance`)
     - Masa Manfaat dalam Bulan (`useful_life_months`)
     - Nilai Residu / Sisa (`residual_value`)
     - Tanggal Mulai Penyusutan (`depreciation_start_date`)
     - Metadata Fisik: Lokasi penempatan, Penanggung Jawab (*Custodian*), dan Nomor Seri pabrikan (*Serial Number*).
   - **Aturan Invariant Kunci Akuntansi (*Accounting Lock*)**:
     - Begitu aset mengalami penyusutan bulanan perdana (`accumulated_depreciation > 0`), sistem secara otomatis mengunci permanen 4 parameter inti: **Metode**, **Masa Manfaat**, **Nilai Residu**, dan **Tanggal Mulai Penyusutan**.
     - Hal ini mencegah distorsi nilai buku historis dan menjamin kepatuhan audit PSAK. Pengguna hanya diizinkan memperbarui metadata fisik (lokasi, penanggung jawab, nomor seri).

3. **Pratinjau & Eksekusi Penyusutan Bulanan (`monthly_depreciation`)** (`/workspace/depreciation`):
   - Pelaksanaan penyusutan periodik bulanan (*Periodic Depreciation Run*) berbasis batch dengan nomor dokumen `DP-YYMMDD-###`.
   - **Pratinjau Cerdas (`get_depreciation_preview`)**: Membedah seluruh aset aktif ke dalam dua kelompok:
     - *Eligible Assets*: Aset yang memenuhi kriteria perhitungan pada periode berjalan (parameter lengkap, tanggal mulai $\le$ akhir periode, nilai buku $>$ nilai residu, belum pernah disusutkan pada bulan tersebut).
     - *Ineligible Assets*: Aset yang tidak memenuhi syarat beserta penjelasan alasan transparan (misal: belum disetup parameternya, belum tiba tanggal mulai penyusutan, atau telah mencapai nilai residu/masa manfaat habis).
   - **Formula Perhitungan Standar**:
     - **Garis Lurus (*Straight-Line*)**:
       $$\text{Depresiasi Bulanan} = \frac{\text{Biaya Perolehan} - \text{Nilai Residu}}{\text{Masa Manfaat (Bulan)}}$$
     - **Saldo Menurun (*Declining Balance*)**:
       $$\text{Depresiasi Bulanan} = \text{Nilai Buku Awal} \times \left(1 - \left(\frac{\text{Nilai Residu}}{\text{Biaya Perolehan}}\right)^{\frac{1}{\text{Masa Manfaat (Bulan)}}}\right)$$
       *(Dengan penyesuaian batas bawah nilai buku agar tidak menembus batas nilai residu).*
   - **Eksekusi Atomik (`post_monthly_depreciation`)**:
     - Mendukung pemilihan fleksibel unit aset yang disusutkan.
     - Membukukan jurnal umum tunggal teragregasi secara atomik:
       - **Debit**: Beban Penyusutan Aset Tetap / *Depreciation Expense* (`6-3.0.03`).
       - **Kredit**: Akumulasi Penyusutan Aset Tetap / *Accumulated Depreciation* (`1-2.1.03`).
     - Memperbarui `accumulated_depreciation` pada masing-masing unit aset dan mencatat baris rincian di `business_document_line`.

4. **Pelepasan & Penjualan Aset Tetap (`asset_disposal`)** (`/workspace/asset-disposals`):
   - Menangani penghentian pengakuan aset tetap (*Derecognition*) akibat penjualan unit bekas atau penghapusan karena rusak berat/afkir.
   - Menggunakan stored procedure atomik `post_asset_disposal` yang menerbitkan dokumen `DISP-YYMMDD-###`.
   - **Pengakuan Laba / Rugi Pelepasan Aset**:
     - $\text{Nilai Buku Saat Pelepasan} = \text{Biaya Perolehan} - \text{Akumulasi Penyusutan}$
     - $\text{Selisih Kas} = \text{Hasil Penjualan (Proceeds)} - \text{Nilai Buku}$
     - Jika $\text{Selisih Kas} > 0$: Diakui sebagai **Laba Pelepasan Aset** (`4-2.0.03 / asset_disposal_gain`).
     - Jika $\text{Selisih Kas} < 0$: Diakui sebagai **Rugi Pelepasan Aset** (`8-2.0.00 / asset_disposal_loss`).
   - **Penjurnalan Otomatis**:
     - **Debit**: Kas/Bank (`1-1.1.01`) sebesar hasil penjualan (bila ada).
     - **Debit**: Akumulasi Penyusutan (`1-2.1.03`) untuk menutup seluruh depresiasi yang telah dibukukan.
     - **Debit**: Rugi Pelepasan Aset (`8-2.0.00`) (jika menderita rugi).
     - **Kredit**: Aset Tetap (`1-2.0.04`) sebesar harga perolehan historis unit aset.
     - **Kredit**: Laba Pelepasan Aset (`4-2.0.03`) (jika menghasilkan laba).
   - Membukukan mutasi kas masuk pada `cash_movement` jenis `asset_sale` dan mengubah status aset menjadi `disposed`.

---

## Modul Laporan Keuangan, HPP & Rekonsiliasi Akuntansi (Fase 9)

Modul **Financial Reporting, HPP & Reconciliation (Fase 9)** mengimplementasikan tata kelola pelaporan finansial pabrikasi konveksi modern, agregasi analitik berbasis PostgreSQL stored procedures, evaluasi efisiensi biaya manufaktur per SKU, dan sistem audit integritas subledger-ke-buku besar (*General Ledger*) secara real-time.

### 1. Neraca Saldo / Trial Balance (`get_trial_balance`)
- **Rute**: `/workspace/reports/trial-balance` (Alias: `/trial-balance`, `/reports`)
- **Komponen**: `TrialBalanceComponent`
- **Tujuan**: Memastikan keabsahan matematis pembukuan berpasangan (*Double-Entry Bookkeeping*) pada rentang periode terpilih.
- **Logika Perhitungan**:
  - Saldo Awal (*Opening Balance*): Akumulasi seluruh transaksi jurnal *posted* sebelum tanggal awal (`< v_date_from`).
  - Mutasi Debit & Kredit Periode: Agregasi pergerakan mutasi selama rentang periode (`>= v_date_from AND <= v_date_to`).
  - Saldo Akhir (*Closing Balance*): Saldo kumulatif hingga tanggal akhir periode.
  - Pemisahan Kolom Debet/Kredit: Disajikan dalam kolom *Ending Debit* dan *Ending Credit* berdasarkan posisi saldo normal akun.
  - **Uji Keseimbangan (*Balance Validation*)**: Sistem secara otomatis mengevaluasi invariant $\sum \text{Debit} = \sum \text{Kredit}$. Status ditandai dengan badge hijau (*SEIMBANG*) atau merah (*TIDAK SEIMBANG*) jika terdapat selisih.

### 2. Laporan Laba Rugi / Income Statement (`get_profit_loss`)
- **Rute**: `/workspace/reports/profit-loss` (Alias: `/profit-loss`)
- **Komponen**: `ProfitLossComponent`
- **Tujuan**: Mengukur kinerja profitabilitas operasional dan finansial perusahaan hanya pada periode berjalan (*Period-Only Performance*).
- **Struktur Laporan Multi-Step**:
  1. **Pendapatan Bersih (*Net Revenue*)**: Pendapatan Penjualan (`4-1.0.01`) dikurangi Retur Penjualan (`4-1.0.02`) dan Diskon Penjualan (`4-1.0.03`).
  2. **Beban Pokok Penjualan (*Cost of Goods Sold / COGS*)**: Seluruh akun kategori `5-x.x.xx` (Bahan Baku Terpakai, Upah Langsung SPK, dan Overhead Pabrik).
  3. **Laba Kotor (*Gross Profit*)**: $\text{Gross Profit} = \text{Net Revenue} - \text{COGS}$.
  4. **Beban Operasional (*Operating Expenses*)**: Akun beban umum, pemasaran, operasional, dan depresiasi (`6-x.x.xx`).
  5. **Laba Operasional (*Operating Profit / EBIT*)**: $\text{Operating Profit} = \text{Gross Profit} - \text{Operating Expenses}$.
  6. **Pendapatan & Beban Lain-lain**: Pendapatan Non-Operasional (`7-x.x.xx`) dikurangi Beban Non-Operasional (`8-x.x.xx`).
  7. **Laba Bersih (*Net Income*)**: $\text{Net Income} = \text{Operating Profit} + \text{Other Income} - \text{Other Expenses}$.
- **Metrik Analisis**: Menampilkan rasio *Gross Margin (%)*, *Operating Margin (%)*, dan *Net Margin (%)*.

### 3. Neraca Keuangan / Balance Sheet (`get_balance_sheet`)
- **Rute**: `/workspace/reports/balance-sheet` (Alias: `/balance-sheet`)
- **Komponen**: `BalanceSheetComponent`
- **Tujuan**: Menggambarkan posisi kekayaan (aset), kewajiban (liabilitas), dan permodalan (ekuitas) perusahaan pada titik tanggal tertentu (*Cumulative Cut-off Date*).
- **Penanganan Khusus Akuntansi**:
  - **Akun Kontra (*Contra Accounts*)**: Akun kontra aset (seperti Akumulasi Penyusutan Aset `1-2.1.xx`) memiliki saldo normal kredit namun disajikan di sisi aset sebagai pengurang (*negative deduction*), menghasilkan Nilai Buku Bersih (*Net Book Value*).
  - **Pembedaan Laba Ditahan & Laba Berjalan**:
    - `v_prior_year_earnings`: Laba/rugi bersih kumulatif dari seluruh tahun buku sebelumnya yang belum ditutup ke modal via tutup buku tahunan.
    - `v_current_year_earnings`: Laba/rugi bersih tahun berjalan YTD (*Year-to-Date Net Income*) dari tanggal 1 Januari tahun berjalan s/d tanggal cut-off.
  - **Integritas Persamaan Dasar Akuntansi**:
    $$\text{Total Aset} = \text{Total Kewajiban} + \text{Total Ekuitas}$$
    $$\Delta = \text{Total Aset} - (\text{Total Kewajiban} + \text{Total Ekuitas}) = 0$$
    Sistem memverifikasi selisih $\Delta$ secara matematis dengan toleransi ketat.

### 4. Laporan Arus Kas / Cash Flow Statement (`get_cash_flow_statement`)
- **Rute**: `/workspace/reports/cash-flow` (Alias: `/cash-flow`)
- **Komponen**: `CashFlowComponent`
- **Tujuan**: Melacak aliran likuiditas riil masuk dan keluar menggunakan **Metode Langsung (*Direct Method*)**.
- **Klasifikasi 3 Aktivitas Standar**:
  1. **Aktivitas Operasi (*Operating Activities*)**: Penerimaan pelunasan piutang pelanggan, pembayaran bahan baku, pembayaran upah SPK borongan, pembayaran perlengkapan, dan pengeluaran operasional tunai.
  2. **Aktivitas Investasi (*Investing Activities*)**: Belanja modal pengadaan mesin/peralatan pabrik (*CapEx*) dan penerimaan kas hasil penjualan/pelepasan aset tetap bekas (*Asset Disposal*).
  3. **Aktivitas Pendanaan (*Financing Activities*)**: Setoran modal awal, penarikan prive (*equity withdrawal*), dan penerimaan/pelunasan pinjaman perbankan.
- **Rekonsiliasi Kas**:
  $$\text{Kas Akhir} = \text{Kas Awal} + \text{Kenaikan/Penurunan Bersih Kas}$$
  Hasil akhir dicocokkan langsung terhadap saldo akun Kas & Bank (`1-1.1.xx`) di Buku Besar untuk menjamin tidak ada mutasi kas siluman.

### 5. Buku Besar / General Ledger (`get_general_ledger_entries`)
- **Rute**: `/workspace/reports/general-ledger` (Alias: `/general-ledger`)
- **Komponen**: `GeneralLedgerComponent`
- **Tujuan**: Menelusuri jejak audit detail historis (*Audit Trail*) per akun secara individual.
- **Fitur Utama**:
  - Pemilihan akun fleksibel via dropdown COA hierarkis.
  - Saldo Awal Terbuku (*Brought Forward Opening Balance*).
  - Kolom mutasi Debit, Kredit, dan Saldo Berjalan (*Running Balance*) yang dihitung menggunakan PostgreSQL window functions (`SUM(debit - credit) OVER (...)`).
  - Pagination efisien (`limit`, `offset`) dengan visualisasi nomor referensi jurnal, jenis sumber transaksi, dan deskripsi/catatan.

### 6. Laporan HPP & Biaya Pabrikasi (`get_hpp_manufacturing_summary`)
- **Rute**: `/workspace/reports/hpp` (Alias: `/hpp`, `/hpp-report`)
- **Komponen**: `HppReportComponent`
- **Tujuan**: Menghitung akumulasi biaya pabrikasi riil dan membandingkan HPP aktual per SKU terhadap standar Bill of Materials (BOM).
- **Tiga Unsur Pokok Biaya Produksi Manufaktur**:
  1. **Biaya Bahan Baku Langsung (*Direct Materials*)**: Diagregasi dari mutasi fisik pengeluaran bahan baku (`inventory_movement` status `material`, kuantitas negatif) dikalikan harga perolehan.
  2. **Biaya Tenaga Kerja Langsung (*Direct Labor*)**: Rincian upah borongan 4 tahap pengerjaan SPK (`wage_liability`): Potong (*Cutting*), Bordir/Sablon (*Printing*), Jahit (*Sewing*), dan Finishing/Packing (*Packing* & *Head Fee*).
  3. **Biaya Overhead Pabrik (*Factory Overhead / BOP*)**: Konsumsi perlengkapan produksi (*supplies*), beban depresiasi mesin pabrik periode berjalan, dan beban overhead pabrikasi dari jurnal umum.
- **Evaluasi Efisiensi SKU vs BOM**: Menghitung varians biaya aktual per unit dibandingkan estimasi standar BOM, lengkap dengan persentase varians ($\pm\%$) untuk mendeteksi pemborosan (*waste*) atau efisiensi produksi.
- **Rekonsiliasi GL COGS**: Membandingkan total COGS fisik terhadap saldo akun Beban Pokok Penjualan di Buku Besar.

### 7. Rekonsiliasi Subledger-ke-Buku Besar & Audit Integritas (`get_accounting_reconciliation_summary`)
- **Rute**: `/workspace/reports/reconciliation` (Alias: `/reconciliation`)
- **Komponen**: `ReconciliationComponent`
- **Tujuan**: Memastikan keabsahan kontrol internal antara buku pembantu operasional (*subledger*) dan buku besar keuangan (*General Ledger*).
- **Matriks 6 Pos Kontrol Keuangan**:
  1. **Kas & Bank**: Saldo akumulasi mutasi buku kas operasional vs Saldo Akun Kas & Bank (`1-1.1.xx`).
  2. **Piutang Usaha (AR)**: Akumulasi saldo faktur pesanan penjualan belum lunas (*unpaid orders*) vs Saldo Akun Piutang Usaha (`1-1.2.01`).
  3. **Hutang Usaha (AP)**: Akumulasi kewajiban tagihan pengadaan bahan belum dibayar (*unpaid purchase orders*) vs Saldo Akun Hutang Usaha (`2-1.1.01`).
  4. **Nilai Persediaan**: Valuasi total stok fisik bahan baku, perlengkapan, dan barang jadi vs Saldo Akun Persediaan (`1-1.4.xx`).
  5. **Aset Tetap**: Total harga perolehan unit aktif di register aset modal vs Saldo Akun Aset Tetap (`1-2.0.xx`).
  6. **Akumulasi Penyusutan**: Akumulasi depresiasi terhitung di modul aset vs Saldo Kredit Akun Akumulasi Penyusutan (`1-2.1.xx`).
- **Uji Integritas Real-time**: Tombol *Uji Rekonsiliasi Real-time* mengevaluasi ke-6 pos secara serentak. Jika ada selisih, sistem memberikan peringatan anomali beserta navigasi cepat ke modul terkait untuk investigasi jurnal koreksi.

---

## Modul Manajemen Perusahaan & Multi-Tenant (`/workspace/companies`)

Modul ini bertanggung jawab atas pengelolaan struktur multi-tenant, identitas fasilitas manufaktur, status operasional, serta inisialisasi master data otomatis (*bootstrapping*).

### 1. Inisialisasi Tenant Atomik (`create_company_with_bootstrap`)
- **Rute**: `/workspace/companies`
- **Komponen**: `CompaniesComponent`
- **Otorisasi**: Khusus peran `owner` (dilindungi oleh `ownerGuard`).
- **Mekanisme Bootstrap**:
  Saat pendaftaran entitas baru disubmit, fungsi PostgreSQL `create_company_with_bootstrap` dieksekusi dalam satu transaksi atomik:
  1. Validasi keunikan kode dan nama perusahaan.
  2. Penyimpanan data identitas: Kode, Nama, Alamat Fasilitas/Pabrik, Nomor Telepon Kontak, dan Email Resmi.
  3. Pemanggilan `bootstrap_company_data` untuk secara otomatis menginisialisasi:
     - 65 akun Bagan Akun Standar (*Chart of Accounts* - COA).
     - 11 Satuan Standar (*Units of Measure* - UOM: CM, GROSS, KG, LUSIN, M, PAK, PCS, RIM, SET, ROLL, YARD).
     - Kategori konfigurasi beban operasional, overhead pabrik, dan aset tetap.
     - Penomoran otomatis dokumen transaksi (SO, INV, PO, WO, CUT, PRT, SEW, PCK, PAY, RCP, EXP, JV, AST).
     - Matriks izin akses default untuk 7 peran di seluruh 38 menu sistem.
     - Penugasan pengguna pembuat sebagai `owner` aktif di `user_company_assignment`.
  4. Pencatatan jejak audit otomatis pada `audit_log` (`action: 'company.create'`).

### 2. Aturan Bisnis & Proteksi Integritas
- **Integritas Kode (`code_locked`)**:
  - Kolom `code_locked` menjaga agar kode perusahaan yang telah digunakan dalam penomoran dokumen akuntansi dan jurnal tidak dapat diubah sembarangan.
  - Perusahaan yang berstatus `code_locked = true` menampilkan badge gembok dan menonaktifkan input kode pada form edit.
- **Proteksi Penonaktifan Sesi Aktif**:
  - Sistem melarang penonaktifan entitas yang sedang aktif digunakan dalam sesi kerja pengguna saat ini.
  - Pengguna harus beralih (*switch*) ke entitas lain terlebih dahulu sebelum dapat menonaktifkan entitas tersebut.
- **Optimistic Concurrency Control**:
  - Pembaruan entitas menyertakan nomor `version` guna mencegah penimpaan data simultan (*race condition*).

### 3. Pengalihan Sesi Kerja Cepat (*Quick Tenant Switch*)
- Pengguna dapat langsung menekan tombol **Gunakan** pada baris tabel perusahaan untuk mengalihkan konteks tenant yang aktif tanpa harus membuka dropdown navigasi atas. Sesi aktif langsung diperbarui secara reaktif ke seluruh komponen aplikasi.

