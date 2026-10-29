BEGIN;

-- ==============================================================================
-- 1. Helper RBAC Multi-Role per Perusahaan (public.has_company_role)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.has_company_role(
  p_company_id uuid,
  p_user_id uuid,
  p_allowed_roles text[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_company_assignment uca
    WHERE uca.company_id = p_company_id
      AND uca.user_id = p_user_id
      AND uca.is_active = true
      AND uca.roles && p_allowed_roles
  );
$$;

REVOKE ALL ON FUNCTION public.has_company_role(uuid, uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_company_role(uuid, uuid, text[]) TO authenticated, service_role;

-- ==============================================================================
-- 2. Proteksi Append-Only dan Validasi Aktor pada public.audit_log (SEC-01)
-- ==============================================================================
REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_log FROM authenticated, anon, PUBLIC;

DROP POLICY IF EXISTS "Tenant isolation policy" ON public.audit_log;
DROP POLICY IF EXISTS "Audit log select policy" ON public.audit_log;
DROP POLICY IF EXISTS "Audit log insert policy" ON public.audit_log;

CREATE POLICY "Audit log select policy"
  ON public.audit_log
  FOR SELECT
  TO authenticated
  USING (
    company_id IN (
      SELECT public.get_user_company_ids((SELECT auth.uid()))
    )
  );

CREATE POLICY "Audit log insert policy"
  ON public.audit_log
  FOR INSERT
  TO authenticated
  WITH CHECK (
    company_id IN (
      SELECT public.get_user_company_ids((SELECT auth.uid()))
    )
    AND (actor_user_id IS NULL OR actor_user_id = (SELECT auth.uid())::text)
    AND (user_id IS NULL OR user_id = (SELECT auth.uid())::text)
  );

-- ==============================================================================
-- 3. Proteksi Matriks Izin Akses pada public.access_permission (SEC-01)
-- ==============================================================================
DROP POLICY IF EXISTS "Tenant isolation policy" ON public.access_permission;
DROP POLICY IF EXISTS "Members can view company permissions" ON public.access_permission;
DROP POLICY IF EXISTS "Owners can manage company permissions" ON public.access_permission;

CREATE POLICY "Members can view company permissions"
  ON public.access_permission
  FOR SELECT
  TO authenticated
  USING (
    company_id IN (
      SELECT public.get_user_company_ids((SELECT auth.uid()))
    )
  );

CREATE POLICY "Owners can manage company permissions"
  ON public.access_permission
  FOR ALL
  TO authenticated
  USING (
    public.is_company_owner(company_id, (SELECT auth.uid()))
  )
  WITH CHECK (
    public.is_company_owner(company_id, (SELECT auth.uid()))
  );

-- ==============================================================================
-- 4. Pembatasan RBAC pada Tabel Master Data & Konfigurasi (SEC-01)
-- ==============================================================================
DO $$
DECLARE
  tbl text;
  master_tables text[] := ARRAY[
    'unit_definition',
    'configuration_category',
    'master_record',
    'production_product_routing',
    'wage_rate'
  ];
BEGIN
  FOREACH tbl IN ARRAY master_tables
  LOOP
    EXECUTE format('
      DROP POLICY IF EXISTS "Tenant isolation policy" ON public.%I;
      DROP POLICY IF EXISTS "Tenant read policy" ON public.%I;
      DROP POLICY IF EXISTS "Master data write policy" ON public.%I;

      CREATE POLICY "Tenant read policy"
        ON public.%I
        FOR SELECT
        TO authenticated
        USING (
          company_id IN (
            SELECT public.get_user_company_ids((SELECT auth.uid()))
          )
        );

      CREATE POLICY "Master data write policy"
        ON public.%I
        FOR ALL
        TO authenticated
        USING (
          public.has_company_role(company_id, (SELECT auth.uid()), ARRAY[''owner'', ''kepala_konveksi''])
        )
        WITH CHECK (
          public.has_company_role(company_id, (SELECT auth.uid()), ARRAY[''owner'', ''kepala_konveksi''])
        );
    ', tbl, tbl, tbl, tbl, tbl);
  END LOOP;
END $$;

-- ==============================================================================
-- 5. Pencabutan Mutasi Tabel Langsung pada Tabel Akuntansi & Buku Besar (SEC-01)
-- Seluruh mutasi tabel berikut wajib melalui stored procedure SECURITY DEFINER.
-- ==============================================================================
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON
  public.journal_entry,
  public.journal_line,
  public.cash_movement,
  public.subledger_entry,
  public.inventory_movement,
  public.wage_liability,
  public.depreciation_entry,
  public.prepaid_amortization_entry,
  public.accounting_period,
  public.document_sequence,
  public.ledger_account,
  public.accounting_mapping,
  public.report_account_mapping,
  public.asset_record,
  public.prepaid_expense
FROM authenticated, anon, PUBLIC;

-- ==============================================================================
-- 6. Sanitasi Data Nomor Rekening Hardcoded pada bootstrap_company_data (SEC-07)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.bootstrap_company_data(
  p_company_id uuid,
  p_creator_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_current_month text;
  v_start_date date;
  v_end_date date;
  v_rec record;
  v_account_id uuid;
  v_menu text;
  v_role text;
  v_is_allowed boolean;
  v_roles text[] := ARRAY[
    'owner',
    'kepala_konveksi',
    'finance',
    'operator_potong',
    'operator_sablon',
    'operator_jahit',
    'operator_packing'
  ];
  v_menus text[] := ARRAY[
    'dashboard',
    'master.customers',
    'master.suppliers',
    'master.materials',
    'master.bom',
    'master.products',
    'master.employees',
    'purchases.materials',
    'purchases.supplies',
    'purchases.non-production',
    'purchases.assets',
    'sales.orders',
    'sales.invoices',
    'production.orders',
    'production.cutting-orders',
    'production.printing-orders',
    'production.sewing-orders',
    'production.packing-orders',
    'production.repairs',
    'production.progress',
    'operators.cutting',
    'operators.printing',
    'operators.sewing',
    'operators.packing',
    'inventory.materials',
    'inventory.incoming',
    'inventory.outgoing',
    'inventory.wip',
    'inventory.finished-goods',
    'finance.purchase-payments',
    'finance.wage-payments',
    'finance.expenses',
    'finance.sales-receipts',
    'finance.cash',
    'finance.assets',
    'finance.coa',
    'finance.reports',
    'settings.companies',
    'settings.users-access'
  ];
BEGIN
  -- 1. Inisialisasi Satuan Standar UOM
  INSERT INTO public.unit_definition (company_id, code, name, decimal_scale, is_active)
  VALUES
    (p_company_id, 'CM', 'Centimeter', 2, true),
    (p_company_id, 'GROSS', 'Gross', 0, true),
    (p_company_id, 'KG', 'Kilogram', 3, true),
    (p_company_id, 'LUSIN', 'Lusin', 0, true),
    (p_company_id, 'M', 'Meter', 3, true),
    (p_company_id, 'PAK', 'Pak', 0, true),
    (p_company_id, 'PCS', 'Pieces', 0, true),
    (p_company_id, 'RIM', 'Rim', 0, true),
    (p_company_id, 'SET', 'Set', 0, true),
    (p_company_id, 'ROLL', 'Roll', 3, true),
    (p_company_id, 'YARD', 'Yard', 3, true)
  ON CONFLICT (company_id, code) DO NOTHING;

  -- 2. Inisialisasi Kategori Konfigurasi Standar
  INSERT INTO public.configuration_category (company_id, category_kind, code, name, defaults, is_active)
  VALUES
    (p_company_id, 'expense', 'UTILITAS', 'Utilitas', '{}'::jsonb, true),
    (p_company_id, 'expense', 'SEWA', 'Sewa', '{}'::jsonb, true),
    (p_company_id, 'expense', 'TRANSPORT', 'Transportasi', '{}'::jsonb, true),
    (p_company_id, 'expense', 'ADMIN', 'Administrasi', '{}'::jsonb, true),
    (p_company_id, 'asset', 'MESIN', 'Mesin Produksi', '{"method": "straight_line", "residualValue": 0, "usefulLifeMonths": 96}'::jsonb, true),
    (p_company_id, 'asset', 'PERALATAN', 'Peralatan Produksi', '{"method": "straight_line", "residualValue": 0, "usefulLifeMonths": 96}'::jsonb, true),
    (p_company_id, 'asset', 'ELEKTRONIK', 'Komputer & Elektronik', '{"method": "straight_line", "residualValue": 0, "usefulLifeMonths": 96}'::jsonb, true),
    (p_company_id, 'asset', 'KENDARAAN', 'Kendaraan', '{"method": "straight_line", "residualValue": 0, "usefulLifeMonths": 96}'::jsonb, true),
    (p_company_id, 'production_overhead', 'BOP', 'Biaya Overhead Pabrik', '{}'::jsonb, true)
  ON CONFLICT (company_id, category_kind, code) DO NOTHING;

  -- 3. Inisialisasi Bagan Akun Standar (COA 65 Akun)
  INSERT INTO public.ledger_account (company_id, code, level1, level2, level3, name, account_type, normal_balance, report_sign, monthly_calculation, is_control, is_active)
  VALUES
    (p_company_id, '1-1.1.01', 'AKTIVA', 'AKTIVA LANCAR', 'KAS DAN BANK', 'Kas Kecil', 'asset', 'debit', 'positive', 'accumulated', true, true),
    (p_company_id, '1-1.1.02', 'AKTIVA', 'AKTIVA LANCAR', 'KAS DAN BANK', 'Bank Utama', 'asset', 'debit', 'positive', 'accumulated', false, true),
    (p_company_id, '1-1.1.03', 'AKTIVA', 'AKTIVA LANCAR', 'KAS DAN BANK', 'KAS TRANSFER', 'asset', 'debit', 'positive', 'accumulated', false, true),
    (p_company_id, '1-1.1.04', 'AKTIVA', 'AKTIVA LANCAR', 'KAS DAN BANK', 'BANK SEMENTARA [01]', 'asset', 'debit', 'positive', 'accumulated', false, true),
    (p_company_id, '1-1.2.01', 'AKTIVA', 'AKTIVA LANCAR', 'PIUTANG USAHA', 'Piutang Penjualan', 'asset', 'debit', 'positive', 'accumulated', true, true),
    (p_company_id, '1-1.2.02', 'AKTIVA', 'AKTIVA LANCAR', 'PIUTANG USAHA', 'Piutang Penjualan Custom', 'asset', 'debit', 'positive', 'accumulated', false, true),
    (p_company_id, '1-1.3.01', 'AKTIVA', 'AKTIVA LANCAR', 'PIUTANG LAIN-LAIN', 'Piutang Direksi', 'asset', 'debit', 'positive', 'accumulated', false, true),
    (p_company_id, '1-1.3.02', 'AKTIVA', 'AKTIVA LANCAR', 'PIUTANG LAIN-LAIN', 'Piutang Karyawan', 'asset', 'debit', 'positive', 'accumulated', false, true),
    (p_company_id, '1-1.3.03', 'AKTIVA', 'AKTIVA LANCAR', 'PIUTANG LAIN-LAIN', 'Piutang Vendor', 'asset', 'debit', 'positive', 'accumulated', false, true),
    (p_company_id, '1-1.3.04', 'AKTIVA', 'AKTIVA LANCAR', 'PIUTANG LAIN-LAIN', 'Piutang Induk Perusahaan', 'asset', 'debit', 'positive', 'accumulated', false, true),
    (p_company_id, '1-1.4.01', 'AKTIVA', 'AKTIVA LANCAR', 'PERSEDIAAN', 'Persediaan Barang Dagang', 'asset', 'debit', 'positive', 'accumulated', true, true),
    (p_company_id, '1-1.4.02', 'AKTIVA', 'AKTIVA LANCAR', 'PERSEDIAAN', 'Persediaan Bahan Baku', 'asset', 'debit', 'positive', 'accumulated', true, true),
    (p_company_id, '1-1.4.03', 'AKTIVA', 'AKTIVA LANCAR', 'PERSEDIAAN', 'Persediaan Dalam Proses', 'asset', 'debit', 'positive', 'accumulated', true, true),
    (p_company_id, '1-1.5.01', 'AKTIVA', 'AKTIVA LANCAR', 'PEMBAYARAN DIMUKA', 'Uang Muka Pesanan Pembelian', 'asset', 'debit', 'positive', 'accumulated', true, true),
    (p_company_id, '1-1.6.01', 'AKTIVA', 'AKTIVA LANCAR', 'BIAYA DIBAYAR DIMUKA', 'Sewa Dibayar Dimuka', 'asset', 'debit', 'positive', 'accumulated', false, true),
    (p_company_id, '1-1.6.02', 'AKTIVA', 'AKTIVA LANCAR', 'BIAYA DIBAYAR DIMUKA', 'Asuransi Dibayar Dimuka', 'asset', 'debit', 'positive', 'accumulated', false, true),
    (p_company_id, '1-1.7.01', 'AKTIVA', 'AKTIVA LANCAR', 'PAJAK DIBAYAR DIMUKA', 'PPN Masukan', 'asset', 'debit', 'positive', 'accumulated', false, true),
    (p_company_id, '1-1.7.02', 'AKTIVA', 'AKTIVA LANCAR', 'PAJAK DIBAYAR DIMUKA', 'PPh21 Dibayar Dimuka', 'asset', 'debit', 'positive', 'accumulated', false, true),
    (p_company_id, '1-1.7.03', 'AKTIVA', 'AKTIVA LANCAR', 'PAJAK DIBAYAR DIMUKA', 'PPh23 Dibayar Dimuka', 'asset', 'debit', 'positive', 'accumulated', false, true),
    (p_company_id, '1-1.7.05', 'AKTIVA', 'AKTIVA LANCAR', 'PAJAK DIBAYAR DIMUKA', 'PPh Pasal 4 Ayat 2 Dibayar Dimuka', 'asset', 'debit', 'positive', 'accumulated', false, true),
    (p_company_id, '1-2.0.01', 'AKTIVA', 'AKTIVA TETAP', 'AKTIVA TETAP', 'Tanah', 'asset', 'debit', 'positive', 'accumulated', false, true),
    (p_company_id, '1-2.0.02', 'AKTIVA', 'AKTIVA TETAP', 'AKTIVA TETAP', 'Gedung', 'asset', 'debit', 'positive', 'accumulated', false, true),
    (p_company_id, '1-2.0.03', 'AKTIVA', 'AKTIVA TETAP', 'AKTIVA TETAP', 'Kendaraan', 'asset', 'debit', 'positive', 'accumulated', false, true),
    (p_company_id, '1-2.0.04', 'AKTIVA', 'AKTIVA TETAP', 'AKTIVA TETAP', 'Peralatan Kantor', 'asset', 'debit', 'positive', 'accumulated', true, true),
    (p_company_id, '1-2.1.01', 'AKTIVA', 'AKTIVA TETAP', 'PENYUSUTAN AKTIVA TETAP', 'Ak. Peny. Gedung', 'asset', 'debit', 'negative', 'accumulated', false, true),
    (p_company_id, '1-2.1.02', 'AKTIVA', 'AKTIVA TETAP', 'PENYUSUTAN AKTIVA TETAP', 'Ak. Peny. Kendaraan', 'asset', 'debit', 'negative', 'accumulated', false, true),
    (p_company_id, '1-2.1.03', 'AKTIVA', 'AKTIVA TETAP', 'PENYUSUTAN AKTIVA TETAP', 'Ak. Peny. Peralatan Kantor', 'asset', 'debit', 'negative', 'accumulated', true, true),
    (p_company_id, '1-2.1.04', 'AKTIVA', 'AKTIVA TETAP', 'PENYUSUTAN AKTIVA TETAP', 'Ak. Peny. Software', 'asset', 'debit', 'negative', 'accumulated', false, true),
    (p_company_id, '1-3.0.01', 'AKTIVA', 'AKTIVA TETAP', 'AKTIVA TIDAK BERWUJUD', 'Software', 'asset', 'debit', 'positive', 'accumulated', false, true),
    (p_company_id, '1-3.0.02', 'AKTIVA', 'AKTIVA TETAP', 'AKTIVA TIDAK BERWUJUD', 'Merek Dagang', 'asset', 'debit', 'positive', 'accumulated', false, true),
    (p_company_id, '2-1.1.01', 'KEWAJIBAN', 'HUTANG JANGKA PENDEK', 'HUTANG DAGANG', 'Hutang Kepada Vendor', 'liability', 'credit', 'positive', 'accumulated', true, true),
    (p_company_id, '2-1.1.02', 'KEWAJIBAN', 'HUTANG JANGKA PENDEK', 'HUTANG DAGANG', 'Hutang Kepada Induk Perusahaan', 'liability', 'credit', 'positive', 'accumulated', false, true),
    (p_company_id, '2-1.1.03', 'KEWAJIBAN', 'HUTANG JANGKA PENDEK', 'HUTANG DAGANG', 'Hutang Konsinyasi', 'liability', 'credit', 'positive', 'accumulated', false, true),
    (p_company_id, '2-1.1.04', 'KEWAJIBAN', 'HUTANG JANGKA PENDEK', 'HUTANG DAGANG', 'Pendapatan Diterima Dimuka', 'liability', 'credit', 'positive', 'accumulated', false, true),
    (p_company_id, '2-1.1.05', 'KEWAJIBAN', 'HUTANG JANGKA PENDEK', 'HUTANG DAGANG', 'Uang Muka Pesanan Penjualan', 'liability', 'credit', 'positive', 'accumulated', false, true),
    (p_company_id, '2-1.2.01', 'KEWAJIBAN', 'HUTANG JANGKA PENDEK', 'HUTANG BIAYA', 'Hutang Gaji', 'liability', 'credit', 'positive', 'accumulated', true, true),
    (p_company_id, '2-1.2.02', 'KEWAJIBAN', 'HUTANG JANGKA PENDEK', 'HUTANG BIAYA', 'Hutang THR', 'liability', 'credit', 'positive', 'accumulated', false, true),
    (p_company_id, '2-1.2.03', 'KEWAJIBAN', 'HUTANG JANGKA PENDEK', 'HUTANG BIAYA', 'Hutang Bonus', 'liability', 'credit', 'positive', 'accumulated', false, true),
    (p_company_id, '2-1.2.04', 'KEWAJIBAN', 'HUTANG JANGKA PENDEK', 'HUTANG BIAYA', 'Hutang Komisi', 'liability', 'credit', 'positive', 'accumulated', false, true),
    (p_company_id, '2-1.3.01', 'KEWAJIBAN', 'HUTANG JANGKA PENDEK', 'HUTANG PAJAK', 'PPN Keluaran', 'liability', 'credit', 'positive', 'accumulated', false, true),
    (p_company_id, '2-1.3.02', 'KEWAJIBAN', 'HUTANG JANGKA PENDEK', 'HUTANG PAJAK', 'Hutang PPh21', 'liability', 'credit', 'positive', 'accumulated', false, true),
    (p_company_id, '2-1.3.03', 'KEWAJIBAN', 'HUTANG JANGKA PENDEK', 'HUTANG PAJAK', 'Hutang PPh23', 'liability', 'credit', 'positive', 'accumulated', false, true),
    (p_company_id, '2-1.3.04', 'KEWAJIBAN', 'HUTANG JANGKA PENDEK', 'HUTANG PAJAK', 'Hutang PPh Pasal 4 Ayat 2', 'liability', 'credit', 'positive', 'accumulated', false, true),
    (p_company_id, '2-2.0.01', 'KEWAJIBAN', 'HUTANG JANGKA PANJANG', 'HUTANG JANGKA PANJANG', 'Hutang Bank', 'liability', 'credit', 'positive', 'accumulated', false, true),
    (p_company_id, '2-3.0.01', 'KEWAJIBAN', 'KEWAJIBAN', 'HUTANG LAIN-LAIN', 'Hutang Kepada Owner', 'liability', 'credit', 'positive', 'accumulated', false, true),
    (p_company_id, '2-3.0.02', 'KEWAJIBAN', 'KEWAJIBAN', 'HUTANG LAIN-LAIN', 'Hutang lainnya', 'liability', 'credit', 'positive', 'accumulated', false, true),
    (p_company_id, '2-3.0.03', 'KEWAJIBAN', 'KEWAJIBAN', 'HUTANG LAIN-LAIN', 'Hutang Ongkir', 'liability', 'credit', 'positive', 'accumulated', false, true),
    (p_company_id, '3-1.0.00', 'MODAL', 'MODAL', 'MODAL', 'Modal', 'equity', 'credit', 'positive', 'accumulated', false, true),
    (p_company_id, '3-2.0.00', 'MODAL', 'MODAL', 'MODAL', 'Laba Ditahan', 'equity', 'credit', 'positive', 'accumulated', false, true),
    (p_company_id, '3-3.0.00', 'MODAL', 'MODAL', 'MODAL', 'Laba Tahun Berjalan', 'equity', 'credit', 'positive', 'accumulated', false, true),
    (p_company_id, '3-8.0.00', 'MODAL', 'MODAL', 'MODAL', 'Prive', 'equity', 'debit', 'negative', 'periodic', false, true),
    (p_company_id, '3-9.0.00', 'MODAL', 'MODAL', 'MODAL', 'Historical Balancing', 'equity', 'credit', 'positive', 'accumulated', true, true),
    (p_company_id, '4-1.0.01', 'PENDAPATAN', 'PENDAPATAN USAHA', 'PENJUALAN', 'Penjualan', 'revenue', 'credit', 'positive', 'periodic', false, true),
    (p_company_id, '4-1.0.02', 'PENDAPATAN', 'PENDAPATAN USAHA', 'PENJUALAN', 'Penjualan Custom', 'revenue', 'credit', 'positive', 'periodic', false, true),
    (p_company_id, '4-1.0.08', 'PENDAPATAN', 'PENDAPATAN USAHA', 'PENJUALAN', 'Penjualan lainya', 'revenue', 'credit', 'positive', 'periodic', false, true),
    (p_company_id, '4-1.1.01', 'PENDAPATAN', 'PENDAPATAN USAHA', 'POTONGAN PENJUALAN', 'Diskon Penjualan', 'revenue', 'debit', 'negative', 'periodic', false, true),
    (p_company_id, '4-1.1.02', 'PENDAPATAN', 'PENDAPATAN USAHA', 'POTONGAN PENJUALAN', 'Retur Penjualan', 'revenue', 'debit', 'negative', 'periodic', false, true),
    (p_company_id, '4-2.0.01', 'PENDAPATAN', 'PENDAPATAN DILUAR USAHA', 'PENDAPATAN DILUAR USAHA', 'Pendapatan Bunga', 'revenue', 'credit', 'positive', 'periodic', false, true),
    (p_company_id, '4-2.0.02', 'PENDAPATAN', 'PENDAPATAN DILUAR USAHA', 'PENDAPATAN DILUAR USAHA', 'Pendapatan Komisi/ Cashback', 'revenue', 'credit', 'positive', 'periodic', false, true),
    (p_company_id, '4-2.0.03', 'PENDAPATAN', 'PENDAPATAN DILUAR USAHA', 'PENDAPATAN DILUAR USAHA', 'Laba Penjualan Aktiva', 'revenue', 'credit', 'positive', 'periodic', false, true),
    (p_company_id, '5-1.1.00', 'HARGA POKOK PENJUALAN', 'HARGA POKOK PENJUALAN.', 'HPP.', 'Hpp', 'expense', 'debit', 'positive', 'periodic', false, true),
    (p_company_id, '5-1.1.01', 'HARGA POKOK PENJUALAN', 'HARGA POKOK PENJUALAN.', 'HPP.', 'Hpp Custom', 'expense', 'debit', 'positive', 'periodic', false, true),
    (p_company_id, '5-1.1.07', 'HARGA POKOK PENJUALAN', 'HARGA POKOK PENJUALAN.', 'HPP.', 'Hpp Lainnya', 'expense', 'debit', 'positive', 'periodic', false, true),
    (p_company_id, '5-2.2.01', 'HARGA POKOK PENJUALAN', 'LAIN LAIN', 'PENGURANGAN STOK', 'Item Masuk', 'expense', 'debit', 'negative', 'periodic', false, true),
    (p_company_id, '5-2.2.02', 'HARGA POKOK PENJUALAN', 'LAIN LAIN', 'PENGURANGAN STOK', 'Item Keluar', 'expense', 'debit', 'positive', 'periodic', false, true),
    (p_company_id, '6-1.1.01', 'BIAYA', 'BIAYA ADMINISTRASI DAN UMUM', 'BIAYA GAJI DAN UPAH', 'Biaya Gaji Pegawai', 'expense', 'debit', 'positive', 'periodic', false, true),
    (p_company_id, '6-1.1.02', 'BIAYA', 'BIAYA ADMINISTRASI DAN UMUM', 'BIAYA GAJI DAN UPAH', 'Biaya Upah Kerja', 'expense', 'debit', 'positive', 'periodic', false, true),
    (p_company_id, '6-1.1.03', 'BIAYA', 'BIAYA ADMINISTRASI DAN UMUM', 'BIAYA GAJI DAN UPAH', 'Biaya Komisi', 'expense', 'debit', 'positive', 'periodic', false, true),
    (p_company_id, '6-1.1.04', 'BIAYA', 'BIAYA ADMINISTRASI DAN UMUM', 'BIAYA GAJI DAN UPAH', 'Biaya THR', 'expense', 'debit', 'positive', 'periodic', false, true),
    (p_company_id, '6-1.1.05', 'BIAYA', 'BIAYA ADMINISTRASI DAN UMUM', 'BIAYA GAJI DAN UPAH', 'Biaya Pesangon', 'expense', 'debit', 'positive', 'periodic', false, true),
    (p_company_id, '6-1.1.06', 'BIAYA', 'BIAYA ADMINISTRASI DAN UMUM', 'BIAYA GAJI DAN UPAH', 'Biaya Kesehatan', 'expense', 'debit', 'positive', 'periodic', false, true),
    (p_company_id, '6-1.1.07', 'BIAYA', 'BIAYA ADMINISTRASI DAN UMUM', 'BIAYA GAJI DAN UPAH', 'Biaya Uang Makan', 'expense', 'debit', 'positive', 'periodic', false, true),
    (p_company_id, '6-1.2.01', 'BIAYA', 'BIAYA ADMINISTRASI DAN UMUM', 'BIAYA SEWA DAN UTILITAS', 'Biaya Sewa', 'expense', 'debit', 'positive', 'periodic', false, true),
    (p_company_id, '6-1.2.02', 'BIAYA', 'BIAYA ADMINISTRASI DAN UMUM', 'BIAYA SEWA DAN UTILITAS', 'Biaya Perbaikan Kantor', 'expense', 'debit', 'positive', 'periodic', false, true),
    (p_company_id, '6-1.2.03', 'BIAYA', 'BIAYA ADMINISTRASI DAN UMUM', 'BIAYA SEWA DAN UTILITAS', 'Biaya Tlp/Listrik/Air', 'expense', 'debit', 'positive', 'periodic', false, true),
    (p_company_id, '6-1.3.01', 'BIAYA', 'BIAYA ADMINISTRASI DAN UMUM', 'BIAYA ASURANSI', 'Biaya Asuransi', 'expense', 'debit', 'positive', 'periodic', false, true),
    (p_company_id, '6-1.4.01', 'BIAYA', 'BIAYA ADMINISTRASI DAN UMUM', 'BIAYA PAJAK', 'Biaya PBB', 'expense', 'debit', 'positive', 'periodic', false, true),
    (p_company_id, '6-1.5.01', 'BIAYA', 'BIAYA ADMINISTRASI DAN UMUM', 'BIAYA PERJALANAN DINAS', 'Biaya Transport', 'expense', 'debit', 'positive', 'periodic', false, true),
    (p_company_id, '6-1.5.02', 'BIAYA', 'BIAYA ADMINISTRASI DAN UMUM', 'BIAYA PERJALANAN DINAS', 'Biaya Bensin', 'expense', 'debit', 'positive', 'periodic', false, true),
    (p_company_id, '6-1.5.03', 'BIAYA', 'BIAYA ADMINISTRASI DAN UMUM', 'BIAYA PERJALANAN DINAS', 'Biaya Parkir', 'expense', 'debit', 'positive', 'periodic', false, true),
    (p_company_id, '6-1.6.01', 'BIAYA', 'BIAYA ADMINISTRASI DAN UMUM', 'BIAYA KOMUNIKASI DAN INTERNET', 'Biaya Web / Internet', 'expense', 'debit', 'positive', 'periodic', false, true),
    (p_company_id, '6-1.6.02', 'BIAYA', 'BIAYA ADMINISTRASI DAN UMUM', 'BIAYA KOMUNIKASI DAN INTERNET', 'Biaya Pulsa / Quota', 'expense', 'debit', 'positive', 'periodic', false, true),
    (p_company_id, '6-1.7.01', 'BIAYA', 'BIAYA ADMINISTRASI DAN UMUM', 'BIAYA PELATIHAN KARYAWAN', 'Biaya Pelatihan', 'expense', 'debit', 'positive', 'periodic', false, true),
    (p_company_id, '6-1.7.02', 'BIAYA', 'BIAYA ADMINISTRASI DAN UMUM', 'BIAYA PELATIHAN KARYAWAN', 'Biaya Reseach and Development', 'expense', 'debit', 'positive', 'periodic', false, true),
    (p_company_id, '6-1.8.01', 'BIAYA', 'BIAYA ADMINISTRASI DAN UMUM', 'BIAYA UMUM LAINNYA', 'Biaya Keperluan kantor', 'expense', 'debit', 'positive', 'periodic', false, true),
    (p_company_id, '6-1.8.02', 'BIAYA', 'BIAYA ADMINISTRASI DAN UMUM', 'BIAYA UMUM LAINNYA', 'Biaya Keperluan Dapur', 'expense', 'debit', 'positive', 'periodic', false, true),
    (p_company_id, '6-1.8.03', 'BIAYA', 'BIAYA ADMINISTRASI DAN UMUM', 'BIAYA UMUM LAINNYA', 'Biaya Air Minum', 'expense', 'debit', 'positive', 'periodic', false, true),
    (p_company_id, '6-1.8.04', 'BIAYA', 'BIAYA ADMINISTRASI DAN UMUM', 'BIAYA UMUM LAINNYA', 'Biaya Konsumsi', 'expense', 'debit', 'positive', 'periodic', false, true),
    (p_company_id, '6-1.8.05', 'BIAYA', 'BIAYA ADMINISTRASI DAN UMUM', 'BIAYA UMUM LAINNYA', 'Biaya ATK', 'expense', 'debit', 'positive', 'periodic', false, true),
    (p_company_id, '6-1.9.01', 'BIAYA', 'BIAYA ADMINISTRASI DAN UMUM', 'BIAYA ADMIN', 'Biaya Admin Bank', 'expense', 'debit', 'positive', 'periodic', false, true),
    (p_company_id, '6-2.1.01', 'BIAYA', 'BIAYA OPERASIONAL', 'BIAYA PENJUALAN', 'Biaya Kerugian Piutang', 'expense', 'debit', 'positive', 'periodic', false, true),
    (p_company_id, '6-2.1.02', 'BIAYA', 'BIAYA OPERASIONAL', 'BIAYA PENJUALAN', 'Biaya Garansi', 'expense', 'debit', 'positive', 'periodic', false, true),
    (p_company_id, '6-2.1.03', 'BIAYA', 'BIAYA OPERASIONAL', 'BIAYA PENJUALAN', 'Biaya Aksesoris Produk', 'expense', 'debit', 'positive', 'periodic', false, true),
    (p_company_id, '6-2.1.04', 'BIAYA', 'BIAYA OPERASIONAL', 'BIAYA PENJUALAN', 'Biaya Kemasan Produk', 'expense', 'debit', 'positive', 'periodic', false, true),
    (p_company_id, '6-2.1.05', 'BIAYA', 'BIAYA OPERASIONAL', 'BIAYA PENJUALAN', 'Biaya Ongkir', 'expense', 'debit', 'positive', 'periodic', false, true),
    (p_company_id, '6-2.2.01', 'BIAYA', 'BIAYA OPERASIONAL', 'BIAYA RISET DAN PENGEMBANGAN', 'Biaya RND', 'expense', 'debit', 'positive', 'periodic', false, true),
    (p_company_id, '6-2.3.01', 'BIAYA', 'BIAYA OPERASIONAL', 'BIAYA MARKETING', 'Biaya Promosi', 'expense', 'debit', 'positive', 'periodic', false, true),
    (p_company_id, '6-3.0.01', 'BIAYA', 'BIAYA PENYUSUTAN', 'BIAYA PENYUSUTAN', 'Biaya Penyusutan Gedung', 'expense', 'debit', 'positive', 'periodic', false, true),
    (p_company_id, '6-3.0.02', 'BIAYA', 'BIAYA PENYUSUTAN', 'BIAYA PENYUSUTAN', 'Biaya Penyusutan Kendaraan', 'expense', 'debit', 'positive', 'periodic', false, true),
    (p_company_id, '6-3.0.03', 'BIAYA', 'BIAYA PENYUSUTAN', 'BIAYA PENYUSUTAN', 'Biaya Penyusutan Peralatan Kantor', 'expense', 'debit', 'positive', 'periodic', false, true),
    (p_company_id, '6-3.0.04', 'BIAYA', 'BIAYA PENYUSUTAN', 'BIAYA PENYUSUTAN', 'Biaya Penyusutan Software', 'expense', 'debit', 'positive', 'periodic', false, true),
    (p_company_id, '7-1.0.00', 'PENDAPATAN LAIN', 'PENDAPATAN LAIN', 'PENDAPATAN LAIN', 'Laba Selisih Kurs', 'revenue', 'debit', 'positive', 'periodic', false, true),
    (p_company_id, '8-1.0.00', 'BIAYA LAINNYA', 'BIAYA LAIN', 'BIAYA LAIN', 'Rugi Selisih Kurs', 'expense', 'debit', 'positive', 'periodic', false, true),
    (p_company_id, '8-2.0.00', 'BIAYA LAINNYA', 'BIAYA LAIN', 'BIAYA LAIN', 'Biaya Lainnya', 'expense', 'debit', 'positive', 'periodic', false, true),
    (p_company_id, '8-2.0.01', 'BIAYA LAINNYA', 'BIAYA LAIN', 'BIAYA LAIN', 'Sedekah', 'expense', 'debit', 'positive', 'periodic', false, true),
    (p_company_id, '8-2.0.02', 'BIAYA LAINNYA', 'BIAYA LAIN', 'BIAYA LAIN', 'Zakat', 'expense', 'debit', 'positive', 'periodic', false, true)
  ON CONFLICT (company_id, code) DO NOTHING;

  -- 4. Inisialisasi Pemetaan Sistem (Accounting Mapping)
  FOR v_rec IN
    SELECT key, code FROM (VALUES
      ('cash', '1-1.1.01'),
      ('receivable', '1-1.2.01'),
      ('material_inventory', '1-1.4.02'),
      ('production_supplies_inventory', '1-1.4.02'),
      ('wip_cut', '1-1.4.03'),
      ('wip_printed', '1-1.4.03'),
      ('wip_sewn', '1-1.4.03'),
      ('finished_goods', '1-1.4.01'),
      ('asset_candidate', '1-1.5.01'),
      ('fixed_asset', '1-2.0.04'),
      ('accumulated_depreciation', '1-2.1.03'),
      ('supplier_payable', '2-1.1.01'),
      ('wage_payable', '2-1.2.01'),
      ('opening_equity', '3-9.0.00'),
      ('sales_revenue', '4-1.0.01'),
      ('asset_disposal_gain', '4-2.0.03'),
      ('cogs', '5-1.1.00'),
      ('operating_expense', '8-2.0.00'),
      ('production_overhead', '6-2.1.03'),
      ('depreciation_expense', '6-3.0.03'),
      ('asset_disposal_loss', '8-2.0.00')
    ) AS t(key, code)
  LOOP
    SELECT id INTO v_account_id FROM public.ledger_account WHERE company_id = p_company_id AND code = v_rec.code;
    IF v_account_id IS NOT NULL THEN
      INSERT INTO public.accounting_mapping (company_id, mapping_key, account_id)
      VALUES (p_company_id, v_rec.key, v_account_id)
      ON CONFLICT (company_id, mapping_key) DO NOTHING;
    END IF;
  END LOOP;

  -- 5. Inisialisasi Pemetaan Akun Laporan (Report Account Mapping)
  FOR v_rec IN
    SELECT code, post, act, grp FROM (VALUES
      ('4-1.0.01', 'revenue', 'operating', 'customer_receipts'),
      ('4-1.0.02', 'revenue', 'operating', 'customer_receipts'),
      ('4-1.0.08', 'revenue', 'operating', 'customer_receipts'),
      ('5-1.1.00', 'cogs', 'operating', 'supplier_payments'),
      ('5-1.1.01', 'cogs', 'operating', 'supplier_payments'),
      ('5-1.1.07', 'cogs', 'operating', 'supplier_payments'),
      ('1-1.2.01', 'other', 'operating', 'customer_receipts'),
      ('2-1.1.01', 'other', 'operating', 'supplier_payments'),
      ('2-1.2.01', 'other', 'operating', 'payroll_and_operating_expenses'),
      ('1-1.5.01', 'other', 'investing', 'asset_purchases'),
      ('6-2.3.01', 'marketing_ads', 'operating', 'payroll_and_operating_expenses'),
      ('6-1.1.01', 'payroll', 'operating', 'payroll_and_operating_expenses'),
      ('6-1.1.02', 'payroll', 'operating', 'payroll_and_operating_expenses'),
      ('6-1.1.03', 'payroll', 'operating', 'payroll_and_operating_expenses'),
      ('6-1.1.04', 'payroll', 'operating', 'payroll_and_operating_expenses'),
      ('6-1.1.05', 'payroll', 'operating', 'payroll_and_operating_expenses'),
      ('6-1.1.06', 'payroll', 'operating', 'payroll_and_operating_expenses'),
      ('6-1.1.07', 'payroll', 'operating', 'payroll_and_operating_expenses'),
      ('1-2.0.01', 'other', 'investing', 'asset_purchases'),
      ('1-2.0.02', 'other', 'investing', 'asset_purchases'),
      ('1-2.0.03', 'other', 'investing', 'asset_purchases'),
      ('1-2.0.04', 'other', 'investing', 'asset_purchases'),
      ('3-1.0.00', 'other', 'financing', 'owner_contributions'),
      ('3-8.0.00', 'other', 'financing', 'owner_drawings'),
      ('2-2.0.01', 'other', 'financing', 'debt_financing')
    ) AS t(code, post, act, grp)
  LOOP
    SELECT id INTO v_account_id FROM public.ledger_account WHERE company_id = p_company_id AND code = v_rec.code;
    IF v_account_id IS NOT NULL THEN
      INSERT INTO public.report_account_mapping (company_id, account_id, management_post, cash_flow_activity, cash_flow_group)
      VALUES (p_company_id, v_account_id, v_rec.post, v_rec.act, v_rec.grp)
      ON CONFLICT (company_id, account_id) DO NOTHING;
    END IF;
  END LOOP;

  FOR v_rec IN
    SELECT id FROM public.ledger_account
    WHERE company_id = p_company_id
      AND level1 = 'BIAYA'
      AND level3 NOT IN ('BIAYA GAJI DAN UPAH', 'BIAYA MARKETING')
  LOOP
    INSERT INTO public.report_account_mapping (company_id, account_id, management_post, cash_flow_activity, cash_flow_group)
    VALUES (p_company_id, v_rec.id, 'operating_expense', 'operating', 'payroll_and_operating_expenses')
    ON CONFLICT (company_id, account_id) DO NOTHING;
  END LOOP;

  -- 6. Inisialisasi Periode Akuntansi Awal (Bulan Berjalan)
  v_current_month := to_char(now(), 'YYYY-MM');
  v_start_date := date_trunc('month', now())::date;
  v_end_date := (date_trunc('month', now()) + interval '1 month - 1 day')::date;

  INSERT INTO public.accounting_period (company_id, period_month, start_date, end_date, status, state, opening_state)
  VALUES (p_company_id, v_current_month, v_start_date, v_end_date, 'open', 'open', 'pending')
  ON CONFLICT (company_id, period_month) DO NOTHING;

  -- 7. Inisialisasi Matriks Izin Akses Default
  FOREACH v_role IN ARRAY v_roles
  LOOP
    FOREACH v_menu IN ARRAY v_menus
    LOOP
      v_is_allowed := false;

      IF v_role = 'owner' THEN
        v_is_allowed := true;
      ELSIF v_role = 'kepala_konveksi' AND v_menu IN (
        'dashboard',
        'master.customers',
        'master.suppliers',
        'master.materials',
        'master.bom',
        'master.products',
        'master.employees',
        'purchases.materials',
        'purchases.supplies',
        'purchases.non-production',
        'purchases.assets',
        'sales.orders',
        'sales.invoices',
        'production.orders',
        'production.cutting-orders',
        'production.printing-orders',
        'production.sewing-orders',
        'production.packing-orders',
        'production.repairs',
        'production.progress',
        'inventory.materials',
        'inventory.incoming',
        'inventory.outgoing',
        'inventory.wip',
        'inventory.finished-goods'
      ) THEN
        v_is_allowed := true;
      ELSIF v_role = 'finance' AND v_menu IN (
        'dashboard',
        'finance.purchase-payments',
        'finance.wage-payments',
        'finance.expenses',
        'finance.sales-receipts',
        'finance.cash',
        'finance.assets',
        'finance.coa',
        'finance.reports'
      ) THEN
        v_is_allowed := true;
      ELSIF v_role = 'operator_potong' AND v_menu IN ('dashboard', 'operators.cutting') THEN
        v_is_allowed := true;
      ELSIF v_role = 'operator_sablon' AND v_menu IN ('dashboard', 'operators.printing') THEN
        v_is_allowed := true;
      ELSIF v_role = 'operator_jahit' AND v_menu IN ('dashboard', 'operators.sewing') THEN
        v_is_allowed := true;
      ELSIF v_role = 'operator_packing' AND v_menu IN ('dashboard', 'operators.packing') THEN
        v_is_allowed := true;
      END IF;

      INSERT INTO public.access_permission (
        company_id, role, menu_key,
        can_view, can_create, can_edit, can_delete, can_post, can_void, allowed
      )
      VALUES (
        p_company_id, v_role, v_menu,
        v_is_allowed, v_is_allowed, v_is_allowed,
        CASE WHEN v_role IN ('owner', 'kepala_konveksi') THEN v_is_allowed ELSE false END,
        CASE WHEN v_role IN ('owner', 'kepala_konveksi', 'finance') THEN v_is_allowed ELSE false END,
        CASE WHEN v_role = 'owner' THEN v_is_allowed ELSE false END,
        v_is_allowed
      )
      ON CONFLICT (company_id, role, menu_key) DO NOTHING;
    END LOOP;
  END LOOP;

  -- 8. Inisialisasi Sequence Penomoran Dokumen
  INSERT INTO public.document_sequence (company_id, sequence_key, prefix, padding, current_number)
  VALUES
    (p_company_id, 'SO', 'SO-', 5, 0),
    (p_company_id, 'INV', 'INV-', 5, 0),
    (p_company_id, 'PO', 'PO-', 5, 0),
    (p_company_id, 'WO', 'WO-', 5, 0),
    (p_company_id, 'CUT', 'CUT-', 5, 0),
    (p_company_id, 'PRT', 'PRT-', 5, 0),
    (p_company_id, 'SEW', 'SEW-', 5, 0),
    (p_company_id, 'PCK', 'PCK-', 5, 0),
    (p_company_id, 'PAY', 'PAY-', 5, 0),
    (p_company_id, 'RCP', 'RCP-', 5, 0),
    (p_company_id, 'EXP', 'EXP-', 5, 0),
    (p_company_id, 'JV', 'JV-', 5, 0),
    (p_company_id, 'AST', 'AST-', 5, 0)
  ON CONFLICT (company_id, sequence_key) DO NOTHING;

  -- 9. Tautkan User Pembuat sebagai Owner pada Perusahaan Ini
  IF p_creator_user_id IS NOT NULL THEN
    INSERT INTO public.user_company_assignment (company_id, user_id, roles, is_active, version)
    VALUES (p_company_id, p_creator_user_id, ARRAY['owner'], true, 1)
    ON CONFLICT (company_id, user_id) DO UPDATE
    SET roles = ARRAY['owner'], is_active = true, updated_at = now();
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.bootstrap_company_data(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_company_data(uuid, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;

