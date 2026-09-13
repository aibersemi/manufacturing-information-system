-- ==============================================================================
-- 20260913000001_foundation_schema.sql
-- Manufacturing Information System (MIS) - Foundation Schema & Multi-Company RLS
-- ==============================================================================

-- 1. Ekstensi & Helper Functions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Helper untuk mengembalikan user_id dari sesi auth Supabase
CREATE OR REPLACE FUNCTION public.app_current_user_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(auth.uid()::text, '');
$$;

-- Helper untuk mengekstrak UUID company aktif dari custom claim JWT atau header session
CREATE OR REPLACE FUNCTION public.app_current_company_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_claim text;
  v_setting text;
BEGIN
  -- 1. Cek claim request.jwt.claim.active_company_id
  BEGIN
    v_claim := current_setting('request.jwt.claim.active_company_id', true);
  EXCEPTION WHEN OTHERS THEN
    v_claim := null;
  END;
  IF v_claim IS NOT NULL AND v_claim <> '' THEN
    RETURN v_claim::uuid;
  END IF;

  -- 2. Cek JSON claim request.jwt.claims
  BEGIN
    v_claim := (nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'active_company_id');
  EXCEPTION WHEN OTHERS THEN
    v_claim := null;
  END;
  IF v_claim IS NOT NULL AND v_claim <> '' THEN
    RETURN v_claim::uuid;
  END IF;

  -- 3. Cek custom parameter session app.current_company_id
  BEGIN
    v_setting := current_setting('app.current_company_id', true);
  EXCEPTION WHEN OTHERS THEN
    v_setting := null;
  END;
  IF v_setting IS NOT NULL AND v_setting <> '' THEN
    RETURN v_setting::uuid;
  END IF;

  RETURN null;
END;
$$;

-- Trigger function untuk memperbarui kolom updated_at otomatis
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Helper security definer untuk mendapatkan daftar company_id user tanpa memicu rekursi RLS
CREATE OR REPLACE FUNCTION public.get_user_company_ids(p_user_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT company_id
  FROM public.user_company_assignment
  WHERE user_id = p_user_id
    AND is_active = true;
$$;

-- Helper security definer untuk memeriksa apakah user berstatus owner di company tertentu
CREATE OR REPLACE FUNCTION public.is_company_owner(p_company_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_company_assignment
    WHERE company_id = p_company_id
      AND user_id = p_user_id
      AND 'owner' = ANY(roles)
      AND is_active = true
  );
$$;


-- ==============================================================================
-- 2. Tabel Identitas, Perusahaan & Otorisasi
-- ==============================================================================

-- Perusahaan / Fasilitas Manufaktur (Multi-Company Tenant)
CREATE TABLE IF NOT EXISTS public.company (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  address text,
  phone text,
  email text,
  logo_storage_key text,
  is_active boolean NOT NULL DEFAULT true,
  code_locked boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT company_code_unique UNIQUE (code),
  CONSTRAINT company_name_unique UNIQUE (name)
);

CREATE OR REPLACE TRIGGER update_company_updated_at
  BEFORE UPDATE ON public.company
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Penugasan Pengguna ke Perusahaan
CREATE TABLE IF NOT EXISTS public.user_company_assignment (
  company_id uuid NOT NULL REFERENCES public.company(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  roles text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, user_id)
);

CREATE INDEX IF NOT EXISTS user_company_assignment_user_id_idx ON public.user_company_assignment(user_id);
CREATE INDEX IF NOT EXISTS user_company_assignment_company_id_idx ON public.user_company_assignment(company_id);

CREATE OR REPLACE TRIGGER update_user_company_assignment_updated_at
  BEFORE UPDATE ON public.user_company_assignment
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Matriks Izin Akses Granular per Role & Menu
CREATE TABLE IF NOT EXISTS public.access_permission (
  company_id uuid NOT NULL REFERENCES public.company(id) ON DELETE CASCADE,
  role text NOT NULL,
  menu_key text NOT NULL,
  can_view boolean NOT NULL DEFAULT true,
  can_create boolean NOT NULL DEFAULT false,
  can_edit boolean NOT NULL DEFAULT false,
  can_delete boolean NOT NULL DEFAULT false,
  can_post boolean NOT NULL DEFAULT false,
  can_void boolean NOT NULL DEFAULT false,
  allowed boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  updated_by_user_id text,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, role, menu_key),
  CONSTRAINT access_permission_role_check CHECK (role IN ('owner', 'kepala_konveksi', 'finance', 'operator_potong', 'operator_sablon', 'operator_jahit', 'operator_packing'))
);

CREATE INDEX IF NOT EXISTS access_permission_role_idx ON public.access_permission(company_id, role);

-- Audit Log Aktivitas & Perubahan Data Sistem
CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.company(id) ON DELETE CASCADE,
  user_id text,
  actor_user_id text,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  object_type text,
  object_id text,
  result text NOT NULL DEFAULT 'success',
  reason text,
  request_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  before jsonb,
  after jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_company_time_idx ON public.audit_log(company_id, created_at);
CREATE INDEX IF NOT EXISTS audit_log_object_idx ON public.audit_log(company_id, target_type, target_id);

-- Sequence Penomoran Dokumen Bisnis
CREATE TABLE IF NOT EXISTS public.document_sequence (
  company_id uuid NOT NULL REFERENCES public.company(id) ON DELETE RESTRICT,
  sequence_key text NOT NULL,
  current_number bigint NOT NULL DEFAULT 0,
  prefix text NOT NULL DEFAULT '',
  padding integer NOT NULL DEFAULT 5,
  document_kind text,
  period_key text,
  current_value integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, sequence_key),
  CONSTRAINT document_sequence_current_number_check CHECK (current_number >= 0)
);

-- ==============================================================================
-- 3. Tabel Konfigurasi & Bagan Akun (COA)
-- ==============================================================================

-- Satuan Ukuran (Unit Definition / UOM)
CREATE TABLE IF NOT EXISTS public.unit_definition (
  id uuid DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.company(id) ON DELETE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  decimal_scale integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, code),
  CONSTRAINT unit_definition_id_unique UNIQUE (id),
  CONSTRAINT unit_definition_scale_check CHECK (decimal_scale BETWEEN 0 AND 6)
);

CREATE OR REPLACE TRIGGER update_unit_definition_updated_at
  BEFORE UPDATE ON public.unit_definition
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Kategori Konfigurasi Bisnis
CREATE TABLE IF NOT EXISTS public.configuration_category (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.company(id) ON DELETE RESTRICT,
  category_kind text NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  defaults jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT configuration_category_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT configuration_category_company_kind_code_unique UNIQUE (company_id, category_kind, code),
  CONSTRAINT configuration_category_kind_check CHECK (category_kind IN ('expense', 'asset', 'material', 'production_overhead'))
);

CREATE OR REPLACE TRIGGER update_configuration_category_updated_at
  BEFORE UPDATE ON public.configuration_category
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Bagan Akun Buku Besar (COA - Ledger Accounts)
CREATE TABLE IF NOT EXISTS public.ledger_account (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.company(id) ON DELETE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  level1 text NOT NULL,
  level2 text NOT NULL DEFAULT '',
  level3 text NOT NULL DEFAULT '',
  account_type text NOT NULL,
  normal_balance text NOT NULL,
  report_sign text NOT NULL,
  monthly_calculation text NOT NULL,
  is_control boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ledger_account_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT ledger_account_company_code_unique UNIQUE (company_id, code),
  CONSTRAINT ledger_account_type_check CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  CONSTRAINT ledger_account_normal_balance_check CHECK (normal_balance IN ('debit', 'credit')),
  CONSTRAINT ledger_account_report_sign_check CHECK (report_sign IN ('positive', 'negative')),
  CONSTRAINT ledger_account_monthly_calculation_check CHECK (monthly_calculation IN ('accumulated', 'periodic')),
  CONSTRAINT ledger_account_level_type_check CHECK (
    (level1 = 'AKTIVA' AND account_type = 'asset') OR
    (level1 = 'KEWAJIBAN' AND account_type = 'liability') OR
    (level1 = 'MODAL' AND account_type = 'equity') OR
    (level1 IN ('PENDAPATAN', 'PENDAPATAN LAIN') AND account_type = 'revenue') OR
    (level1 IN ('HARGA POKOK PENJUALAN', 'BIAYA', 'BIAYA LAINNYA') AND account_type = 'expense')
  ),
  CONSTRAINT ledger_account_version_check CHECK (version > 0)
);

CREATE INDEX IF NOT EXISTS ledger_account_company_active_code_idx ON public.ledger_account(company_id, is_active, code);

CREATE OR REPLACE TRIGGER update_ledger_account_updated_at
  BEFORE UPDATE ON public.ledger_account
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Pemetaan Akun Sistem (Accounting Mapping)
CREATE TABLE IF NOT EXISTS public.accounting_mapping (
  company_id uuid NOT NULL REFERENCES public.company(id) ON DELETE RESTRICT,
  mapping_key text NOT NULL,
  account_id uuid NOT NULL REFERENCES public.ledger_account(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, mapping_key),
  CONSTRAINT accounting_mapping_company_account_fk FOREIGN KEY (company_id, account_id) REFERENCES public.ledger_account(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT accounting_mapping_version_check CHECK (version > 0)
);

CREATE INDEX IF NOT EXISTS accounting_mapping_account_idx ON public.accounting_mapping(account_id);

-- Pemetaan Akun Laporan Manajemen & Arus Kas (Report Account Mapping)
CREATE TABLE IF NOT EXISTS public.report_account_mapping (
  company_id uuid NOT NULL REFERENCES public.company(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES public.ledger_account(id) ON DELETE RESTRICT,
  management_post text NOT NULL,
  cash_flow_activity text,
  cash_flow_group text,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, account_id),
  CONSTRAINT report_account_mapping_company_account_fk FOREIGN KEY (company_id, account_id) REFERENCES public.ledger_account(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT report_account_mapping_management_post_check CHECK (management_post IN ('revenue', 'cogs', 'marketing_ads', 'operating_expense', 'payroll', 'other')),
  CONSTRAINT report_account_mapping_cash_flow_activity_check CHECK (cash_flow_activity IS NULL OR cash_flow_activity IN ('operating', 'investing', 'financing')),
  CONSTRAINT report_account_mapping_cash_flow_group_check CHECK (cash_flow_group IS NULL OR cash_flow_group IN ('customer_receipts', 'supplier_payments', 'payroll_and_operating_expenses', 'asset_purchases', 'asset_disposals', 'owner_contributions', 'owner_drawings', 'debt_financing', 'other')),
  CONSTRAINT report_account_mapping_version_check CHECK (version > 0)
);

CREATE INDEX IF NOT EXISTS report_account_mapping_company_post_idx ON public.report_account_mapping(company_id, management_post);

-- Periode Akuntansi
CREATE TABLE IF NOT EXISTS public.accounting_period (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.company(id) ON DELETE RESTRICT,
  period_month text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'open',
  state text NOT NULL DEFAULT 'open',
  opening_state text NOT NULL DEFAULT 'pending',
  close_summary jsonb,
  close_checksum text,
  closed_at timestamp with time zone,
  closed_by_user_id text,
  reopened_at timestamp with time zone,
  reopened_by_user_id text,
  reopen_reason text,
  version integer NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT accounting_period_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT accounting_period_company_month_unique UNIQUE (company_id, period_month),
  CONSTRAINT accounting_period_month_check CHECK (period_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT accounting_period_status_check CHECK (status IN ('open', 'closing', 'closed')),
  CONSTRAINT accounting_period_state_check CHECK (state IN ('open', 'closing', 'closed')),
  CONSTRAINT accounting_period_opening_state_check CHECK (opening_state IN ('pending', 'posted', 'zero_declared')),
  CONSTRAINT accounting_period_version_check CHECK (version > 0)
);

CREATE INDEX IF NOT EXISTS accounting_period_company_status_idx ON public.accounting_period(company_id, status);
CREATE INDEX IF NOT EXISTS accounting_period_company_state_idx ON public.accounting_period(company_id, state);

CREATE OR REPLACE TRIGGER update_accounting_period_updated_at
  BEFORE UPDATE ON public.accounting_period
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ==============================================================================
-- 4. Tabel Master & Dokumen Transaksi Polimorfik
-- ==============================================================================

-- Master Data Polimorfik (Customer, Supplier, Material, Product, BOM, Employee, Cash Account)
CREATE TABLE IF NOT EXISTS public.master_record (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.company(id) ON DELETE RESTRICT,
  record_kind text NOT NULL,
  code text,
  sku text,
  name text NOT NULL,
  ledger_account_id uuid REFERENCES public.ledger_account(id) ON DELETE RESTRICT,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_by_user_id text,
  updated_by_user_id text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT master_record_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT master_record_company_ledger_account_fk FOREIGN KEY (company_id, ledger_account_id) REFERENCES public.ledger_account(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT master_record_kind_check CHECK (record_kind IN ('customer', 'supplier', 'material', 'production_supply', 'product', 'bom', 'employee', 'cash_account')),
  CONSTRAINT master_record_identifier_scope_check CHECK (
    (record_kind = 'product' AND code IS NULL AND sku IS NOT NULL AND btrim(sku) = sku AND sku ~ '^[A-Z0-9_-]+$') OR
    (record_kind IN ('customer', 'supplier', 'material', 'bom', 'employee', 'cash_account') AND code IS NULL AND sku IS NULL) OR
    (record_kind = 'production_supply' AND code IS NOT NULL AND btrim(code) <> '' AND sku IS NULL)
  ),
  CONSTRAINT master_record_ledger_account_scope_check CHECK (
    (record_kind = 'cash_account' AND ledger_account_id IS NOT NULL) OR
    (record_kind <> 'cash_account' AND ledger_account_id IS NULL)
  ),
  CONSTRAINT master_record_normalized_name_check CHECK (
    record_kind NOT IN ('customer', 'supplier', 'material', 'employee') OR
    (btrim(name) = name AND name <> '')
  ),
  CONSTRAINT master_record_version_check CHECK (version > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS master_record_company_kind_code_unique
  ON public.master_record(company_id, record_kind, code)
  WHERE record_kind = 'production_supply' AND code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS master_record_company_product_sku_unique
  ON public.master_record(company_id, lower(btrim(sku)))
  WHERE record_kind = 'product';

CREATE UNIQUE INDEX IF NOT EXISTS master_record_company_kind_normalized_name_unique
  ON public.master_record(company_id, record_kind, lower(btrim(name)))
  WHERE record_kind IN ('customer', 'supplier', 'material');

CREATE UNIQUE INDEX IF NOT EXISTS master_record_bom_company_product_unique
  ON public.master_record(company_id, (data->>'productId'))
  WHERE record_kind = 'bom';

CREATE INDEX IF NOT EXISTS master_record_company_kind_name_idx ON public.master_record(company_id, record_kind, name);
CREATE INDEX IF NOT EXISTS master_record_company_ledger_account_idx ON public.master_record(company_id, ledger_account_id);

CREATE OR REPLACE TRIGGER update_master_record_updated_at
  BEFORE UPDATE ON public.master_record
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Dokumen Bisnis Transaksi Polimorfik
CREATE TABLE IF NOT EXISTS public.business_document (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.company(id) ON DELETE RESTRICT,
  document_kind text NOT NULL,
  document_number text,
  status text NOT NULL DEFAULT 'draft',
  transaction_date date NOT NULL,
  counterparty_id uuid REFERENCES public.master_record(id) ON DELETE RESTRICT,
  source_document_id uuid REFERENCES public.business_document(id) ON DELETE RESTRICT,
  replacement_for_id uuid REFERENCES public.business_document(id) ON DELETE RESTRICT,
  total_amount bigint NOT NULL DEFAULT 0,
  paid_amount bigint NOT NULL DEFAULT 0,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text,
  version integer NOT NULL DEFAULT 1,
  posted_at timestamp with time zone,
  posted_by_user_id text,
  voided_at timestamp with time zone,
  voided_by_user_id text,
  void_reason text,
  created_by_user_id text,
  updated_by_user_id text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT business_document_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT business_document_company_counterparty_fk FOREIGN KEY (company_id, counterparty_id) REFERENCES public.master_record(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT business_document_company_source_fk FOREIGN KEY (company_id, source_document_id) REFERENCES public.business_document(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT business_document_company_replacement_fk FOREIGN KEY (company_id, replacement_for_id) REFERENCES public.business_document(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT business_document_status_check CHECK (status IN ('draft', 'posted', 'void')),
  CONSTRAINT business_document_amount_check CHECK (total_amount >= 0 AND paid_amount >= 0 AND paid_amount <= total_amount),
  CONSTRAINT business_document_version_check CHECK (version > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS business_document_company_number_unique
  ON public.business_document(company_id, document_number)
  WHERE document_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS business_document_company_idempotency_unique
  ON public.business_document(company_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS business_document_company_kind_date_idx ON public.business_document(company_id, document_kind, transaction_date);
CREATE INDEX IF NOT EXISTS business_document_source_idx ON public.business_document(company_id, source_document_id);

CREATE OR REPLACE TRIGGER update_business_document_updated_at
  BEFORE UPDATE ON public.business_document
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Baris Detail Dokumen Bisnis
CREATE TABLE IF NOT EXISTS public.business_document_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.company(id) ON DELETE RESTRICT,
  document_id uuid NOT NULL REFERENCES public.business_document(id) ON DELETE CASCADE,
  line_number integer NOT NULL,
  item_id uuid REFERENCES public.master_record(id) ON DELETE RESTRICT,
  account_id uuid REFERENCES public.ledger_account(id) ON DELETE RESTRICT,
  description text NOT NULL DEFAULT '',
  unit_code text,
  conversion_factor numeric(20, 6) NOT NULL DEFAULT 1,
  quantity numeric(18, 4) NOT NULL DEFAULT 0,
  unit_price bigint NOT NULL DEFAULT 0,
  subtotal bigint NOT NULL DEFAULT 0,
  total_amount bigint NOT NULL DEFAULT 0,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision integer NOT NULL DEFAULT 1,
  is_current boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT business_document_line_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT business_document_line_company_document_fk FOREIGN KEY (company_id, document_id) REFERENCES public.business_document(company_id, id) ON DELETE CASCADE,
  CONSTRAINT business_document_line_company_item_fk FOREIGN KEY (company_id, item_id) REFERENCES public.master_record(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT business_document_line_company_account_fk FOREIGN KEY (company_id, account_id) REFERENCES public.ledger_account(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT business_document_line_value_check CHECK (quantity >= 0 AND conversion_factor > 0 AND unit_price >= 0 AND total_amount >= 0),
  CONSTRAINT business_document_line_revision_check CHECK (revision > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS business_document_line_current_number_unique
  ON public.business_document_line(document_id, line_number)
  WHERE is_current = true;

CREATE INDEX IF NOT EXISTS business_document_line_company_item_idx ON public.business_document_line(company_id, item_id);
CREATE INDEX IF NOT EXISTS business_document_line_company_account_idx ON public.business_document_line(company_id, account_id);

-- ==============================================================================
-- 5. Tabel Operasional Produksi
-- ==============================================================================

-- Profil Operator Produksi
CREATE TABLE IF NOT EXISTS public.production_operator_profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.company(id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL REFERENCES public.master_record(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  operator_role text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT production_operator_profile_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT production_operator_profile_company_employee_role_unique UNIQUE (company_id, employee_id, operator_role),
  CONSTRAINT production_operator_profile_company_user_role_unique UNIQUE (company_id, user_id, operator_role),
  CONSTRAINT production_operator_profile_company_employee_fk FOREIGN KEY (company_id, employee_id) REFERENCES public.master_record(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT production_operator_profile_company_user_fk FOREIGN KEY (company_id, user_id) REFERENCES public.user_company_assignment(company_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT production_operator_profile_role_check CHECK (operator_role IN ('operator_potong', 'operator_sablon', 'operator_jahit', 'operator_packing'))
);

CREATE OR REPLACE TRIGGER update_production_operator_profile_updated_at
  BEFORE UPDATE ON public.production_operator_profile
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Perintah Kerja Produksi (Work Order SPK)
CREATE TABLE IF NOT EXISTS public.production_work_order (
  document_id uuid PRIMARY KEY REFERENCES public.business_document(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.company(id) ON DELETE RESTRICT,
  production_order_id uuid NOT NULL REFERENCES public.business_document(id) ON DELETE RESTRICT,
  stage text NOT NULL,
  operator_profile_id uuid NOT NULL REFERENCES public.production_operator_profile(id) ON DELETE RESTRICT,
  business_status text NOT NULL DEFAULT 'draft',
  cancellation_reason text,
  assigned_at timestamp with time zone,
  assigned_by_user_id text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT production_work_order_company_document_unique UNIQUE (company_id, document_id),
  CONSTRAINT production_work_order_company_document_fk FOREIGN KEY (company_id, document_id) REFERENCES public.business_document(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT production_work_order_company_parent_fk FOREIGN KEY (company_id, production_order_id) REFERENCES public.business_document(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT production_work_order_stage_check CHECK (stage IN ('cutting', 'printing', 'sewing', 'packing', 'repair')),
  CONSTRAINT production_work_order_status_check CHECK (business_status IN ('draft', 'assigned', 'in_progress', 'completed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS production_work_order_company_parent_stage_idx ON public.production_work_order(company_id, production_order_id, stage);

CREATE OR REPLACE TRIGGER update_production_work_order_updated_at
  BEFORE UPDATE ON public.production_work_order
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Routing Produk Produksi (Printing Routing Check)
CREATE TABLE IF NOT EXISTS public.production_product_routing (
  company_id uuid NOT NULL REFERENCES public.company(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES public.master_record(id) ON DELETE RESTRICT,
  requires_printing boolean NOT NULL,
  configured_at timestamp with time zone NOT NULL DEFAULT now(),
  configured_by_user_id text,
  PRIMARY KEY (company_id, product_id),
  CONSTRAINT production_product_routing_company_product_fk FOREIGN KEY (company_id, product_id) REFERENCES public.master_record(company_id, id) ON DELETE RESTRICT
);

-- Unit Fisik Material / Roll Kain
CREATE TABLE IF NOT EXISTS public.production_material_unit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.company(id) ON DELETE RESTRICT,
  material_id uuid NOT NULL REFERENCES public.master_record(id) ON DELETE RESTRICT,
  source_document_id uuid NOT NULL REFERENCES public.business_document(id) ON DELETE RESTRICT,
  source_line_id uuid NOT NULL REFERENCES public.business_document_line(id) ON DELETE RESTRICT,
  receipt_cycle integer NOT NULL,
  physical_code text NOT NULL,
  packaging_unit_code text NOT NULL,
  stock_unit_code text NOT NULL,
  initial_base_quantity numeric(20, 6) NOT NULL,
  status text NOT NULL DEFAULT 'available',
  consumed_by_document_id uuid REFERENCES public.business_document(id) ON DELETE RESTRICT,
  consumed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT production_material_unit_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT production_material_unit_company_code_unique UNIQUE (company_id, physical_code),
  CONSTRAINT production_material_unit_company_material_fk FOREIGN KEY (company_id, material_id) REFERENCES public.master_record(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT production_material_unit_company_source_document_fk FOREIGN KEY (company_id, source_document_id) REFERENCES public.business_document(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT production_material_unit_company_source_line_fk FOREIGN KEY (company_id, source_line_id) REFERENCES public.business_document_line(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT production_material_unit_company_consumed_document_fk FOREIGN KEY (company_id, consumed_by_document_id) REFERENCES public.business_document(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT production_material_unit_quantity_check CHECK (initial_base_quantity > 0),
  CONSTRAINT production_material_unit_receipt_cycle_check CHECK (receipt_cycle > 0),
  CONSTRAINT production_material_unit_status_check CHECK (
    (status = 'available' AND consumed_by_document_id IS NULL AND consumed_at IS NULL) OR
    (status = 'consumed' AND consumed_by_document_id IS NOT NULL AND consumed_at IS NOT NULL) OR
    (status = 'reversed' AND consumed_by_document_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS production_material_unit_available_idx ON public.production_material_unit(company_id, material_id, status);

-- Lot Pemotongan Kain (Cutting Lot)
CREATE TABLE IF NOT EXISTS public.production_cutting_lot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.company(id) ON DELETE RESTRICT,
  production_order_id uuid NOT NULL REFERENCES public.business_document(id) ON DELETE RESTRICT,
  cutting_work_order_id uuid NOT NULL REFERENCES public.production_work_order(document_id) ON DELETE RESTRICT,
  source_actual_document_id uuid REFERENCES public.business_document(id) ON DELETE RESTRICT,
  physical_material_unit_id uuid REFERENCES public.production_material_unit(id) ON DELETE RESTRICT,
  lot_code text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT production_cutting_lot_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT production_cutting_lot_company_code_unique UNIQUE (company_id, lot_code),
  CONSTRAINT production_cutting_lot_company_order_fk FOREIGN KEY (company_id, production_order_id) REFERENCES public.business_document(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT production_cutting_lot_company_actual_document_fk FOREIGN KEY (company_id, source_actual_document_id) REFERENCES public.business_document(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT production_cutting_lot_company_physical_unit_fk FOREIGN KEY (company_id, physical_material_unit_id) REFERENCES public.production_material_unit(company_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS production_cutting_lot_company_physical_unit_unique
  ON public.production_cutting_lot(company_id, physical_material_unit_id)
  WHERE physical_material_unit_id IS NOT NULL;

-- Ikatan Komponen / Bundle Produksi
CREATE TABLE IF NOT EXISTS public.production_bundle (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.company(id) ON DELETE RESTRICT,
  production_order_id uuid NOT NULL REFERENCES public.business_document(id) ON DELETE RESTRICT,
  cutting_lot_id uuid NOT NULL REFERENCES public.production_cutting_lot(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES public.master_record(id) ON DELETE RESTRICT,
  bundle_code text NOT NULL,
  initial_quantity numeric(20, 6) NOT NULL,
  active_quantity numeric(20, 6) NOT NULL,
  final_rejected_quantity numeric(20, 6) NOT NULL DEFAULT 0,
  stage text NOT NULL DEFAULT 'cutting',
  work_condition text NOT NULL DEFAULT 'available',
  last_actual_work_order_id uuid REFERENCES public.production_work_order(document_id) ON DELETE RESTRICT,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT production_bundle_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT production_bundle_company_code_unique UNIQUE (company_id, bundle_code),
  CONSTRAINT production_bundle_company_order_fk FOREIGN KEY (company_id, production_order_id) REFERENCES public.business_document(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT production_bundle_company_lot_fk FOREIGN KEY (company_id, cutting_lot_id) REFERENCES public.production_cutting_lot(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT production_bundle_company_product_fk FOREIGN KEY (company_id, product_id) REFERENCES public.master_record(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT production_bundle_company_last_actual_work_order_fk FOREIGN KEY (company_id, last_actual_work_order_id) REFERENCES public.production_work_order(company_id, document_id) ON DELETE RESTRICT,
  CONSTRAINT production_bundle_quantity_check CHECK (
    initial_quantity > 0 AND active_quantity >= 0 AND final_rejected_quantity >= 0 AND
    active_quantity + final_rejected_quantity <= initial_quantity AND
    initial_quantity = trunc(initial_quantity) AND
    active_quantity = trunc(active_quantity) AND
    final_rejected_quantity = trunc(final_rejected_quantity)
  ),
  CONSTRAINT production_bundle_stage_check CHECK (stage IN ('cutting', 'printing', 'sewing', 'packing', 'completed')),
  CONSTRAINT production_bundle_condition_check CHECK (work_condition IN ('available', 'assigned', 'in_progress', 'repair_hold', 'completed'))
);

CREATE OR REPLACE TRIGGER update_production_bundle_updated_at
  BEFORE UPDATE ON public.production_bundle
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Reservasi Ikatan Komponen untuk SPK
CREATE TABLE IF NOT EXISTS public.production_bundle_reservation (
  bundle_id uuid PRIMARY KEY REFERENCES public.production_bundle(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.company(id) ON DELETE RESTRICT,
  work_order_id uuid NOT NULL REFERENCES public.production_work_order(document_id) ON DELETE RESTRICT,
  reserved_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT production_bundle_reservation_company_bundle_fk FOREIGN KEY (company_id, bundle_id) REFERENCES public.production_bundle(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT production_bundle_reservation_company_order_fk FOREIGN KEY (company_id, work_order_id) REFERENCES public.production_work_order(company_id, document_id) ON DELETE RESTRICT
);

-- Relasi SPK dan Ikatan Komponen
CREATE TABLE IF NOT EXISTS public.production_work_order_bundle (
  work_order_id uuid NOT NULL REFERENCES public.production_work_order(document_id) ON DELETE RESTRICT,
  bundle_id uuid NOT NULL REFERENCES public.production_bundle(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.company(id) ON DELETE RESTRICT,
  PRIMARY KEY (work_order_id, bundle_id),
  CONSTRAINT production_work_order_bundle_company_order_fk FOREIGN KEY (company_id, work_order_id) REFERENCES public.production_work_order(company_id, document_id) ON DELETE RESTRICT,
  CONSTRAINT production_work_order_bundle_company_bundle_fk FOREIGN KEY (company_id, bundle_id) REFERENCES public.production_bundle(company_id, id) ON DELETE RESTRICT
);

-- Operator Sablon per Order & Produk
CREATE TABLE IF NOT EXISTS public.production_printing_operator (
  company_id uuid NOT NULL REFERENCES public.company(id) ON DELETE RESTRICT,
  production_order_id uuid NOT NULL REFERENCES public.business_document(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES public.master_record(id) ON DELETE RESTRICT,
  operator_profile_id uuid NOT NULL REFERENCES public.production_operator_profile(id) ON DELETE RESTRICT,
  PRIMARY KEY (company_id, production_order_id, product_id),
  CONSTRAINT production_printing_operator_company_order_fk FOREIGN KEY (company_id, production_order_id) REFERENCES public.business_document(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT production_printing_operator_company_product_fk FOREIGN KEY (company_id, product_id) REFERENCES public.master_record(company_id, id) ON DELETE RESTRICT
);

-- Kasus Perbaikan / Rework / Repair
CREATE TABLE IF NOT EXISTS public.production_repair_case (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.company(id) ON DELETE RESTRICT,
  production_order_id uuid NOT NULL REFERENCES public.business_document(id) ON DELETE RESTRICT,
  source_work_order_id uuid NOT NULL REFERENCES public.production_work_order(document_id) ON DELETE RESTRICT,
  bundle_id uuid NOT NULL REFERENCES public.production_bundle(id) ON DELETE RESTRICT,
  found_at_stage text NOT NULL,
  repair_work_kind text NOT NULL,
  quantity numeric(20, 6) NOT NULL,
  issue_reason text NOT NULL,
  compensation_mode text,
  rate_snapshot bigint,
  repair_work_order_id uuid REFERENCES public.production_work_order(document_id) ON DELETE RESTRICT,
  business_status text NOT NULL DEFAULT 'pending_assignment',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT production_repair_case_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT production_repair_case_company_order_fk FOREIGN KEY (company_id, production_order_id) REFERENCES public.business_document(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT production_repair_case_company_source_fk FOREIGN KEY (company_id, source_work_order_id) REFERENCES public.production_work_order(company_id, document_id) ON DELETE RESTRICT,
  CONSTRAINT production_repair_case_company_bundle_fk FOREIGN KEY (company_id, bundle_id) REFERENCES public.production_bundle(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT production_repair_case_stage_check CHECK (found_at_stage IN ('cutting', 'printing', 'sewing', 'packing') AND repair_work_kind IN ('cutting', 'printing', 'sewing', 'packing')),
  CONSTRAINT production_repair_case_quantity_check CHECK (quantity > 0 AND quantity = trunc(quantity) AND (rate_snapshot IS NULL OR rate_snapshot >= 0)),
  CONSTRAINT production_repair_case_compensation_check CHECK (compensation_mode IS NULL OR compensation_mode IN ('unpaid', 'reference_rate', 'special_rate')),
  CONSTRAINT production_repair_case_status_check CHECK (business_status IN ('pending_assignment', 'assigned', 'in_progress', 'completed', 'cancelled')),
  CONSTRAINT production_repair_case_assignment_snapshot_check CHECK (
    (business_status = 'pending_assignment' AND compensation_mode IS NULL AND rate_snapshot IS NULL) OR
    (business_status <> 'pending_assignment' AND compensation_mode IS NOT NULL AND rate_snapshot IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS production_repair_case_company_status_idx ON public.production_repair_case(company_id, business_status);

CREATE OR REPLACE TRIGGER update_production_repair_case_updated_at
  BEFORE UPDATE ON public.production_repair_case
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Hasil Pengerjaan Tahap Ikatan Produksi
CREATE TABLE IF NOT EXISTS public.production_bundle_stage_result (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.company(id) ON DELETE RESTRICT,
  production_order_id uuid NOT NULL REFERENCES public.business_document(id) ON DELETE RESTRICT,
  work_order_id uuid NOT NULL REFERENCES public.production_work_order(document_id) ON DELETE RESTRICT,
  actual_document_id uuid NOT NULL REFERENCES public.business_document(id) ON DELETE RESTRICT,
  bundle_id uuid NOT NULL REFERENCES public.production_bundle(id) ON DELETE RESTRICT,
  stage text NOT NULL,
  worked_quantity numeric(20, 6) NOT NULL,
  success_quantity numeric(20, 6) NOT NULL,
  repair_quantity numeric(20, 6) NOT NULL,
  final_rejected_quantity numeric(20, 6) NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT production_bundle_stage_result_company_bundle_stage_unique UNIQUE (company_id, bundle_id, stage),
  CONSTRAINT production_bundle_stage_result_company_actual_unique UNIQUE (company_id, actual_document_id),
  CONSTRAINT production_bundle_stage_result_company_order_fk FOREIGN KEY (company_id, production_order_id) REFERENCES public.business_document(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT production_bundle_stage_result_company_work_order_fk FOREIGN KEY (company_id, work_order_id) REFERENCES public.production_work_order(company_id, document_id) ON DELETE RESTRICT,
  CONSTRAINT production_bundle_stage_result_company_actual_fk FOREIGN KEY (company_id, actual_document_id) REFERENCES public.business_document(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT production_bundle_stage_result_company_bundle_fk FOREIGN KEY (company_id, bundle_id) REFERENCES public.production_bundle(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT production_bundle_stage_result_stage_check CHECK (stage IN ('printing', 'sewing', 'packing')),
  CONSTRAINT production_bundle_stage_result_quantity_check CHECK (
    worked_quantity > 0 AND success_quantity >= 0 AND repair_quantity >= 0 AND final_rejected_quantity >= 0 AND
    worked_quantity = success_quantity + repair_quantity + final_rejected_quantity AND
    worked_quantity = trunc(worked_quantity) AND
    success_quantity = trunc(success_quantity) AND
    repair_quantity = trunc(repair_quantity) AND
    final_rejected_quantity = trunc(final_rejected_quantity)
  )
);

-- ==============================================================================
-- 6. Tabel Buku Besar & Keuangan (Ledgers & Subledgers)
-- ==============================================================================

-- Mutasi Persediaan Perpetual (Inventory Movement)
CREATE TABLE IF NOT EXISTS public.inventory_movement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.company(id) ON DELETE RESTRICT,
  item_id uuid NOT NULL REFERENCES public.master_record(id) ON DELETE RESTRICT,
  inventory_state text NOT NULL DEFAULT 'material',
  movement_type text,
  lot_code text,
  quantity numeric(18, 4) NOT NULL,
  unit_cost bigint NOT NULL DEFAULT 0,
  total_cost bigint NOT NULL DEFAULT 0,
  transaction_date date NOT NULL DEFAULT current_date,
  business_date date NOT NULL DEFAULT current_date,
  source_document_id uuid REFERENCES public.business_document(id) ON DELETE RESTRICT,
  reference_document_id uuid REFERENCES public.business_document(id) ON DELETE RESTRICT,
  source_line_id uuid REFERENCES public.business_document_line(id) ON DELETE RESTRICT,
  reversal_of_id uuid REFERENCES public.inventory_movement(id) ON DELETE RESTRICT,
  receipt_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  posted_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT inventory_movement_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT inventory_movement_company_item_fk FOREIGN KEY (company_id, item_id) REFERENCES public.master_record(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT inventory_movement_company_document_fk FOREIGN KEY (company_id, source_document_id) REFERENCES public.business_document(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT inventory_movement_company_line_fk FOREIGN KEY (company_id, source_line_id) REFERENCES public.business_document_line(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT inventory_movement_state_check CHECK (inventory_state IN ('material', 'production_supplies', 'cut_components', 'printed_components', 'sewn_wip', 'packed_finished_goods', 'waste'))
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_movement_reversal_unique
  ON public.inventory_movement(reversal_of_id)
  WHERE reversal_of_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS inventory_movement_balance_idx ON public.inventory_movement(company_id, item_id, inventory_state, posted_at);
CREATE INDEX IF NOT EXISTS inventory_movement_source_idx ON public.inventory_movement(source_document_id);
CREATE INDEX IF NOT EXISTS inventory_movement_company_business_date_idx ON public.inventory_movement(company_id, business_date);

-- Entri Jurnal Umum (General Journal Entry)
CREATE TABLE IF NOT EXISTS public.journal_entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.company(id) ON DELETE RESTRICT,
  entry_number text NOT NULL,
  period_id uuid REFERENCES public.accounting_period(id) ON DELETE RESTRICT,
  source_document_id uuid REFERENCES public.business_document(id) ON DELETE RESTRICT,
  reference_document_id uuid REFERENCES public.business_document(id) ON DELETE RESTRICT,
  transaction_date date NOT NULL,
  entry_type text NOT NULL DEFAULT 'general',
  memo text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'posted',
  is_closing_entry boolean NOT NULL DEFAULT false,
  reversal_of_id uuid REFERENCES public.journal_entry(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1,
  posted_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT journal_entry_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT journal_entry_company_period_fk FOREIGN KEY (company_id, period_id) REFERENCES public.accounting_period(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT journal_entry_company_document_fk FOREIGN KEY (company_id, source_document_id) REFERENCES public.business_document(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT journal_entry_version_check CHECK (version > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS journal_entry_reversal_unique
  ON public.journal_entry(reversal_of_id)
  WHERE reversal_of_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS journal_entry_source_idx ON public.journal_entry(source_document_id);
CREATE INDEX IF NOT EXISTS journal_entry_company_period_idx ON public.journal_entry(company_id, period_id, transaction_date);

-- Baris Detail Jurnal (Debit & Kredit Seimbang)
CREATE TABLE IF NOT EXISTS public.journal_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.company(id) ON DELETE RESTRICT,
  journal_entry_id uuid NOT NULL REFERENCES public.journal_entry(id) ON DELETE CASCADE,
  line_number integer NOT NULL,
  account_id uuid NOT NULL REFERENCES public.ledger_account(id) ON DELETE RESTRICT,
  debit_amount bigint NOT NULL DEFAULT 0,
  credit_amount bigint NOT NULL DEFAULT 0,
  debit bigint NOT NULL DEFAULT 0,
  credit bigint NOT NULL DEFAULT 0,
  description text,
  subledger_type text,
  subledger_id uuid,
  CONSTRAINT journal_line_number_unique UNIQUE (journal_entry_id, line_number),
  CONSTRAINT journal_line_company_entry_fk FOREIGN KEY (company_id, journal_entry_id) REFERENCES public.journal_entry(company_id, id) ON DELETE CASCADE,
  CONSTRAINT journal_line_company_account_fk FOREIGN KEY (company_id, account_id) REFERENCES public.ledger_account(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT journal_line_one_side_check CHECK (
    (debit_amount >= 0 AND credit_amount >= 0 AND ((debit_amount > 0 AND credit_amount = 0) OR (credit_amount > 0 AND debit_amount = 0))) OR
    (debit >= 0 AND credit >= 0 AND ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)))
  )
);

CREATE INDEX IF NOT EXISTS journal_line_company_account_idx ON public.journal_line(company_id, account_id);

-- Entri Buku Pembantu (Subledger: Hutang/Piutang)
CREATE TABLE IF NOT EXISTS public.subledger_entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.company(id) ON DELETE RESTRICT,
  subledger_kind text NOT NULL DEFAULT 'supplier_payable',
  subledger_type text NOT NULL DEFAULT 'supplier_payable',
  counterparty_id uuid REFERENCES public.master_record(id) ON DELETE RESTRICT,
  reference_id uuid,
  document_id uuid REFERENCES public.business_document(id) ON DELETE RESTRICT,
  source_document_id uuid REFERENCES public.business_document(id) ON DELETE RESTRICT,
  transaction_date date NOT NULL DEFAULT current_date,
  amount bigint NOT NULL DEFAULT 0,
  debit_amount bigint NOT NULL DEFAULT 0,
  credit_amount bigint NOT NULL DEFAULT 0,
  remaining_balance bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open',
  reversal_of_id uuid REFERENCES public.subledger_entry(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1,
  posted_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT subledger_entry_company_document_fk FOREIGN KEY (company_id, source_document_id) REFERENCES public.business_document(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT subledger_entry_company_counterparty_fk FOREIGN KEY (company_id, counterparty_id) REFERENCES public.master_record(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT subledger_entry_kind_check CHECK (subledger_kind IN ('receivable', 'supplier_payable', 'wage_payable', 'asset_candidate')),
  CONSTRAINT subledger_entry_version_check CHECK (version > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS subledger_entry_reversal_unique
  ON public.subledger_entry(reversal_of_id)
  WHERE reversal_of_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS subledger_entry_balance_idx ON public.subledger_entry(company_id, subledger_kind, reference_id, posted_at);

-- Mutasi Kas & Rekening Bank
CREATE TABLE IF NOT EXISTS public.cash_movement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.company(id) ON DELETE RESTRICT,
  cash_account_id uuid NOT NULL REFERENCES public.master_record(id) ON DELETE RESTRICT,
  movement_type text NOT NULL DEFAULT 'receipt',
  transaction_date date NOT NULL DEFAULT current_date,
  amount bigint NOT NULL,
  source_document_id uuid REFERENCES public.business_document(id) ON DELETE RESTRICT,
  reference_document_id uuid REFERENCES public.business_document(id) ON DELETE RESTRICT,
  paired_movement_id uuid REFERENCES public.cash_movement(id) ON DELETE RESTRICT,
  reversal_of_id uuid REFERENCES public.cash_movement(id) ON DELETE RESTRICT,
  notes text,
  posted_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT cash_movement_company_account_fk FOREIGN KEY (company_id, cash_account_id) REFERENCES public.master_record(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT cash_movement_company_document_fk FOREIGN KEY (company_id, source_document_id) REFERENCES public.business_document(company_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS cash_movement_reversal_unique
  ON public.cash_movement(reversal_of_id)
  WHERE reversal_of_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS cash_movement_balance_idx ON public.cash_movement(company_id, cash_account_id, posted_at);

-- Biaya Dibayar Dimuka (Prepaid Expense)
CREATE TABLE IF NOT EXISTS public.prepaid_expense (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.company(id) ON DELETE RESTRICT,
  description text NOT NULL,
  prepaid_account_id uuid NOT NULL REFERENCES public.ledger_account(id) ON DELETE RESTRICT,
  expense_account_id uuid NOT NULL REFERENCES public.ledger_account(id) ON DELETE RESTRICT,
  start_date date NOT NULL,
  end_date date NOT NULL,
  number_of_months integer NOT NULL,
  original_amount bigint NOT NULL,
  amortized_amount bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  version integer NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT prepaid_expense_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT prepaid_expense_company_prepaid_account_fk FOREIGN KEY (company_id, prepaid_account_id) REFERENCES public.ledger_account(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT prepaid_expense_company_expense_account_fk FOREIGN KEY (company_id, expense_account_id) REFERENCES public.ledger_account(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT prepaid_expense_amount_check CHECK (original_amount > 0 AND amortized_amount >= 0 AND amortized_amount <= original_amount),
  CONSTRAINT prepaid_expense_months_check CHECK (number_of_months > 0),
  CONSTRAINT prepaid_expense_status_check CHECK (status IN ('active', 'completed', 'cancelled')),
  CONSTRAINT prepaid_expense_version_check CHECK (version > 0)
);

CREATE INDEX IF NOT EXISTS prepaid_expense_company_status_idx ON public.prepaid_expense(company_id, status);

CREATE OR REPLACE TRIGGER update_prepaid_expense_updated_at
  BEFORE UPDATE ON public.prepaid_expense
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Entri Amortisasi Biaya Dibayar Dimuka Bulanan
CREATE TABLE IF NOT EXISTS public.prepaid_amortization_entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.company(id) ON DELETE RESTRICT,
  prepaid_expense_id uuid NOT NULL REFERENCES public.prepaid_expense(id) ON DELETE RESTRICT,
  period_month text NOT NULL,
  amount bigint NOT NULL,
  source_document_id uuid NOT NULL REFERENCES public.business_document(id) ON DELETE RESTRICT,
  posted_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT prepaid_amortization_schedule_period_unique UNIQUE (prepaid_expense_id, period_month),
  CONSTRAINT prepaid_amortization_company_schedule_fk FOREIGN KEY (company_id, prepaid_expense_id) REFERENCES public.prepaid_expense(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT prepaid_amortization_company_document_fk FOREIGN KEY (company_id, source_document_id) REFERENCES public.business_document(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT prepaid_amortization_amount_check CHECK (amount > 0),
  CONSTRAINT prepaid_amortization_period_check CHECK (period_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);

CREATE INDEX IF NOT EXISTS prepaid_amortization_company_period_idx ON public.prepaid_amortization_entry(company_id, period_month);

-- Kewajiban Upah Operator (Wage Liability)
CREATE TABLE IF NOT EXISTS public.wage_liability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.company(id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL REFERENCES public.master_record(id) ON DELETE RESTRICT,
  service_kind text NOT NULL,
  quantity numeric(20, 6) NOT NULL,
  rate bigint NOT NULL,
  gross_amount bigint NOT NULL,
  paid_amount bigint NOT NULL DEFAULT 0,
  item_id uuid REFERENCES public.master_record(id) ON DELETE RESTRICT,
  source_line_id uuid REFERENCES public.business_document_line(id) ON DELETE RESTRICT,
  source_document_id uuid NOT NULL REFERENCES public.business_document(id) ON DELETE RESTRICT,
  reversal_of_id uuid REFERENCES public.wage_liability(id) ON DELETE RESTRICT,
  posted_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT wage_liability_company_employee_fk FOREIGN KEY (company_id, employee_id) REFERENCES public.master_record(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT wage_liability_company_document_fk FOREIGN KEY (company_id, source_document_id) REFERENCES public.business_document(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT wage_liability_company_item_fk FOREIGN KEY (company_id, item_id) REFERENCES public.master_record(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT wage_liability_company_line_fk FOREIGN KEY (company_id, source_line_id) REFERENCES public.business_document_line(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT wage_liability_amount_check CHECK (
    (reversal_of_id IS NULL AND quantity >= 0 AND rate >= 0 AND gross_amount >= 0 AND paid_amount >= 0 AND paid_amount <= gross_amount) OR
    (reversal_of_id IS NOT NULL AND quantity <= 0 AND rate >= 0 AND gross_amount <= 0 AND paid_amount = 0)
  ),
  CONSTRAINT wage_liability_service_check CHECK (service_kind IN ('cutting', 'printing', 'sewing', 'packing', 'head_fee'))
);

CREATE INDEX IF NOT EXISTS wage_liability_outstanding_idx ON public.wage_liability(company_id, employee_id, posted_at);

-- Tarif Upah Pekerjaan Borongan (Wage Rate)
CREATE TABLE IF NOT EXISTS public.wage_rate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.company(id) ON DELETE RESTRICT,
  code text NOT NULL,
  product_id uuid NOT NULL REFERENCES public.master_record(id) ON DELETE RESTRICT,
  service_kind text NOT NULL,
  rate bigint NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_by_user_id text,
  updated_by_user_id text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT wage_rate_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT wage_rate_company_code_unique UNIQUE (company_id, code),
  CONSTRAINT wage_rate_company_product_service_unique UNIQUE (company_id, product_id, service_kind),
  CONSTRAINT wage_rate_company_product_fk FOREIGN KEY (company_id, product_id) REFERENCES public.master_record(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT wage_rate_value_check CHECK (rate >= 0),
  CONSTRAINT wage_rate_version_check CHECK (version > 0),
  CONSTRAINT wage_rate_service_check CHECK (service_kind IN ('cutting', 'printing', 'sewing', 'packing', 'head_fee'))
);

CREATE INDEX IF NOT EXISTS wage_rate_company_product_idx ON public.wage_rate(company_id, product_id);

CREATE OR REPLACE TRIGGER update_wage_rate_updated_at
  BEFORE UPDATE ON public.wage_rate
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Pengecualian Stok Negatif (Negative Stock Exception)
CREATE TABLE IF NOT EXISTS public.negative_stock_exception (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.company(id) ON DELETE RESTRICT,
  item_id uuid NOT NULL REFERENCES public.master_record(id) ON DELETE RESTRICT,
  inventory_state text NOT NULL,
  shortage_quantity numeric(20, 6) NOT NULL,
  source_document_id uuid NOT NULL REFERENCES public.business_document(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'open',
  resolved_by_document_id uuid REFERENCES public.business_document(id) ON DELETE RESTRICT,
  createdAt timestamp with time zone NOT NULL DEFAULT now(),
  resolvedAt timestamp with time zone,
  CONSTRAINT negative_stock_exception_company_item_fk FOREIGN KEY (company_id, item_id) REFERENCES public.master_record(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT negative_stock_exception_company_document_fk FOREIGN KEY (company_id, source_document_id) REFERENCES public.business_document(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT negative_stock_exception_status_check CHECK (status IN ('open', 'resolved')),
  CONSTRAINT negative_stock_exception_quantity_check CHECK (shortage_quantity > 0)
);

CREATE INDEX IF NOT EXISTS negative_stock_exception_open_idx ON public.negative_stock_exception(company_id, status, item_id);

-- Register Aset Tetap (Asset Record)
CREATE TABLE IF NOT EXISTS public.asset_record (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.company(id) ON DELETE RESTRICT,
  asset_code text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'candidate',
  category_id uuid REFERENCES public.configuration_category(id) ON DELETE RESTRICT,
  source_document_id uuid NOT NULL REFERENCES public.business_document(id) ON DELETE RESTRICT,
  source_purchase_line_id uuid REFERENCES public.business_document_line(id) ON DELETE RESTRICT,
  acquisition_cost bigint NOT NULL,
  residual_value bigint NOT NULL DEFAULT 0,
  depreciation_method text,
  useful_life_months integer,
  capitalization_date date,
  depreciation_start_date date,
  accumulated_depreciation bigint NOT NULL DEFAULT 0,
  location text,
  custodian text,
  serial_number text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT asset_record_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT asset_record_company_code_unique UNIQUE (company_id, asset_code),
  CONSTRAINT asset_record_company_category_fk FOREIGN KEY (company_id, category_id) REFERENCES public.configuration_category(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT asset_record_company_document_fk FOREIGN KEY (company_id, source_document_id) REFERENCES public.business_document(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT asset_record_company_purchase_line_fk FOREIGN KEY (company_id, source_purchase_line_id) REFERENCES public.business_document_line(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT asset_record_status_check CHECK (status IN ('candidate', 'active', 'disposed', 'cancelled')),
  CONSTRAINT asset_record_depreciation_method_check CHECK (depreciation_method IS NULL OR depreciation_method IN ('straight_line', 'declining_balance')),
  CONSTRAINT asset_record_value_check CHECK (
    acquisition_cost >= 0 AND residual_value >= 0 AND residual_value <= acquisition_cost AND
    accumulated_depreciation >= 0 AND accumulated_depreciation <= acquisition_cost - residual_value
  )
);

CREATE INDEX IF NOT EXISTS asset_record_company_status_idx ON public.asset_record(company_id, status);

CREATE OR REPLACE TRIGGER update_asset_record_updated_at
  BEFORE UPDATE ON public.asset_record
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Entri Depresiasi Bulanan Aset Tetap
CREATE TABLE IF NOT EXISTS public.depreciation_entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.company(id) ON DELETE RESTRICT,
  asset_id uuid NOT NULL REFERENCES public.asset_record(id) ON DELETE RESTRICT,
  period_month text NOT NULL,
  amount bigint NOT NULL,
  source_document_id uuid NOT NULL REFERENCES public.business_document(id) ON DELETE RESTRICT,
  reversal_of_id uuid REFERENCES public.depreciation_entry(id) ON DELETE RESTRICT,
  posted_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT depreciation_entry_company_asset_fk FOREIGN KEY (company_id, asset_id) REFERENCES public.asset_record(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT depreciation_entry_company_document_fk FOREIGN KEY (company_id, source_document_id) REFERENCES public.business_document(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT depreciation_entry_amount_check CHECK (
    (reversal_of_id IS NULL AND amount > 0) OR
    (reversal_of_id IS NOT NULL AND amount < 0)
  ),
  CONSTRAINT depreciation_entry_period_check CHECK (period_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);

CREATE UNIQUE INDEX IF NOT EXISTS depreciation_entry_asset_period_original_unique
  ON public.depreciation_entry(asset_id, period_month)
  WHERE reversal_of_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS depreciation_entry_reversal_unique
  ON public.depreciation_entry(reversal_of_id)
  WHERE reversal_of_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS depreciation_entry_company_period_idx ON public.depreciation_entry(company_id, period_month);

-- Lampiran Dokumen Operasional & Media
CREATE TABLE IF NOT EXISTS public.attachment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.company(id) ON DELETE RESTRICT,
  parent_type text NOT NULL,
  parent_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1,
  original_name text NOT NULL,
  storage_key text NOT NULL,
  detected_mime text NOT NULL,
  size_bytes bigint NOT NULL,
  checksum_sha256 text NOT NULL,
  scan_status text NOT NULL DEFAULT 'pending',
  uploaded_by_user_id text,
  supersedes_id uuid REFERENCES public.attachment(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT attachment_storage_key_unique UNIQUE (storage_key),
  CONSTRAINT attachment_parent_version_unique UNIQUE (company_id, parent_type, parent_id, version),
  CONSTRAINT attachment_mime_check CHECK (detected_mime IN ('application/pdf', 'image/jpeg', 'image/png')),
  CONSTRAINT attachment_size_check CHECK (size_bytes > 0 AND size_bytes <= 52428800),
  CONSTRAINT attachment_scan_status_check CHECK (scan_status IN ('pending', 'clean', 'infected', 'quarantined', 'error'))
);

CREATE INDEX IF NOT EXISTS attachment_parent_idx ON public.attachment(company_id, parent_type, parent_id);

-- Notifikasi Dalam Aplikasi (In-App Notification)
CREATE TABLE IF NOT EXISTS public.app_notification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.company(id) ON DELETE RESTRICT,
  recipient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  audience_role text NOT NULL,
  event_type text NOT NULL,
  source_object_type text NOT NULL,
  source_object_id uuid NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  destination text NOT NULL,
  deduplication_key text NOT NULL,
  read_at timestamp with time zone,
  push_dispatched_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT app_notification_company_recipient_dedup_unique UNIQUE (company_id, recipient_user_id, deduplication_key),
  CONSTRAINT app_notification_audience_role_check CHECK (audience_role IN ('finance', 'kepala_konveksi', 'owner')),
  CONSTRAINT app_notification_event_type_check CHECK (event_type IN ('purchase_ready_for_payment', 'purchase_partially_paid', 'purchase_paid', 'general_notification')),
  CONSTRAINT app_notification_destination_check CHECK (destination ~ '^/workspace/[a-z0-9-]+(\\?[A-Za-z0-9_=&%-]+)?$')
);

CREATE INDEX IF NOT EXISTS app_notification_recipient_company_time_idx ON public.app_notification(recipient_user_id, company_id, created_at);
CREATE INDEX IF NOT EXISTS app_notification_source_idx ON public.app_notification(company_id, source_object_type, source_object_id);

-- Langganan Web Push Browser
CREATE TABLE IF NOT EXISTS public.web_push_subscription (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  expiration_time bigint,
  is_active boolean NOT NULL DEFAULT true,
  failure_count integer NOT NULL DEFAULT 0,
  last_success_at timestamp with time zone,
  last_failure_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT web_push_subscription_endpoint_unique UNIQUE (endpoint),
  CONSTRAINT web_push_subscription_failure_count_check CHECK (failure_count >= 0)
);

CREATE INDEX IF NOT EXISTS web_push_subscription_user_active_idx ON public.web_push_subscription(user_id, is_active);

CREATE OR REPLACE TRIGGER update_web_push_subscription_updated_at
  BEFORE UPDATE ON public.web_push_subscription
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ==============================================================================
-- 7. Row Level Security (RLS) Policies
-- ==============================================================================

-- Aktifkan dan paksakan RLS pada seluruh tabel di skema public
ALTER TABLE public.company ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company FORCE ROW LEVEL SECURITY;

ALTER TABLE public.user_company_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_company_assignment FORCE ROW LEVEL SECURITY;

ALTER TABLE public.access_permission ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_permission FORCE ROW LEVEL SECURITY;

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log FORCE ROW LEVEL SECURITY;

ALTER TABLE public.document_sequence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_sequence FORCE ROW LEVEL SECURITY;

ALTER TABLE public.unit_definition ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unit_definition FORCE ROW LEVEL SECURITY;

ALTER TABLE public.configuration_category ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.configuration_category FORCE ROW LEVEL SECURITY;

ALTER TABLE public.ledger_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_account FORCE ROW LEVEL SECURITY;

ALTER TABLE public.accounting_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_mapping FORCE ROW LEVEL SECURITY;

ALTER TABLE public.report_account_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_account_mapping FORCE ROW LEVEL SECURITY;

ALTER TABLE public.accounting_period ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_period FORCE ROW LEVEL SECURITY;

ALTER TABLE public.master_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.master_record FORCE ROW LEVEL SECURITY;

ALTER TABLE public.business_document ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_document FORCE ROW LEVEL SECURITY;

ALTER TABLE public.business_document_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_document_line FORCE ROW LEVEL SECURITY;

ALTER TABLE public.production_operator_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_operator_profile FORCE ROW LEVEL SECURITY;

ALTER TABLE public.production_work_order ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_work_order FORCE ROW LEVEL SECURITY;

ALTER TABLE public.production_product_routing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_product_routing FORCE ROW LEVEL SECURITY;

ALTER TABLE public.production_material_unit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_material_unit FORCE ROW LEVEL SECURITY;

ALTER TABLE public.production_cutting_lot ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_cutting_lot FORCE ROW LEVEL SECURITY;

ALTER TABLE public.production_bundle ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_bundle FORCE ROW LEVEL SECURITY;

ALTER TABLE public.production_bundle_reservation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_bundle_reservation FORCE ROW LEVEL SECURITY;

ALTER TABLE public.production_work_order_bundle ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_work_order_bundle FORCE ROW LEVEL SECURITY;

ALTER TABLE public.production_printing_operator ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_printing_operator FORCE ROW LEVEL SECURITY;

ALTER TABLE public.production_repair_case ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_repair_case FORCE ROW LEVEL SECURITY;

ALTER TABLE public.production_bundle_stage_result ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_bundle_stage_result FORCE ROW LEVEL SECURITY;

ALTER TABLE public.inventory_movement ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movement FORCE ROW LEVEL SECURITY;

ALTER TABLE public.journal_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entry FORCE ROW LEVEL SECURITY;

ALTER TABLE public.journal_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_line FORCE ROW LEVEL SECURITY;

ALTER TABLE public.subledger_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subledger_entry FORCE ROW LEVEL SECURITY;

ALTER TABLE public.cash_movement ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_movement FORCE ROW LEVEL SECURITY;

ALTER TABLE public.prepaid_expense ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prepaid_expense FORCE ROW LEVEL SECURITY;

ALTER TABLE public.prepaid_amortization_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prepaid_amortization_entry FORCE ROW LEVEL SECURITY;

ALTER TABLE public.wage_liability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wage_liability FORCE ROW LEVEL SECURITY;

ALTER TABLE public.wage_rate ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wage_rate FORCE ROW LEVEL SECURITY;

ALTER TABLE public.negative_stock_exception ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.negative_stock_exception FORCE ROW LEVEL SECURITY;

ALTER TABLE public.asset_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_record FORCE ROW LEVEL SECURITY;

ALTER TABLE public.depreciation_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.depreciation_entry FORCE ROW LEVEL SECURITY;

ALTER TABLE public.attachment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attachment FORCE ROW LEVEL SECURITY;

ALTER TABLE public.app_notification ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_notification FORCE ROW LEVEL SECURITY;

ALTER TABLE public.web_push_subscription ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.web_push_subscription FORCE ROW LEVEL SECURITY;

-- Kebijakan RLS untuk public.company
DROP POLICY IF EXISTS "Users can view assigned companies" ON public.company;
CREATE POLICY "Users can view assigned companies"
  ON public.company
  FOR SELECT
  TO authenticated
  USING (
    id IN (SELECT public.get_user_company_ids((SELECT auth.uid())))
  );

DROP POLICY IF EXISTS "Owners can update assigned companies" ON public.company;
CREATE POLICY "Owners can update assigned companies"
  ON public.company
  FOR UPDATE
  TO authenticated
  USING (
    public.is_company_owner(id, (SELECT auth.uid()))
  )
  WITH CHECK (
    public.is_company_owner(id, (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS "Authenticated users can create companies" ON public.company;
CREATE POLICY "Authenticated users can create companies"
  ON public.company
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Kebijakan RLS untuk public.user_company_assignment
DROP POLICY IF EXISTS "Users can view company assignments" ON public.user_company_assignment;
CREATE POLICY "Users can view company assignments"
  ON public.user_company_assignment
  FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR public.is_company_owner(company_id, (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS "Owners can manage company assignments" ON public.user_company_assignment;
CREATE POLICY "Owners can manage company assignments"
  ON public.user_company_assignment
  FOR ALL
  TO authenticated
  USING (
    public.is_company_owner(company_id, (SELECT auth.uid()))
  )
  WITH CHECK (
    public.is_company_owner(company_id, (SELECT auth.uid()))
  );

-- Kebijakan RLS untuk tabel-tabel terisolasi tenant (company_id based)
DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'access_permission',
    'audit_log',
    'document_sequence',
    'unit_definition',
    'configuration_category',
    'ledger_account',
    'accounting_mapping',
    'report_account_mapping',
    'accounting_period',
    'master_record',
    'business_document',
    'business_document_line',
    'production_operator_profile',
    'production_work_order',
    'production_product_routing',
    'production_material_unit',
    'production_cutting_lot',
    'production_bundle',
    'production_bundle_reservation',
    'production_work_order_bundle',
    'production_printing_operator',
    'production_repair_case',
    'production_bundle_stage_result',
    'inventory_movement',
    'journal_entry',
    'journal_line',
    'subledger_entry',
    'cash_movement',
    'prepaid_expense',
    'prepaid_amortization_entry',
    'wage_liability',
    'wage_rate',
    'negative_stock_exception',
    'asset_record',
    'depreciation_entry',
    'attachment',
    'app_notification'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables
  LOOP
    EXECUTE format('
      DROP POLICY IF EXISTS "Tenant isolation policy" ON public.%I;
      CREATE POLICY "Tenant isolation policy"
        ON public.%I
        FOR ALL
        TO authenticated
        USING (
          company_id IN (
            SELECT public.get_user_company_ids((SELECT auth.uid()))
          )
        )
        WITH CHECK (
          company_id IN (
            SELECT public.get_user_company_ids((SELECT auth.uid()))
          )
        );
    ', tbl, tbl);
  END LOOP;
END $$;

-- Kebijakan RLS untuk web_push_subscription
DROP POLICY IF EXISTS "Users manage own web push subscriptions" ON public.web_push_subscription;
CREATE POLICY "Users manage own web push subscriptions"
  ON public.web_push_subscription
  FOR ALL
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- Grants hak akses ke role authenticated
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- ==============================================================================
-- 8. Stored Procedure Bootstrap Company Data (bootstrap_company_data)
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
    (p_company_id, '1-1.1.02', 'AKTIVA', 'AKTIVA LANCAR', 'KAS DAN BANK', 'Bank BCA (2833236181)', 'asset', 'debit', 'positive', 'accumulated', false, true),
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
  -- Mapping eksplisit akun spesifik
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

  -- Mapping default untuk seluruh akun Biaya lainnya
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
