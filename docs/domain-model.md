# Domain Model — Manufacturing Information System (MIS)

Dokumen ini menjelaskan model domain logis dari entitas-entitas utama dalam aplikasi MIS, merujuk pada ketentuan *Product Requirements Document (PRD)*. Model fisik (tabel database) di Django akan dibangun dengan merepresentasikan relasi-relasi ini.

## Prinsip Dasar
1. **Tenant Isolation**: Hampir seluruh tabel di luar *User* memiliki *foreign key* langsung ke `Tenant` (Konveksi) untuk mempermudah pengecekan hak akses di seluruh query database.
2. **Immutability pada Finansial & Stok**: Dokumen transaksi (Jurnal, Ledger Stok, Audit) tidak dihapus (no hard delete) atau diedit secara langsung; pembaruan memerlukan entri revisi/pembalikan.

---

## 1. Organisasi & Autentikasi (Core & Auth)
Domain ini mengelola identitas, batasan isolasi data, dan keamanan.

- **Tenant**: Mewakili satu konveksi independen. (Sudah ada di `core.models.py`)
- **User**: Pengguna aplikasi, otentikasi login global.
- **Membership**: Menghubungkan *User* dengan *Tenant* beserta peran (*Role*) yang diemban.
- **AuditEvent**: Jejak rekam setiap perubahan (*create, update, delete*) yang mencatat *aktor, tenant, timestamp, dan payload*.
- **OutboxEvent**: Tabel pesan perantara untuk pengiriman asinkron (misalnya index pencarian) tanpa mengurangi keandalan transaksi utama.
- **DocumentSequence**: Menyimpan *state* penomoran dokumen otomatis per *tenant* dan periode.
- **FileMetadata**: Mencatat berkas unggahan, dihubungkan ke *Tenant* untuk membatasi akses (bukan file publik).

---

## 2. Master Data Pokok
Semua data di sini terikat dengan `Tenant`. 

- **Product & ProductVariant (SKU)**: Produk memiliki varian (kombinasi warna & ukuran) dengan SKU yang unik di dalam *Tenant*. SKU varian produk digenerate backend dari `ProductModel.code`, warna, dan ukuran dengan format `MODEL-WARNA-UKURAN`; warna/ukuran kosong menjadi `0`, spasi dalam segmen menjadi `_`, dan tanda `-` dilarang di dalam segmen.
- **Material**: Bahan baku, memiliki `purchase_uom` (Satuan Beli) dan `usage_uom` (Satuan Pakai), rasio konversi, `moq`, `purchase_multiple`, dan shrinkage. `moq` adalah jumlah minimum pembelian, sedangkan `purchase_multiple` adalah kelipatan beli yang terpisah. Nama material wajib unik per tenant, angka konversi/MOQ/kelipatan harus lebih dari nol, shrinkage dibatasi 0-100%, supplier default harus aktif, dan perubahan satuan/isi kemasan ditolak setelah material dipakai pada BOM, pembelian, ledger stok, atau SPK.
- **Customer & Supplier**: Data rekanan eksternal. Pelanggan bisa memiliki banyak *Address*.
- **Operator**: Penjahit, pemotong, dsb. Disertai status (internal/eksternal) dan spesialisasi.
- **BOM (Bill of Material)**: Formula bahan fisik per produk/SKU yang menjadi patokan awal SPK baru. Saat SPK dibuat, formula disalin ke `ProductionOrder.bom_snapshot` dan `MaterialRequirement`, sehingga perubahan BOM berikutnya tidak mengubah acuan produksi yang sudah berjalan. BOM master dapat diedit langsung tanpa alur draft/versioning operasional.
- **Routing**: Urutan tahapan pengerjaan (misal: Potong -> Sablon -> Jahit -> QC). Routing memiliki *versioning* per model produk; SPK yang dirilis menyimpan `routing_snapshot`, sehingga perubahan alur produksi berikutnya dibuat sebagai versi baru dan tidak mengubah acuan SPK lama.
- **PieceRate (Tarif Borongan)**: Besaran upah per pekerjaan spesifik untuk operator. Memiliki *History/Versioning*.
- **Chart of Accounts (CoA)**: Akun-akun buku besar untuk akuntansi spesifik per konveksi.

---

## 3. Penjualan & Perencanaan (Sales)
- **SalesPO (Purchase Order dari Pelanggan)**: Pesanan pembelian. Memiliki beberapa revisi jika diubah. Mengunci saat produksi dimulai.
- **SalesPOLine**: Rincian setiap item pesanan (SKU, Qty, Harga).
- **StockAllocation**: Tabel yang mencatat bahwa sebagian stok di gudang sudah dipesan untuk sebuah *SalesPOLine*, sehingga tidak bisa dikirimkan ke PO lain.

---

## 4. Eksekusi Produksi (Production)
- **ProductionOrder**: Perintah kerja. Bisa terkait dengan suatu *SalesPO* atau murni untuk *Stock* (produksi untuk persediaan).
- **MaterialRequirement & MaterialReservation**: Jumlah bahan yang dibutuhkan dan di-reserve dari gudang. Perhitungan requirement membaca snapshot BOM milik SPK, stok tersedia, pesanan berjalan, rasio konversi, MOQ, dan kelipatan beli untuk menghasilkan rekomendasi pembelian.
- **JobPacket (Paket Pekerjaan)**: Pekerjaan yang ditugaskan kepada satu atau beberapa *Operator*.
- **ProductionStageProgress**: Rekaman progres setiap tahap kerja. Mencatat jumlah produk yang *masuk, selesai, cacat (defect), rework, dan scrap*.
- **OperatorWorkLog**: Pencatatan hasil per individu untuk basis klaim *Tarif Borongan*.
- **WIP (Work In Progress)**: Melacak kuantitas produk dalam proses di tengah-tengah tahapan `Routing`.
- **ProductionCost**: Biaya tambahan yang dihubungkan ke SPK, termasuk input manual atau hasil alokasi overhead. Nilai ini masuk komponen `other` pada HPP aktual saat produksi selesai.

---

## 5. Persediaan & Gudang (Inventory)
- **MaterialLedger & ProductLedger**: Pencatatan setiap pergerakan masuk/keluar. Tidak ada mutasi yang mengubah field *stok akhir* secara langsung, semua ditotal dari baris ledger.
- **Batch / Lot**: Setiap penerimaan material atau produk jadi baru menjadi satu *Batch* dengan *cost/layer* yang menempel untuk akuntansi harga pokok.
- **StockAdjustment / StockOpname**: Dokumen untuk memperbaiki ketidakcocokan data fisik dengan sistem. Wajib menyertakan *reason*.
- **PurchaseRequest & PurchaseOrder (Pengadaan)**: Modul untuk membeli *Material* dari *Supplier*.
- **MaterialReceipt**: Bukti penerimaan material (bisa parsial).

---

## 6. Penjualan & Finansial (Finance & Fulfillment)
- **DeliveryNote (Surat Jalan)**: Dokumen pengiriman produk ke *Customer*.
- **Invoice**: Faktur penagihan pelanggan. Satu invoice dapat mencakup beberapa *DeliveryNote*.
- **CustomerPayment & Allocation**: Pembayaran yang diterima dan pengalokasiannya ke invoice tertentu (atau sebagai *DP / Uang Muka* ke PO).
- **SupplierBill & SupplierPayment**: Tagihan dari supplier dan riwayat pembayaran oleh *Finance*.
- **PettyCash (Kas Kecil)**: Riwayat klaim uang makan, *reimbursement*, bahan dapur harian. Memiliki tahapan draft (oleh Dapur) -> Verifikasi.
- **Asset & DepreciationSchedule**: Aset inventaris (mesin, dsb.) dengan tabel amortisasi/penyusutan bulanan (Garis Lurus).
- **JournalEntry & JournalLine**: Entri buku besar (*General Ledger*). Jurnal yang di-generate otomatis oleh sistem dari transaksi operasional tidak boleh disunting secara manual, harus lewat dokumen koreksi.

---

## 7. Costing & Laporan 
- **CostAllocation**: Porsi biaya *overhead* (listrik, makan, transport, maintenance, sewa, penyusutan, dan biaya periodik lain) ke SPK produksi. Setiap alokasi membuat baris `ProductionCost` agar ikut masuk HPP aktual.
- **CostOfGoodsSold (HPP)**: *Snapshot* harga pokok produksi. Terdapat dua jenis: *Estimated HPP* (berbasis standar BOM/Routing) dan *Actual HPP* (berbasis ledger aktual saat produk masuk gudang jadi). 

---

*Diagram ER (Entity Relationship) fisik untuk tabel-tabel di atas akan dibuat dalam bentuk skema Django (`models.py`) pada tahap implementasi aplikasi.*
