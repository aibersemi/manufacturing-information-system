-- ==============================================================================
-- Migrasi 000006: Stored Procedure & Logic Finance, Accounting & General Ledger
-- ==============================================================================

-- 0. Penyesuaian skema penunjang wage_liability
ALTER TABLE public.wage_liability
  ADD COLUMN IF NOT EXISTS is_paid boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_document_id uuid REFERENCES public.business_document(id) ON DELETE SET NULL;

-- 1. Fungsi Atomik: Update Status Akun Bagan Akun (COA)
CREATE OR REPLACE FUNCTION public.update_ledger_account_status(
  p_company_id uuid,
  p_account_id uuid,
  p_is_active boolean,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_account RECORD;
BEGIN
  -- Validasi keberadaan akun
  SELECT * INTO v_account
  FROM public.ledger_account
  WHERE company_id = p_company_id AND id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Akun COA tidak ditemukan pada perusahaan ini.';
  END IF;

  -- Jika hendak menonaktifkan akun, validasi seluruh pembatasan invariant
  IF p_is_active = false THEN
    -- Invariant 1: Dilarang menonaktifkan akun yang menjadi mapping aktif di accounting_mapping
    IF EXISTS (
      SELECT 1 FROM public.accounting_mapping
      WHERE company_id = p_company_id AND account_id = p_account_id
    ) THEN
      RAISE EXCEPTION 'Akun tidak dapat dinonaktifkan karena sedang digunakan sebagai pemetaan sistem (accounting mapping).';
    END IF;

    -- Invariant 2: Dilarang menonaktifkan akun yang terhubung ke rekening kas aktif
    IF EXISTS (
      SELECT 1 FROM public.master_record
      WHERE company_id = p_company_id
        AND record_kind = 'cash_account'
        AND ledger_account_id = p_account_id
        AND is_active = true
    ) THEN
      RAISE EXCEPTION 'Akun tidak dapat dinonaktifkan karena terhubung ke rekening kas/bank aktif.';
    END IF;

    -- Invariant 3: Dilarang menonaktifkan akun yang sedang digunakan pada dokumen draf
    IF EXISTS (
      SELECT 1 FROM public.business_document_line bdl
      JOIN public.business_document bd ON bd.id = bdl.document_id AND bd.company_id = bdl.company_id
      WHERE bdl.company_id = p_company_id
        AND bdl.account_id = p_account_id
        AND bd.status = 'draft'
    ) THEN
      RAISE EXCEPTION 'Akun tidak dapat dinonaktifkan karena sedang digunakan pada dokumen transaksi draf.';
    END IF;

    -- Invariant 4: Dilarang menonaktifkan akun yang terikat pada kontrak biaya dibayar dimuka aktif
    IF EXISTS (
      SELECT 1 FROM public.prepaid_expense
      WHERE company_id = p_company_id
        AND status = 'active'
        AND (prepaid_account_id = p_account_id OR expense_account_id = p_account_id)
    ) THEN
      RAISE EXCEPTION 'Akun tidak dapat dinonaktifkan karena terikat pada kontrak biaya dibayar dimuka aktif.';
    END IF;
  END IF;

  UPDATE public.ledger_account
  SET
    is_active = p_is_active,
    version = version + 1,
    updated_at = now()
  WHERE company_id = p_company_id AND id = p_account_id
  RETURNING * INTO v_account;

  RETURN to_jsonb(v_account);
END;
$$;

-- 2. Fungsi Atomik: Menyimpan 21 Pemetaan Akun Sistem (Accounting Mappings)
CREATE OR REPLACE FUNCTION public.save_accounting_mappings(
  p_company_id uuid,
  p_mappings jsonb,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_item jsonb;
  v_key text;
  v_account_id uuid;
  v_account RECORD;
  v_expected_type text;
  v_count integer := 0;
BEGIN
  IF p_mappings IS NULL OR jsonb_typeof(p_mappings) <> 'array' THEN
    RAISE EXCEPTION 'Payload pemetaan sistem harus berupa array JSON.';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_mappings)
  LOOP
    v_key := v_item->>'mapping_key';
    v_account_id := (v_item->>'account_id')::uuid;

    IF v_key IS NULL OR v_account_id IS NULL THEN
      RAISE EXCEPTION 'Setiap pemetaan wajib memiliki mapping_key dan account_id.';
    END IF;

    -- Tentukan ekspektasi account_type berdasarkan 21 system mapping definitions
    CASE v_key
      WHEN 'cash', 'receivable', 'material_inventory', 'production_supplies_inventory',
           'wip_cut', 'wip_printed', 'wip_sewn', 'finished_goods', 'asset_candidate',
           'fixed_asset', 'accumulated_depreciation' THEN
        v_expected_type := 'asset';
      WHEN 'supplier_payable', 'wage_payable' THEN
        v_expected_type := 'liability';
      WHEN 'opening_equity' THEN
        v_expected_type := 'equity';
      WHEN 'sales_revenue', 'asset_disposal_gain' THEN
        v_expected_type := 'revenue';
      WHEN 'cogs', 'operating_expense', 'production_overhead', 'depreciation_expense', 'asset_disposal_loss' THEN
        v_expected_type := 'expense';
      ELSE
        RAISE EXCEPTION 'Mapping key % tidak valid dalam 21 pemetaan sistem standar.', v_key;
    END CASE;

    -- Validasi akun ada, aktif, dan bertipe sesuai
    SELECT * INTO v_account
    FROM public.ledger_account
    WHERE company_id = p_company_id AND id = v_account_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Akun dengan ID % tidak ditemukan pada perusahaan ini.', v_account_id;
    END IF;

    IF NOT v_account.is_active THEN
      RAISE EXCEPTION 'Akun % (%) tidak aktif dan tidak dapat digunakan sebagai pemetaan sistem.', v_account.code, v_account.name;
    END IF;

    IF v_account.account_type <> v_expected_type THEN
      RAISE EXCEPTION 'Tipe akun untuk mapping % tidak sesuai: diharapkan %, tetapi akun % bertipe %.',
        v_key, v_expected_type, v_account.code, v_account.account_type;
    END IF;

    INSERT INTO public.accounting_mapping (
      company_id, mapping_key, account_id, version, updated_at
    ) VALUES (
      p_company_id, v_key, v_account_id, 1, now()
    )
    ON CONFLICT (company_id, mapping_key)
    DO UPDATE SET
      account_id = EXCLUDED.account_id,
      version = public.accounting_mapping.version + 1,
      updated_at = now();

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'updatedCount', v_count,
    'timestamp', now()
  );
END;
$$;

-- 3. Fungsi Atomik: Menyimpan Pemetaan Laporan Manajemen & Arus Kas
CREATE OR REPLACE FUNCTION public.save_report_account_mappings(
  p_company_id uuid,
  p_mappings jsonb,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_item jsonb;
  v_account_id uuid;
  v_mgmt_post text;
  v_cf_act text;
  v_cf_grp text;
  v_account RECORD;
  v_count integer := 0;
BEGIN
  IF p_mappings IS NULL OR jsonb_typeof(p_mappings) <> 'array' THEN
    RAISE EXCEPTION 'Payload pemetaan laporan harus berupa array JSON.';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_mappings)
  LOOP
    v_account_id := (v_item->>'account_id')::uuid;
    v_mgmt_post := NULLIF(btrim(coalesce(v_item->>'management_post', '')), '');
    v_cf_act := NULLIF(btrim(coalesce(v_item->>'cash_flow_activity', '')), '');
    v_cf_grp := NULLIF(btrim(coalesce(v_item->>'cash_flow_group', '')), '');

    IF v_account_id IS NULL THEN
      RAISE EXCEPTION 'ID akun wajib disertakan dalam pemetaan laporan.';
    END IF;

    SELECT * INTO v_account
    FROM public.ledger_account
    WHERE company_id = p_company_id AND id = v_account_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Akun dengan ID % tidak ditemukan.', v_account_id;
    END IF;

    -- Jika management_post dikosongkan, hapus pemetaan laporan untuk akun ini
    IF v_mgmt_post IS NULL THEN
      DELETE FROM public.report_account_mapping
      WHERE company_id = p_company_id AND account_id = v_account_id;
      CONTINUE;
    END IF;

    -- Validasi nilai management_post
    IF v_mgmt_post NOT IN ('revenue', 'cogs', 'marketing_ads', 'operating_expense', 'payroll', 'other') THEN
      RAISE EXCEPTION 'Pos manajemen % tidak valid.', v_mgmt_post;
    END IF;

    -- Validasi nilai cash_flow_activity
    IF v_cf_act IS NOT NULL AND v_cf_act NOT IN ('operating', 'investing', 'financing') THEN
      RAISE EXCEPTION 'Aktivitas arus kas % tidak valid.', v_cf_act;
    END IF;

    -- Validasi kompatibilitas cash_flow_group terhadap cash_flow_activity
    IF v_cf_grp IS NOT NULL THEN
      IF v_cf_act IS NULL THEN
        RAISE EXCEPTION 'Grup arus kas % membutuhkan aktivitas arus kas (tidak boleh kosong).', v_cf_grp;
      END IF;

      IF v_cf_act = 'operating' AND v_cf_grp NOT IN ('customer_receipts', 'supplier_payments', 'payroll_and_operating_expenses', 'other') THEN
        RAISE EXCEPTION 'Grup arus kas % tidak kompatibel dengan aktivitas arus kas operasi.', v_cf_grp;
      ELSIF v_cf_act = 'investing' AND v_cf_grp NOT IN ('asset_purchases', 'asset_disposals', 'other') THEN
        RAISE EXCEPTION 'Grup arus kas % tidak kompatibel dengan aktivitas arus kas investasi.', v_cf_grp;
      ELSIF v_cf_act = 'financing' AND v_cf_grp NOT IN ('owner_contributions', 'owner_drawings', 'debt_financing', 'other') THEN
        RAISE EXCEPTION 'Grup arus kas % tidak kompatibel dengan aktivitas arus kas pendanaan.', v_cf_grp;
      END IF;
    END IF;

    INSERT INTO public.report_account_mapping (
      company_id, account_id, management_post, cash_flow_activity, cash_flow_group, version, updated_at
    ) VALUES (
      p_company_id, v_account_id, v_mgmt_post, v_cf_act, v_cf_grp, 1, now()
    )
    ON CONFLICT (company_id, account_id)
    DO UPDATE SET
      management_post = EXCLUDED.management_post,
      cash_flow_activity = EXCLUDED.cash_flow_activity,
      cash_flow_group = EXCLUDED.cash_flow_group,
      version = public.report_account_mapping.version + 1,
      updated_at = now();

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'savedCount', v_count,
    'timestamp', now()
  );
END;
$$;

-- 4. Fungsi Atomik: Transfer Antar Rekening Kas / Bank
CREATE OR REPLACE FUNCTION public.post_cash_transfer(
  p_company_id uuid,
  p_source_cash_id uuid,
  p_destination_cash_id uuid,
  p_amount bigint,
  p_transfer_date date DEFAULT current_date,
  p_notes text DEFAULT NULL,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_source RECORD;
  v_destination RECORD;
  v_source_acc RECORD;
  v_destination_acc RECORD;
  v_period RECORD;
  v_period_month text;
  v_source_balance bigint;
  v_doc_id uuid := gen_random_uuid();
  v_doc_number text;
  v_prefix text;
  v_seq_key text;
  v_seq_num bigint;
  v_journal_id uuid := gen_random_uuid();
  v_journal_prefix text;
  v_journal_seq_key text;
  v_journal_seq_num bigint;
  v_journal_number text;
  v_mv_out_id uuid := gen_random_uuid();
  v_mv_in_id uuid := gen_random_uuid();
  v_transfer_date date := coalesce(p_transfer_date, current_date);
BEGIN
  -- Validasi Rekening Sumber & Tujuan
  IF p_source_cash_id IS NULL OR p_destination_cash_id IS NULL THEN
    RAISE EXCEPTION 'Rekening sumber dan rekening tujuan wajib dipilih.';
  END IF;

  IF p_source_cash_id = p_destination_cash_id THEN
    RAISE EXCEPTION 'Rekening sumber dan rekening tujuan tidak boleh sama.';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Nominal transfer harus lebih besar dari 0.';
  END IF;

  -- Periksa keberadaan master rekening kas
  SELECT * INTO v_source
  FROM public.master_record
  WHERE company_id = p_company_id AND id = p_source_cash_id AND record_kind = 'cash_account' AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rekening kas sumber tidak ditemukan atau tidak aktif.';
  END IF;

  SELECT * INTO v_destination
  FROM public.master_record
  WHERE company_id = p_company_id AND id = p_destination_cash_id AND record_kind = 'cash_account' AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rekening kas tujuan tidak ditemukan atau tidak aktif.';
  END IF;

  -- Periksa akun COA yang terhubung
  IF v_source.ledger_account_id IS NULL OR v_destination.ledger_account_id IS NULL THEN
    RAISE EXCEPTION 'Kedua rekening kas/bank wajib terhubung dengan akun bagan akun (COA).';
  END IF;

  SELECT * INTO v_source_acc
  FROM public.ledger_account
  WHERE company_id = p_company_id AND id = v_source.ledger_account_id AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Akun COA rekening sumber tidak aktif atau tidak ditemukan.';
  END IF;

  SELECT * INTO v_destination_acc
  FROM public.ledger_account
  WHERE company_id = p_company_id AND id = v_destination.ledger_account_id AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Akun COA rekening tujuan tidak aktif atau tidak ditemukan.';
  END IF;

  -- Validasi Periode Akuntansi Terbuka
  v_period_month := to_char(v_transfer_date, 'YYYY-MM');
  SELECT * INTO v_period
  FROM public.accounting_period
  WHERE company_id = p_company_id AND period_month = v_period_month;

  IF NOT FOUND OR v_period.status <> 'open' OR v_period.state <> 'open' THEN
    RAISE EXCEPTION 'Periode akuntansi % belum dibuka atau sudah ditutup.', v_period_month;
  END IF;

  -- Validasi Saldo Rekening Sumber
  SELECT coalesce(sum(
    CASE
      WHEN movement_type IN ('receipt', 'revenue', 'income', 'opening_balance', 'transfer_in') THEN amount
      WHEN movement_type IN ('expense', 'disbursement', 'transfer_out') THEN -amount
      WHEN amount < 0 THEN amount
      ELSE amount
    END
  ), 0) INTO v_source_balance
  FROM public.cash_movement
  WHERE company_id = p_company_id AND cash_account_id = p_source_cash_id;

  IF v_source_balance < p_amount THEN
    RAISE EXCEPTION 'Saldo rekening sumber tidak mencukupi (Saldo: %, Nominal Transfer: %).', v_source_balance, p_amount;
  END IF;

  -- Penomoran Bukti Transfer TR-YYMMDD-###
  v_prefix := 'TR-' || to_char(v_transfer_date, 'YYMMDD') || '-';
  v_seq_key := 'cash_transfer-' || to_char(v_transfer_date, 'YYMMDD');

  INSERT INTO public.document_sequence (
    company_id, sequence_key, prefix, padding, current_number, current_value, updated_at
  ) VALUES (
    p_company_id, v_seq_key, v_prefix, 3, 1, 1, now()
  )
  ON CONFLICT (company_id, sequence_key)
  DO UPDATE SET
    current_number = public.document_sequence.current_number + 1,
    current_value = public.document_sequence.current_value + 1,
    updated_at = now()
  RETURNING current_number INTO v_seq_num;

  v_doc_number := v_prefix || lpad(v_seq_num::text, 3, '0');

  -- Header Dokumen Business Document
  INSERT INTO public.business_document (
    id, company_id, document_kind, document_number, status,
    transaction_date, total_amount, paid_amount, data,
    posted_at, posted_by_user_id, created_by_user_id, created_at, updated_at
  ) VALUES (
    v_doc_id, p_company_id, 'cash_transfer', v_doc_number, 'posted',
    v_transfer_date, p_amount, p_amount,
    jsonb_build_object(
      'sourceCashAccountId', p_source_cash_id,
      'sourceCashAccountName', v_source.name,
      'destinationCashAccountId', p_destination_cash_id,
      'destinationCashAccountName', v_destination.name,
      'notes', coalesce(p_notes, '')
    ),
    now(), p_user_id::text, p_user_id::text, now(), now()
  );

  -- Dua Mutasi Kas Berpasangan (Cash Movement)
  -- 1. Rekening Sumber: expense (pengeluaran)
  INSERT INTO public.cash_movement (
    id, company_id, cash_account_id, movement_type, transaction_date,
    amount, source_document_id, paired_movement_id, notes, posted_at, created_at
  ) VALUES (
    v_mv_out_id, p_company_id, p_source_cash_id, 'expense', v_transfer_date,
    p_amount, v_doc_id, v_mv_in_id, 'Transfer keluar ke ' || v_destination.name || ' (' || v_doc_number || ')', now(), now()
  );

  -- 2. Rekening Tujuan: income (pemasukan)
  INSERT INTO public.cash_movement (
    id, company_id, cash_account_id, movement_type, transaction_date,
    amount, source_document_id, paired_movement_id, notes, posted_at, created_at
  ) VALUES (
    v_mv_in_id, p_company_id, p_destination_cash_id, 'income', v_transfer_date,
    p_amount, v_doc_id, v_mv_out_id, 'Transfer masuk dari ' || v_source.name || ' (' || v_doc_number || ')', now(), now()
  );

  -- Penomoran Jurnal Memorial JU-YYMMDD-###
  v_journal_prefix := 'JU-' || to_char(v_transfer_date, 'YYMMDD') || '-';
  v_journal_seq_key := 'journal_entry-' || to_char(v_transfer_date, 'YYMMDD');

  INSERT INTO public.document_sequence (
    company_id, sequence_key, prefix, padding, current_number, current_value, updated_at
  ) VALUES (
    p_company_id, v_journal_seq_key, v_journal_prefix, 3, 1, 1, now()
  )
  ON CONFLICT (company_id, sequence_key)
  DO UPDATE SET
    current_number = public.document_sequence.current_number + 1,
    current_value = public.document_sequence.current_value + 1,
    updated_at = now()
  RETURNING current_number INTO v_journal_seq_num;

  v_journal_number := v_journal_prefix || lpad(v_journal_seq_num::text, 3, '0');

  INSERT INTO public.journal_entry (
    id, company_id, entry_number, period_id, source_document_id,
    transaction_date, entry_type, memo, description, status,
    posted_at, created_at
  ) VALUES (
    v_journal_id, p_company_id, v_journal_number, v_period.id, v_doc_id,
    v_transfer_date, 'transfer', 'Transfer Antar Rekening ' || v_doc_number,
    'Transfer kas dari ' || v_source.name || ' ke ' || v_destination.name,
    'posted', now(), now()
  );

  -- Line 1: Debit Akun Kas Tujuan
  INSERT INTO public.journal_line (
    company_id, journal_entry_id, line_number, account_id,
    debit_amount, credit_amount, debit, credit, description
  ) VALUES (
    p_company_id, v_journal_id, 1, v_destination.ledger_account_id,
    p_amount, 0, p_amount, 0, 'Transfer masuk ke ' || v_destination.name
  );

  -- Line 2: Kredit Akun Kas Sumber
  INSERT INTO public.journal_line (
    company_id, journal_entry_id, line_number, account_id,
    debit_amount, credit_amount, debit, credit, description
  ) VALUES (
    p_company_id, v_journal_id, 2, v_source.ledger_account_id,
    0, p_amount, 0, p_amount, 'Transfer keluar dari ' || v_source.name
  );

  RETURN jsonb_build_object(
    'documentId', v_doc_id,
    'documentNumber', v_doc_number,
    'journalId', v_journal_id,
    'journalNumber', v_journal_number,
    'amount', p_amount,
    'sourceCashAccount', v_source.name,
    'destinationCashAccount', v_destination.name,
    'status', 'posted'
  );
END;
$$;

-- 5. Fungsi Atomik: Mencatat Beban Operasional (Operating Expense)
CREATE OR REPLACE FUNCTION public.post_operating_expense(
  p_company_id uuid,
  p_funding_method text,
  p_cash_account_id uuid DEFAULT NULL,
  p_supplier_id uuid DEFAULT NULL,
  p_expense_date date DEFAULT current_date,
  p_notes text DEFAULT NULL,
  p_lines jsonb DEFAULT '[]'::jsonb,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_doc_id uuid := gen_random_uuid();
  v_doc_number text;
  v_prefix text;
  v_seq_key text;
  v_seq_num bigint;
  v_period RECORD;
  v_period_month text;
  v_total_amount bigint := 0;
  v_cash_record RECORD;
  v_supplier_record RECORD;
  v_payable_account_id uuid;
  v_credit_account_id uuid;
  v_cash_account_name text := NULL;
  v_supplier_name text := NULL;
  v_line jsonb;
  v_line_acc_id uuid;
  v_line_acc RECORD;
  v_line_amount bigint;
  v_line_desc text;
  v_line_idx integer := 1;
  v_journal_id uuid := gen_random_uuid();
  v_journal_prefix text;
  v_journal_seq_key text;
  v_journal_seq_num bigint;
  v_journal_number text;
  v_expense_date date := coalesce(p_expense_date, current_date);
BEGIN
  -- Validasi Minimal Satu Baris Beban
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Beban operasional wajib memiliki minimal satu baris rincian.';
  END IF;

  -- Validasi Metode Pendanaan
  IF p_funding_method NOT IN ('cash', 'payable') THEN
    RAISE EXCEPTION 'Metode pendanaan harus "cash" (Kas/Bank) atau "payable" (Hutang Usaha).';
  END IF;

  -- Validasi Periode Akuntansi Terbuka
  v_period_month := to_char(v_expense_date, 'YYYY-MM');
  SELECT * INTO v_period
  FROM public.accounting_period
  WHERE company_id = p_company_id AND period_month = v_period_month;

  IF NOT FOUND OR v_period.status <> 'open' OR v_period.state <> 'open' THEN
    RAISE EXCEPTION 'Periode akuntansi % belum dibuka atau sudah ditutup.', v_period_month;
  END IF;

  -- Validasi Rekening Kas atau Pemasok
  IF p_funding_method = 'cash' THEN
    IF p_cash_account_id IS NULL THEN
      RAISE EXCEPTION 'Rekening kas/bank penampung wajib dipilih untuk pembayaran tunai.';
    END IF;

    SELECT * INTO v_cash_record
    FROM public.master_record
    WHERE company_id = p_company_id AND id = p_cash_account_id AND record_kind = 'cash_account' AND is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Rekening kas/bank tidak ditemukan atau tidak aktif.';
    END IF;

    IF v_cash_record.ledger_account_id IS NULL THEN
      RAISE EXCEPTION 'Rekening kas/bank belum terhubung dengan akun bagan akun (COA).';
    END IF;

    v_cash_account_name := v_cash_record.name;
    v_credit_account_id := v_cash_record.ledger_account_id;
  ELSE
    IF p_supplier_id IS NULL THEN
      RAISE EXCEPTION 'Pemasok/rekanan wajib dipilih untuk biaya operasional bertempo (hutang).';
    END IF;

    SELECT * INTO v_supplier_record
    FROM public.master_record
    WHERE company_id = p_company_id AND id = p_supplier_id AND record_kind = 'supplier' AND is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Pemasok/rekanan tidak ditemukan atau tidak aktif.';
    END IF;

    -- Ambil akun hutang dari system mapping supplier_payable
    SELECT account_id INTO v_payable_account_id
    FROM public.accounting_mapping
    WHERE company_id = p_company_id AND mapping_key = 'supplier_payable';

    IF v_payable_account_id IS NULL THEN
      RAISE EXCEPTION 'Pemetaan sistem untuk akun Hutang Pemasok (supplier_payable) belum dikonfigurasi.';
    END IF;

    v_supplier_name := v_supplier_record.name;
    v_credit_account_id := v_payable_account_id;
  END IF;

  -- Validasi Tiap Baris Beban
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_line_acc_id := (v_line->>'account_id')::uuid;
    v_line_amount := (v_line->>'amount')::bigint;
    v_line_desc := coalesce(v_line->>'description', 'Biaya Operasional');

    IF v_line_acc_id IS NULL THEN
      RAISE EXCEPTION 'Akun beban pada baris % wajib diisi.', v_line_idx;
    END IF;

    IF v_line_amount IS NULL OR v_line_amount <= 0 THEN
      RAISE EXCEPTION 'Nominal beban pada baris % harus lebih besar dari 0.', v_line_idx;
    END IF;

    SELECT * INTO v_line_acc
    FROM public.ledger_account
    WHERE company_id = p_company_id AND id = v_line_acc_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Akun COA pada baris % tidak ditemukan.', v_line_idx;
    END IF;

    IF NOT v_line_acc.is_active THEN
      RAISE EXCEPTION 'Akun COA % (%) pada baris % tidak aktif.', v_line_acc.code, v_line_acc.name, v_line_idx;
    END IF;

    IF v_line_acc.account_type <> 'expense' THEN
      RAISE EXCEPTION 'Akun COA % (%) bukan bertipe beban (expense).', v_line_acc.code, v_line_acc.name;
    END IF;

    v_total_amount := v_total_amount + v_line_amount;
    v_line_idx := v_line_idx + 1;
  END LOOP;

  -- Penomoran Dokumen BO-YYMMDD-###
  v_prefix := 'BO-' || to_char(v_expense_date, 'YYMMDD') || '-';
  v_seq_key := 'operating_expense-' || to_char(v_expense_date, 'YYMMDD');

  INSERT INTO public.document_sequence (
    company_id, sequence_key, prefix, padding, current_number, current_value, updated_at
  ) VALUES (
    p_company_id, v_seq_key, v_prefix, 3, 1, 1, now()
  )
  ON CONFLICT (company_id, sequence_key)
  DO UPDATE SET
    current_number = public.document_sequence.current_number + 1,
    current_value = public.document_sequence.current_value + 1,
    updated_at = now()
  RETURNING current_number INTO v_seq_num;

  v_doc_number := v_prefix || lpad(v_seq_num::text, 3, '0');

  -- Header Dokumen Business Document
  INSERT INTO public.business_document (
    id, company_id, document_kind, document_number, status,
    transaction_date, counterparty_id, total_amount, paid_amount, data,
    posted_at, posted_by_user_id, created_by_user_id, created_at, updated_at
  ) VALUES (
    v_doc_id, p_company_id, 'operating_expense', v_doc_number, 'posted',
    v_expense_date, p_supplier_id, v_total_amount,
    CASE WHEN p_funding_method = 'cash' THEN v_total_amount ELSE 0 END,
    jsonb_build_object(
      'fundingMethod', p_funding_method,
      'cashAccountId', p_cash_account_id,
      'cashAccountName', v_cash_account_name,
      'supplierName', v_supplier_name,
      'notes', coalesce(p_notes, '')
    ),
    now(), p_user_id::text, p_user_id::text, now(), now()
  );

  -- Baris Dokumen (business_document_line)
  v_line_idx := 1;
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_line_acc_id := (v_line->>'account_id')::uuid;
    v_line_amount := (v_line->>'amount')::bigint;
    v_line_desc := coalesce(v_line->>'description', 'Beban Operasional');

    INSERT INTO public.business_document_line (
      company_id, document_id, line_number, account_id,
      description, quantity, unit_price, subtotal, total_amount,
      created_at
    ) VALUES (
      p_company_id, v_doc_id, v_line_idx, v_line_acc_id,
      v_line_desc, 1, v_line_amount, v_line_amount, v_line_amount,
      now()
    );
    v_line_idx := v_line_idx + 1;
  END LOOP;

  -- Efek Kas atau Subledger Hutang
  IF p_funding_method = 'cash' THEN
    INSERT INTO public.cash_movement (
      company_id, cash_account_id, movement_type, transaction_date,
      amount, source_document_id, notes, posted_at, created_at
    ) VALUES (
      p_company_id, p_cash_account_id, 'expense', v_expense_date,
      v_total_amount, v_doc_id, 'Beban operasional ' || v_doc_number, now(), now()
    );
  ELSE
    INSERT INTO public.subledger_entry (
      company_id, subledger_kind, subledger_type, counterparty_id,
      source_document_id, transaction_date, amount, debit_amount,
      credit_amount, remaining_balance, status, posted_at, created_at
    ) VALUES (
      p_company_id, 'supplier_payable', 'supplier_payable', p_supplier_id,
      v_doc_id, v_expense_date, v_total_amount, 0,
      v_total_amount, v_total_amount, 'open', now(), now()
    );
  END IF;

  -- Penomoran Jurnal Memorial JU-YYMMDD-###
  v_journal_prefix := 'JU-' || to_char(v_expense_date, 'YYMMDD') || '-';
  v_journal_seq_key := 'journal_entry-' || to_char(v_expense_date, 'YYMMDD');

  INSERT INTO public.document_sequence (
    company_id, sequence_key, prefix, padding, current_number, current_value, updated_at
  ) VALUES (
    p_company_id, v_journal_seq_key, v_journal_prefix, 3, 1, 1, now()
  )
  ON CONFLICT (company_id, sequence_key)
  DO UPDATE SET
    current_number = public.document_sequence.current_number + 1,
    current_value = public.document_sequence.current_value + 1,
    updated_at = now()
  RETURNING current_number INTO v_journal_seq_num;

  v_journal_number := v_journal_prefix || lpad(v_journal_seq_num::text, 3, '0');

  INSERT INTO public.journal_entry (
    id, company_id, entry_number, period_id, source_document_id,
    transaction_date, entry_type, memo, description, status,
    posted_at, created_at
  ) VALUES (
    v_journal_id, p_company_id, v_journal_number, v_period.id, v_doc_id,
    v_expense_date, 'expense', 'Beban Operasional ' || v_doc_number,
    'Pencatatan beban operasional ' || v_doc_number || coalesce(' - ' || p_notes, ''),
    'posted', now(), now()
  );

  -- Baris Jurnal Debit (Per baris beban)
  v_line_idx := 1;
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_line_acc_id := (v_line->>'account_id')::uuid;
    v_line_amount := (v_line->>'amount')::bigint;
    v_line_desc := coalesce(v_line->>'description', 'Beban Operasional');

    INSERT INTO public.journal_line (
      company_id, journal_entry_id, line_number, account_id,
      debit_amount, credit_amount, debit, credit, description
    ) VALUES (
      p_company_id, v_journal_id, v_line_idx, v_line_acc_id,
      v_line_amount, 0, v_line_amount, 0, v_line_desc
    );
    v_line_idx := v_line_idx + 1;
  END LOOP;

  -- Baris Jurnal Kredit (Kas/Bank atau Hutang Pemasok)
  INSERT INTO public.journal_line (
    company_id, journal_entry_id, line_number, account_id,
    debit_amount, credit_amount, debit, credit, description
  ) VALUES (
    p_company_id, v_journal_id, v_line_idx,
    v_credit_account_id,
    0, v_total_amount, 0, v_total_amount,
    CASE WHEN p_funding_method = 'cash' THEN 'Kas/Bank (' || coalesce(v_cash_account_name, '') || ')' ELSE 'Hutang Biaya Operasional' END
  );

  RETURN jsonb_build_object(
    'documentId', v_doc_id,
    'documentNumber', v_doc_number,
    'journalId', v_journal_id,
    'journalNumber', v_journal_number,
    'totalAmount', v_total_amount,
    'fundingMethod', p_funding_method,
    'status', 'posted'
  );
END;
$$;

-- 6. Fungsi Atomik: Membatalkan Dokumen Beban Operasional (Void Operating Expense)
CREATE OR REPLACE FUNCTION public.void_operating_expense(
  p_company_id uuid,
  p_document_id uuid,
  p_reason text,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_doc RECORD;
  v_funding_method text;
  v_period RECORD;
  v_period_month text;
  v_subledger RECORD;
  v_cash_mv RECORD;
  v_orig_journal RECORD;
  v_rev_journal_id uuid := gen_random_uuid();
  v_rev_journal_prefix text;
  v_rev_journal_seq_key text;
  v_rev_journal_seq_num bigint;
  v_rev_journal_number text;
  v_line RECORD;
  v_line_idx integer := 1;
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'Alasan pembatalan biaya operasional wajib diisi minimal 5 karakter.';
  END IF;

  SELECT * INTO v_doc
  FROM public.business_document
  WHERE company_id = p_company_id AND id = p_document_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dokumen biaya operasional tidak ditemukan.';
  END IF;

  IF v_doc.document_kind <> 'operating_expense' THEN
    RAISE EXCEPTION 'Dokumen bukan berjenis biaya operasional.';
  END IF;

  IF v_doc.status <> 'posted' THEN
    RAISE EXCEPTION 'Hanya dokumen berstatus posted yang dapat dibatalkan.';
  END IF;

  v_funding_method := coalesce(v_doc.data->>'fundingMethod', 'cash');

  -- Validasi Periode Akuntansi Terbuka
  v_period_month := to_char(current_date, 'YYYY-MM');
  SELECT * INTO v_period
  FROM public.accounting_period
  WHERE company_id = p_company_id AND period_month = v_period_month;

  IF NOT FOUND OR v_period.status <> 'open' OR v_period.state <> 'open' THEN
    RAISE EXCEPTION 'Periode akuntansi aktif % tertutup; pembatalan tidak dapat diproses.', v_period_month;
  END IF;

  -- 1. Pembalikan Mutasi Kas atau Subledger
  IF v_funding_method = 'cash' THEN
    SELECT * INTO v_cash_mv
    FROM public.cash_movement
    WHERE company_id = p_company_id AND source_document_id = p_document_id
    ORDER BY created_at DESC LIMIT 1;

    IF FOUND THEN
      INSERT INTO public.cash_movement (
        company_id, cash_account_id, movement_type, transaction_date,
        amount, source_document_id, reversal_of_id, notes, posted_at, created_at
      ) VALUES (
        p_company_id, v_cash_mv.cash_account_id, 'income', current_date,
        v_cash_mv.amount, p_document_id, v_cash_mv.id,
        'Pembalikan biaya ' || v_doc.document_number || ': ' || p_reason, now(), now()
      );
    END IF;
  ELSE
    SELECT * INTO v_subledger
    FROM public.subledger_entry
    WHERE company_id = p_company_id AND source_document_id = p_document_id
    FOR UPDATE;

    IF FOUND THEN
      IF v_subledger.remaining_balance < v_subledger.amount THEN
        RAISE EXCEPTION 'Hutang biaya operasional telah dilunasi sebagian atau seluruhnya; batalkan pembayaran terlebih dahulu.';
      END IF;

      UPDATE public.subledger_entry
      SET status = 'voided', version = version + 1
      WHERE id = v_subledger.id;

      INSERT INTO public.subledger_entry (
        company_id, subledger_kind, subledger_type, counterparty_id,
        source_document_id, transaction_date, amount, debit_amount,
        credit_amount, remaining_balance, status, reversal_of_id,
        posted_at, created_at
      ) VALUES (
        p_company_id, 'supplier_payable', 'supplier_payable', v_subledger.counterparty_id,
        p_document_id, current_date, -v_subledger.amount, v_subledger.amount,
        0, 0, 'closed', v_subledger.id, now(), now()
      );
    END IF;
  END IF;

  -- 2. Pembalikan Jurnal Umum (Reversing Entry)
  SELECT * INTO v_orig_journal
  FROM public.journal_entry
  WHERE company_id = p_company_id AND source_document_id = p_document_id
  ORDER BY created_at DESC LIMIT 1;

  IF FOUND THEN
    v_rev_journal_prefix := 'JU-' || to_char(current_date, 'YYMMDD') || '-';
    v_rev_journal_seq_key := 'journal_entry-' || to_char(current_date, 'YYMMDD');

    INSERT INTO public.document_sequence (
      company_id, sequence_key, prefix, padding, current_number, current_value, updated_at
    ) VALUES (
      p_company_id, v_rev_journal_seq_key, v_rev_journal_prefix, 3, 1, 1, now()
    )
    ON CONFLICT (company_id, sequence_key)
    DO UPDATE SET
      current_number = public.document_sequence.current_number + 1,
      current_value = public.document_sequence.current_value + 1,
      updated_at = now()
    RETURNING current_number INTO v_rev_journal_seq_num;

    v_rev_journal_number := v_rev_journal_prefix || lpad(v_rev_journal_seq_num::text, 3, '0');

    INSERT INTO public.journal_entry (
      id, company_id, entry_number, period_id, source_document_id,
      transaction_date, entry_type, memo, description, status,
      reversal_of_id, posted_at, created_at
    ) VALUES (
      v_rev_journal_id, p_company_id, v_rev_journal_number, v_period.id, p_document_id,
      current_date, 'reversal', 'Pembalik Biaya ' || v_doc.document_number,
      'Pembalik ' || v_orig_journal.entry_number || ': ' || p_reason,
      'posted', v_orig_journal.id, now(), now()
    );

    FOR v_line IN
      SELECT * FROM public.journal_line
      WHERE journal_entry_id = v_orig_journal.id AND company_id = p_company_id
      ORDER BY line_number ASC
    LOOP
      INSERT INTO public.journal_line (
        company_id, journal_entry_id, line_number, account_id,
        debit_amount, credit_amount, debit, credit, description
      ) VALUES (
        p_company_id, v_rev_journal_id, v_line_idx, v_line.account_id,
        v_line.credit_amount, v_line.debit_amount, v_line.credit, v_line.debit,
        'Pembalik: ' || coalesce(v_line.description, '')
      );
      v_line_idx := v_line_idx + 1;
    END LOOP;
  END IF;

  -- 3. Update Status Dokumen Menjadi Void
  UPDATE public.business_document
  SET
    status = 'void',
    void_reason = p_reason,
    voided_at = now(),
    voided_by_user_id = p_user_id::text,
    version = version + 1,
    updated_at = now()
  WHERE id = p_document_id;

  RETURN jsonb_build_object(
    'documentId', p_document_id,
    'documentNumber', v_doc.document_number,
    'reversalJournalId', v_rev_journal_id,
    'reversalJournalNumber', v_rev_journal_number,
    'status', 'void'
  );
END;
$$;

-- 7. Fungsi Atomik: Membayar Upah Pegawai / Borongan (Post Wage Payment)
CREATE OR REPLACE FUNCTION public.post_wage_payment(
  p_company_id uuid,
  p_employee_id uuid,
  p_cash_account_id uuid,
  p_payment_date date DEFAULT current_date,
  p_liability_ids jsonb DEFAULT '[]'::jsonb,
  p_notes text DEFAULT NULL,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_employee RECORD;
  v_cash_record RECORD;
  v_wage_payable_account_id uuid;
  v_period RECORD;
  v_period_month text;
  v_total_amount bigint := 0;
  v_cash_balance bigint;
  v_doc_id uuid := gen_random_uuid();
  v_doc_number text;
  v_prefix text;
  v_seq_key text;
  v_seq_num bigint;
  v_journal_id uuid := gen_random_uuid();
  v_journal_prefix text;
  v_journal_seq_key text;
  v_journal_seq_num bigint;
  v_journal_number text;
  v_liability RECORD;
  v_payment_date date := coalesce(p_payment_date, current_date);
  v_paid_count integer := 0;
BEGIN
  -- Validasi Pegawai & Rekening Kas
  IF p_employee_id IS NULL THEN
    RAISE EXCEPTION 'Pegawai/operator wajib dipilih.';
  END IF;

  IF p_cash_account_id IS NULL THEN
    RAISE EXCEPTION 'Rekening kas/bank penampung pembayaran upah wajib dipilih.';
  END IF;

  IF p_liability_ids IS NULL OR jsonb_typeof(p_liability_ids) <> 'array' OR jsonb_array_length(p_liability_ids) = 0 THEN
    RAISE EXCEPTION 'Pilih minimal satu kewajiban upah yang akan dibayar.';
  END IF;

  SELECT * INTO v_employee
  FROM public.master_record
  WHERE company_id = p_company_id AND id = p_employee_id AND record_kind = 'employee' AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pegawai/operator tidak ditemukan atau tidak aktif.';
  END IF;

  SELECT * INTO v_cash_record
  FROM public.master_record
  WHERE company_id = p_company_id AND id = p_cash_account_id AND record_kind = 'cash_account' AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rekening kas/bank tidak ditemukan atau tidak aktif.';
  END IF;

  IF v_cash_record.ledger_account_id IS NULL THEN
    RAISE EXCEPTION 'Rekening kas/bank belum terhubung dengan akun bagan akun (COA).';
  END IF;

  -- Ambil akun kewajiban upah dari system mapping wage_payable
  SELECT account_id INTO v_wage_payable_account_id
  FROM public.accounting_mapping
  WHERE company_id = p_company_id AND mapping_key = 'wage_payable';

  IF v_wage_payable_account_id IS NULL THEN
    RAISE EXCEPTION 'Pemetaan sistem untuk akun Hutang Upah (wage_payable) belum dikonfigurasi.';
  END IF;

  -- Validasi Periode Akuntansi Terbuka
  v_period_month := to_char(v_payment_date, 'YYYY-MM');
  SELECT * INTO v_period
  FROM public.accounting_period
  WHERE company_id = p_company_id AND period_month = v_period_month;

  IF NOT FOUND OR v_period.status <> 'open' OR v_period.state <> 'open' THEN
    RAISE EXCEPTION 'Periode akuntansi % belum dibuka atau sudah ditutup.', v_period_month;
  END IF;

  -- Hitung total kewajiban upah belum lunas yang dipilih
  SELECT coalesce(sum(gross_amount - paid_amount), 0), count(*)
  INTO v_total_amount, v_paid_count
  FROM public.wage_liability
  WHERE company_id = p_company_id
    AND employee_id = p_employee_id
    AND id IN (SELECT (jsonb_array_elements_text(p_liability_ids))::uuid)
    AND paid_amount < gross_amount;

  IF v_paid_count = 0 OR v_total_amount <= 0 THEN
    RAISE EXCEPTION 'Tidak ditemukan kewajiban upah belum lunas yang cocok dengan pilihan.';
  END IF;

  -- Validasi Saldo Kas
  SELECT coalesce(sum(
    CASE
      WHEN movement_type IN ('receipt', 'revenue', 'income', 'opening_balance', 'transfer_in') THEN amount
      WHEN movement_type IN ('expense', 'disbursement', 'transfer_out') THEN -amount
      WHEN amount < 0 THEN amount
      ELSE amount
    END
  ), 0) INTO v_cash_balance
  FROM public.cash_movement
  WHERE company_id = p_company_id AND cash_account_id = p_cash_account_id;

  IF v_cash_balance < v_total_amount THEN
    RAISE EXCEPTION 'Saldo kas tidak mencukupi untuk pembayaran upah (Saldo: %, Dibutuhkan: %).', v_cash_balance, v_total_amount;
  END IF;

  -- Penomoran Bukti Kas Keluar Upah KK-UP-YYMMDD-###
  v_prefix := 'KK-UP-' || to_char(v_payment_date, 'YYMMDD') || '-';
  v_seq_key := 'wage_payment-' || to_char(v_payment_date, 'YYMMDD');

  INSERT INTO public.document_sequence (
    company_id, sequence_key, prefix, padding, current_number, current_value, updated_at
  ) VALUES (
    p_company_id, v_seq_key, v_prefix, 3, 1, 1, now()
  )
  ON CONFLICT (company_id, sequence_key)
  DO UPDATE SET
    current_number = public.document_sequence.current_number + 1,
    current_value = public.document_sequence.current_value + 1,
    updated_at = now()
  RETURNING current_number INTO v_seq_num;

  v_doc_number := v_prefix || lpad(v_seq_num::text, 3, '0');

  -- Buat Dokumen Pembayaran
  INSERT INTO public.business_document (
    id, company_id, document_kind, document_number, status,
    transaction_date, counterparty_id, total_amount, paid_amount, data,
    posted_at, posted_by_user_id, created_by_user_id, created_at, updated_at
  ) VALUES (
    v_doc_id, p_company_id, 'wage_payment', v_doc_number, 'posted',
    v_payment_date, p_employee_id, v_total_amount, v_total_amount,
    jsonb_build_object(
      'employeeName', v_employee.name,
      'cashAccountId', p_cash_account_id,
      'cashAccountName', v_cash_record.name,
      'paidLiabilityIds', p_liability_ids,
      'notes', coalesce(p_notes, '')
    ),
    now(), p_user_id::text, p_user_id::text, now(), now()
  );

  -- Update Wage Liability menjadi lunas
  UPDATE public.wage_liability
  SET
    paid_amount = gross_amount,
    is_paid = true,
    payment_document_id = v_doc_id
  WHERE company_id = p_company_id
    AND employee_id = p_employee_id
    AND id IN (SELECT (jsonb_array_elements_text(p_liability_ids))::uuid)
    AND paid_amount < gross_amount;

  -- Catat Mutasi Pengeluaran Kas
  INSERT INTO public.cash_movement (
    company_id, cash_account_id, movement_type, transaction_date,
    amount, source_document_id, notes, posted_at, created_at
  ) VALUES (
    p_company_id, p_cash_account_id, 'expense', v_payment_date,
    v_total_amount, v_doc_id, 'Pembayaran upah ' || v_employee.name || ' (' || v_doc_number || ')', now(), now()
  );

  -- Catat Subledger Pelunasan Hutang Upah
  INSERT INTO public.subledger_entry (
    company_id, subledger_kind, subledger_type, counterparty_id,
    source_document_id, transaction_date, amount, debit_amount,
    credit_amount, remaining_balance, status, posted_at, created_at
  ) VALUES (
    p_company_id, 'wage_payable', 'wage_payable', p_employee_id,
    v_doc_id, v_payment_date, -v_total_amount, v_total_amount,
    0, 0, 'closed', now(), now()
  );

  -- Penomoran Jurnal Memorial JU-YYMMDD-###
  v_journal_prefix := 'JU-' || to_char(v_payment_date, 'YYMMDD') || '-';
  v_journal_seq_key := 'journal_entry-' || to_char(v_payment_date, 'YYMMDD');

  INSERT INTO public.document_sequence (
    company_id, sequence_key, prefix, padding, current_number, current_value, updated_at
  ) VALUES (
    p_company_id, v_journal_seq_key, v_journal_prefix, 3, 1, 1, now()
  )
  ON CONFLICT (company_id, sequence_key)
  DO UPDATE SET
    current_number = public.document_sequence.current_number + 1,
    current_value = public.document_sequence.current_value + 1,
    updated_at = now()
  RETURNING current_number INTO v_journal_seq_num;

  v_journal_number := v_journal_prefix || lpad(v_journal_seq_num::text, 3, '0');

  INSERT INTO public.journal_entry (
    id, company_id, entry_number, period_id, source_document_id,
    transaction_date, entry_type, memo, description, status,
    posted_at, created_at
  ) VALUES (
    v_journal_id, p_company_id, v_journal_number, v_period.id, v_doc_id,
    v_payment_date, 'payroll', 'Pembayaran Upah ' || v_doc_number,
    'Pembayaran upah ' || v_employee.name || ' (' || v_doc_number || ')',
    'posted', now(), now()
  );

  -- Line 1: Debit Akun Hutang Upah
  INSERT INTO public.journal_line (
    company_id, journal_entry_id, line_number, account_id,
    debit_amount, credit_amount, debit, credit, description
  ) VALUES (
    p_company_id, v_journal_id, 1, v_wage_payable_account_id,
    v_total_amount, 0, v_total_amount, 0, 'Pelunasan hutang upah ' || v_employee.name
  );

  -- Line 2: Kredit Akun Kas/Bank
  INSERT INTO public.journal_line (
    company_id, journal_entry_id, line_number, account_id,
    debit_amount, credit_amount, debit, credit, description
  ) VALUES (
    p_company_id, v_journal_id, 2, v_cash_record.ledger_account_id,
    0, v_total_amount, 0, v_total_amount, 'Kas/Bank (' || v_cash_record.name || ')'
  );

  RETURN jsonb_build_object(
    'documentId', v_doc_id,
    'documentNumber', v_doc_number,
    'journalId', v_journal_id,
    'journalNumber', v_journal_number,
    'employeeName', v_employee.name,
    'totalAmount', v_total_amount,
    'paidCount', v_paid_count,
    'status', 'posted'
  );
END;
$$;

-- 8. Fungsi Atomik: Mendaftarkan Kontrak Biaya Dibayar Dimuka (Prepaid Expense)
CREATE OR REPLACE FUNCTION public.create_prepaid_expense(
  p_company_id uuid,
  p_description text,
  p_prepaid_account_id uuid,
  p_expense_account_id uuid,
  p_start_date date,
  p_number_of_months integer,
  p_original_amount bigint,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_prepaid_acc RECORD;
  v_expense_acc RECORD;
  v_end_date date;
  v_record RECORD;
BEGIN
  IF p_description IS NULL OR length(btrim(p_description)) = 0 THEN
    RAISE EXCEPTION 'Deskripsi kontrak biaya dibayar dimuka wajib diisi.';
  END IF;

  IF p_original_amount IS NULL OR p_original_amount <= 0 THEN
    RAISE EXCEPTION 'Nominal awal kontrak harus lebih besar dari 0.';
  END IF;

  IF p_number_of_months IS NULL OR p_number_of_months <= 0 THEN
    RAISE EXCEPTION 'Durasi bulan amortisasi harus lebih besar dari 0.';
  END IF;

  -- Validasi Akun Aset Prepaid
  SELECT * INTO v_prepaid_acc
  FROM public.ledger_account
  WHERE company_id = p_company_id AND id = p_prepaid_account_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Akun aset prepaid tidak ditemukan.';
  END IF;

  IF NOT v_prepaid_acc.is_active THEN
    RAISE EXCEPTION 'Akun aset prepaid % (%) tidak aktif.', v_prepaid_acc.code, v_prepaid_acc.name;
  END IF;

  IF v_prepaid_acc.account_type <> 'asset' THEN
    RAISE EXCEPTION 'Akun aset prepaid harus bertipe aset (asset).';
  END IF;

  -- Validasi Akun Beban
  SELECT * INTO v_expense_acc
  FROM public.ledger_account
  WHERE company_id = p_company_id AND id = p_expense_account_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Akun beban tidak ditemukan.';
  END IF;

  IF NOT v_expense_acc.is_active THEN
    RAISE EXCEPTION 'Akun beban % (%) tidak aktif.', v_expense_acc.code, v_expense_acc.name;
  END IF;

  IF v_expense_acc.account_type <> 'expense' THEN
    RAISE EXCEPTION 'Akun beban harus bertipe beban (expense).';
  END IF;

  -- Hitung Tanggal Akhir Periode
  v_end_date := (p_start_date + (p_number_of_months || ' month')::interval - interval '1 day')::date;

  INSERT INTO public.prepaid_expense (
    company_id, description, prepaid_account_id, expense_account_id,
    start_date, end_date, number_of_months, original_amount,
    amortized_amount, status, version, created_at, updated_at
  ) VALUES (
    p_company_id, btrim(p_description), p_prepaid_account_id, p_expense_account_id,
    p_start_date, v_end_date, p_number_of_months, p_original_amount,
    0, 'active', 1, now(), now()
  )
  RETURNING * INTO v_record;

  RETURN to_jsonb(v_record);
END;
$$;

-- 9. Fungsi Atomik: Posting Amortisasi Biaya Dibayar Dimuka Bulanan
CREATE OR REPLACE FUNCTION public.post_prepaid_amortization(
  p_company_id uuid,
  p_prepaid_id uuid,
  p_period_month text,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_prepaid RECORD;
  v_prepaid_acc RECORD;
  v_expense_acc RECORD;
  v_period RECORD;
  v_offset integer;
  v_amortization_amount bigint;
  v_start_year integer;
  v_start_month integer;
  v_target_year integer;
  v_target_month integer;
  v_transaction_date date;
  v_doc_id uuid := gen_random_uuid();
  v_doc_number text;
  v_prefix text;
  v_seq_key text;
  v_seq_num bigint;
  v_journal_id uuid := gen_random_uuid();
  v_journal_prefix text;
  v_journal_seq_key text;
  v_journal_seq_num bigint;
  v_journal_number text;
BEGIN
  -- Validasi Format Bulan (YYYY-MM)
  IF p_period_month IS NULL OR NOT (p_period_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$') THEN
    RAISE EXCEPTION 'Format periode bulan tidak valid (harus YYYY-MM).';
  END IF;

  -- Validasi Periode Akuntansi Terbuka
  SELECT * INTO v_period
  FROM public.accounting_period
  WHERE company_id = p_company_id AND period_month = p_period_month;

  IF NOT FOUND OR v_period.status <> 'open' OR v_period.state <> 'open' THEN
    RAISE EXCEPTION 'Periode akuntansi % belum dibuka atau sudah ditutup.', p_period_month;
  END IF;

  -- Kunci Jadwal Prepaid
  SELECT * INTO v_prepaid
  FROM public.prepaid_expense
  WHERE company_id = p_company_id AND id = p_prepaid_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Kontrak biaya dibayar dimuka tidak ditemukan.';
  END IF;

  IF v_prepaid.status <> 'active' THEN
    RAISE EXCEPTION 'Kontrak biaya dibayar dimuka tidak aktif (status: %).', v_prepaid.status;
  END IF;

  -- Validasi Akun Aset dan Beban
  SELECT * INTO v_prepaid_acc
  FROM public.ledger_account
  WHERE company_id = p_company_id AND id = v_prepaid.prepaid_account_id;

  IF NOT FOUND OR NOT v_prepaid_acc.is_active OR v_prepaid_acc.account_type <> 'asset' THEN
    RAISE EXCEPTION 'Akun aset prepaid harus aktif dan bertipe aset.';
  END IF;

  SELECT * INTO v_expense_acc
  FROM public.ledger_account
  WHERE company_id = p_company_id AND id = v_prepaid.expense_account_id;

  IF NOT FOUND OR NOT v_expense_acc.is_active OR v_expense_acc.account_type <> 'expense' THEN
    RAISE EXCEPTION 'Akun beban amortisasi harus aktif dan bertipe beban.';
  END IF;

  -- Mencegah Double Posting
  IF EXISTS (
    SELECT 1 FROM public.prepaid_amortization_entry
    WHERE company_id = p_company_id
      AND prepaid_expense_id = p_prepaid_id
      AND period_month = p_period_month
  ) THEN
    RAISE EXCEPTION 'Amortisasi untuk periode % sudah pernah diposting.', p_period_month;
  END IF;

  -- Hitung Offset Bulan
  v_start_year := substring(v_prepaid.start_date::text from 1 for 4)::integer;
  v_start_month := substring(v_prepaid.start_date::text from 6 for 2)::integer;
  v_target_year := substring(p_period_month from 1 for 4)::integer;
  v_target_month := substring(p_period_month from 6 for 2)::integer;
  v_offset := (v_target_year - v_start_year) * 12 + (v_target_month - v_start_month);

  IF v_offset < 0 OR v_offset >= v_prepaid.number_of_months THEN
    RAISE EXCEPTION 'Periode % berada di luar rentang jadwal kontrak prepaid.', p_period_month;
  END IF;

  -- Hitung Nilai Amortisasi Bulanan
  IF v_offset = v_prepaid.number_of_months - 1 THEN
    v_amortization_amount := v_prepaid.original_amount - v_prepaid.amortized_amount;
  ELSE
    v_amortization_amount := round(v_prepaid.original_amount::numeric / v_prepaid.number_of_months);
    IF v_amortization_amount > (v_prepaid.original_amount - v_prepaid.amortized_amount) THEN
      v_amortization_amount := v_prepaid.original_amount - v_prepaid.amortized_amount;
    END IF;
  END IF;

  IF v_amortization_amount <= 0 THEN
    RAISE EXCEPTION 'Sisa amortisasi sudah habis.';
  END IF;

  v_transaction_date := to_date(p_period_month || '-01', 'YYYY-MM-DD');

  -- Penomoran Bukti Amortisasi AM-YYMMDD-###
  v_prefix := 'AM-' || to_char(v_transaction_date, 'YYMMDD') || '-';
  v_seq_key := 'prepaid_amortization-' || to_char(v_transaction_date, 'YYMMDD');

  INSERT INTO public.document_sequence (
    company_id, sequence_key, prefix, padding, current_number, current_value, updated_at
  ) VALUES (
    p_company_id, v_seq_key, v_prefix, 3, 1, 1, now()
  )
  ON CONFLICT (company_id, sequence_key)
  DO UPDATE SET
    current_number = public.document_sequence.current_number + 1,
    current_value = public.document_sequence.current_value + 1,
    updated_at = now()
  RETURNING current_number INTO v_seq_num;

  v_doc_number := v_prefix || lpad(v_seq_num::text, 3, '0');

  -- Dokumen Business Document
  INSERT INTO public.business_document (
    id, company_id, document_kind, document_number, status,
    transaction_date, total_amount, paid_amount, data,
    posted_at, posted_by_user_id, created_by_user_id, created_at, updated_at
  ) VALUES (
    v_doc_id, p_company_id, 'prepaid_amortization', v_doc_number, 'posted',
    v_transaction_date, v_amortization_amount, v_amortization_amount,
    jsonb_build_object(
      'prepaidExpenseId', p_prepaid_id,
      'periodMonth', p_period_month,
      'description', v_prepaid.description
    ),
    now(), p_user_id::text, p_user_id::text, now(), now()
  );

  -- Entri Amortisasi Tabel prepaid_amortization_entry
  INSERT INTO public.prepaid_amortization_entry (
    company_id, prepaid_expense_id, period_month, amount,
    source_document_id, posted_at
  ) VALUES (
    p_company_id, p_prepaid_id, p_period_month, v_amortization_amount,
    v_doc_id, now()
  );

  -- Update Akumulasi Amortisasi
  UPDATE public.prepaid_expense
  SET
    amortized_amount = amortized_amount + v_amortization_amount,
    status = CASE WHEN amortized_amount + v_amortization_amount >= original_amount THEN 'completed' ELSE 'active' END,
    version = version + 1,
    updated_at = now()
  WHERE id = p_prepaid_id;

  -- Penomoran Jurnal Memorial JU-YYMMDD-###
  v_journal_prefix := 'JU-' || to_char(v_transaction_date, 'YYMMDD') || '-';
  v_journal_seq_key := 'journal_entry-' || to_char(v_transaction_date, 'YYMMDD');

  INSERT INTO public.document_sequence (
    company_id, sequence_key, prefix, padding, current_number, current_value, updated_at
  ) VALUES (
    p_company_id, v_journal_seq_key, v_journal_prefix, 3, 1, 1, now()
  )
  ON CONFLICT (company_id, sequence_key)
  DO UPDATE SET
    current_number = public.document_sequence.current_number + 1,
    current_value = public.document_sequence.current_value + 1,
    updated_at = now()
  RETURNING current_number INTO v_journal_seq_num;

  v_journal_number := v_journal_prefix || lpad(v_journal_seq_num::text, 3, '0');

  INSERT INTO public.journal_entry (
    id, company_id, entry_number, period_id, source_document_id,
    transaction_date, entry_type, memo, description, status,
    posted_at, created_at
  ) VALUES (
    v_journal_id, p_company_id, v_journal_number, v_period.id, v_doc_id,
    v_transaction_date, 'amortization', 'Amortisasi Prepaid ' || v_doc_number,
    'Amortisasi ' || v_prepaid.description || ' periode ' || p_period_month,
    'posted', now(), now()
  );

  -- Line 1: Debit Akun Beban
  INSERT INTO public.journal_line (
    company_id, journal_entry_id, line_number, account_id,
    debit_amount, credit_amount, debit, credit, description
  ) VALUES (
    p_company_id, v_journal_id, 1, v_prepaid.expense_account_id,
    v_amortization_amount, 0, v_amortization_amount, 0,
    'Beban Amortisasi: ' || v_prepaid.description
  );

  -- Line 2: Kredit Akun Aset Prepaid
  INSERT INTO public.journal_line (
    company_id, journal_entry_id, line_number, account_id,
    debit_amount, credit_amount, debit, credit, description
  ) VALUES (
    p_company_id, v_journal_id, 2, v_prepaid.prepaid_account_id,
    0, v_amortization_amount, 0, v_amortization_amount,
    'Amortisasi Prepaid: ' || v_prepaid.description
  );

  RETURN jsonb_build_object(
    'documentId', v_doc_id,
    'documentNumber', v_doc_number,
    'journalId', v_journal_id,
    'journalNumber', v_journal_number,
    'amount', v_amortization_amount,
    'periodMonth', p_period_month,
    'status', 'posted'
  );
END;
$$;

-- 10. Fungsi Atomik: Posting Saldo Awal Neraca & Kas (Post Opening Balance)
CREATE OR REPLACE FUNCTION public.post_opening_balance(
  p_company_id uuid,
  p_balance_date date,
  p_notes text DEFAULT NULL,
  p_lines jsonb DEFAULT '[]'::jsonb,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_period RECORD;
  v_period_month text;
  v_total_debit bigint := 0;
  v_total_credit bigint := 0;
  v_line jsonb;
  v_account_id uuid;
  v_debit bigint;
  v_credit bigint;
  v_desc text;
  v_cash_account_id uuid;
  v_account RECORD;
  v_doc_id uuid := gen_random_uuid();
  v_doc_number text;
  v_prefix text;
  v_seq_key text;
  v_seq_num bigint;
  v_journal_id uuid := gen_random_uuid();
  v_journal_prefix text;
  v_journal_seq_key text;
  v_journal_seq_num bigint;
  v_journal_number text;
  v_line_idx integer := 1;
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Saldo awal wajib memiliki minimal satu baris akun.';
  END IF;

  v_period_month := to_char(p_balance_date, 'YYYY-MM');
  SELECT * INTO v_period
  FROM public.accounting_period
  WHERE company_id = p_company_id AND period_month = v_period_month
  FOR UPDATE;

  IF NOT FOUND OR v_period.status <> 'open' OR v_period.state <> 'open' THEN
    RAISE EXCEPTION 'Periode akuntansi % belum dibuka atau sudah ditutup.', v_period_month;
  END IF;

  IF v_period.opening_state = 'posted' THEN
    RAISE EXCEPTION 'Saldo awal untuk periode % sudah pernah diposting.', v_period_month;
  END IF;

  -- Validasi Setiap Baris Akun & Keseimbangan Debit/Kredit
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_account_id := (v_line->>'account_id')::uuid;
    v_debit := coalesce((v_line->>'debit')::bigint, 0);
    v_credit := coalesce((v_line->>'credit')::bigint, 0);
    v_desc := coalesce(v_line->>'description', 'Saldo Awal');

    IF v_account_id IS NULL THEN
      RAISE EXCEPTION 'ID akun pada baris % wajib diisi.', v_line_idx;
    END IF;

    IF v_debit < 0 OR v_credit < 0 THEN
      RAISE EXCEPTION 'Nilai debit dan kredit tidak boleh negatif pada baris %.', v_line_idx;
    END IF;

    IF (v_debit = 0 AND v_credit = 0) OR (v_debit > 0 AND v_credit > 0) THEN
      RAISE EXCEPTION 'Baris % wajib memilih satu sisi: Debit atau Kredit bernilai positif.', v_line_idx;
    END IF;

    SELECT * INTO v_account
    FROM public.ledger_account
    WHERE company_id = p_company_id AND id = v_account_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Akun COA pada baris % tidak ditemukan.', v_line_idx;
    END IF;

    IF NOT v_account.is_active THEN
      RAISE EXCEPTION 'Akun COA % (%) tidak aktif.', v_account.code, v_account.name;
    END IF;

    IF v_account.account_type NOT IN ('asset', 'liability', 'equity') THEN
      RAISE EXCEPTION 'Akun saldo awal harus berupa akun neraca (Aset, Kewajiban, atau Modal). Akun % bertipe %.',
        v_account.code, v_account.account_type;
    END IF;

    v_total_debit := v_total_debit + v_debit;
    v_total_credit := v_total_credit + v_credit;
    v_line_idx := v_line_idx + 1;
  END LOOP;

  -- Validasi Keseimbangan Total Debit = Total Kredit
  IF v_total_debit <> v_total_credit THEN
    RAISE EXCEPTION 'Total Debit (%) dan Total Kredit (%) tidak seimbang.', v_total_debit, v_total_credit;
  END IF;

  IF v_total_debit <= 0 THEN
    RAISE EXCEPTION 'Total saldo awal harus lebih besar dari 0.';
  END IF;

  -- Penomoran Dokumen SA-YYMMDD-###
  v_prefix := 'SA-' || to_char(p_balance_date, 'YYMMDD') || '-';
  v_seq_key := 'opening_balance-' || to_char(p_balance_date, 'YYMMDD');

  INSERT INTO public.document_sequence (
    company_id, sequence_key, prefix, padding, current_number, current_value, updated_at
  ) VALUES (
    p_company_id, v_seq_key, v_prefix, 3, 1, 1, now()
  )
  ON CONFLICT (company_id, sequence_key)
  DO UPDATE SET
    current_number = public.document_sequence.current_number + 1,
    current_value = public.document_sequence.current_value + 1,
    updated_at = now()
  RETURNING current_number INTO v_seq_num;

  v_doc_number := v_prefix || lpad(v_seq_num::text, 3, '0');

  -- Header Business Document
  INSERT INTO public.business_document (
    id, company_id, document_kind, document_number, status,
    transaction_date, total_amount, paid_amount, data,
    posted_at, posted_by_user_id, created_by_user_id, created_at, updated_at
  ) VALUES (
    v_doc_id, p_company_id, 'opening_balance', v_doc_number, 'posted',
    p_balance_date, v_total_debit, v_total_debit,
    jsonb_build_object('notes', coalesce(p_notes, '')),
    now(), p_user_id::text, p_user_id::text, now(), now()
  );

  -- Baris Dokumen & Mutasi Kas jika ada
  v_line_idx := 1;
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_account_id := (v_line->>'account_id')::uuid;
    v_debit := coalesce((v_line->>'debit')::bigint, 0);
    v_credit := coalesce((v_line->>'credit')::bigint, 0);
    v_desc := coalesce(v_line->>'description', 'Saldo Awal');

    INSERT INTO public.business_document_line (
      company_id, document_id, line_number, account_id,
      description, quantity, unit_price, subtotal, total_amount, created_at
    ) VALUES (
      p_company_id, v_doc_id, v_line_idx, v_account_id,
      v_desc, 1, greatest(v_debit, v_credit), greatest(v_debit, v_credit), greatest(v_debit, v_credit), now()
    );

    -- Cek apakah akun ini terhubung ke master rekening kas
    SELECT id INTO v_cash_account_id
    FROM public.master_record
    WHERE company_id = p_company_id AND record_kind = 'cash_account' AND ledger_account_id = v_account_id AND is_active = true
    LIMIT 1;

    IF v_cash_account_id IS NOT NULL THEN
      INSERT INTO public.cash_movement (
        company_id, cash_account_id, movement_type, transaction_date,
        amount, source_document_id, notes, posted_at, created_at
      ) VALUES (
        p_company_id, v_cash_account_id, 'opening_balance', p_balance_date,
        (v_debit - v_credit), v_doc_id, 'Saldo awal kas ' || v_doc_number, now(), now()
      );
    END IF;

    v_line_idx := v_line_idx + 1;
  END LOOP;

  -- Penomoran Jurnal JU-YYMMDD-###
  v_journal_prefix := 'JU-' || to_char(p_balance_date, 'YYMMDD') || '-';
  v_journal_seq_key := 'journal_entry-' || to_char(p_balance_date, 'YYMMDD');

  INSERT INTO public.document_sequence (
    company_id, sequence_key, prefix, padding, current_number, current_value, updated_at
  ) VALUES (
    p_company_id, v_journal_seq_key, v_journal_prefix, 3, 1, 1, now()
  )
  ON CONFLICT (company_id, sequence_key)
  DO UPDATE SET
    current_number = public.document_sequence.current_number + 1,
    current_value = public.document_sequence.current_value + 1,
    updated_at = now()
  RETURNING current_number INTO v_journal_seq_num;

  v_journal_number := v_journal_prefix || lpad(v_journal_seq_num::text, 3, '0');

  INSERT INTO public.journal_entry (
    id, company_id, entry_number, period_id, source_document_id,
    transaction_date, entry_type, memo, description, status,
    posted_at, created_at
  ) VALUES (
    v_journal_id, p_company_id, v_journal_number, v_period.id, v_doc_id,
    p_balance_date, 'opening', 'Saldo Awal ' || v_doc_number,
    'Pencatatan saldo awal neraca ' || v_doc_number,
    'posted', now(), now()
  );

  v_line_idx := 1;
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_account_id := (v_line->>'account_id')::uuid;
    v_debit := coalesce((v_line->>'debit')::bigint, 0);
    v_credit := coalesce((v_line->>'credit')::bigint, 0);
    v_desc := coalesce(v_line->>'description', 'Saldo Awal');

    INSERT INTO public.journal_line (
      company_id, journal_entry_id, line_number, account_id,
      debit_amount, credit_amount, debit, credit, description
    ) VALUES (
      p_company_id, v_journal_id, v_line_idx, v_account_id,
      v_debit, v_credit, v_debit, v_credit, v_desc
    );
    v_line_idx := v_line_idx + 1;
  END LOOP;

  -- Update Periode Akuntansi: opening_state = 'posted'
  UPDATE public.accounting_period
  SET
    opening_state = 'posted',
    version = version + 1,
    updated_at = now()
  WHERE id = v_period.id;

  RETURN jsonb_build_object(
    'documentId', v_doc_id,
    'documentNumber', v_doc_number,
    'journalId', v_journal_id,
    'journalNumber', v_journal_number,
    'totalAmount', v_total_debit,
    'status', 'posted'
  );
END;
$$;

-- 11. Fungsi Atomik: Posting Jurnal Manual / Memorial (Post Manual Journal)
CREATE OR REPLACE FUNCTION public.post_manual_journal(
  p_company_id uuid,
  p_transaction_date date,
  p_description text,
  p_lines jsonb,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_period RECORD;
  v_period_month text;
  v_total_debit bigint := 0;
  v_total_credit bigint := 0;
  v_line jsonb;
  v_account_id uuid;
  v_debit bigint;
  v_credit bigint;
  v_desc text;
  v_account RECORD;
  v_doc_id uuid := gen_random_uuid();
  v_doc_number text;
  v_prefix text;
  v_seq_key text;
  v_seq_num bigint;
  v_journal_id uuid := gen_random_uuid();
  v_line_idx integer := 1;
BEGIN
  IF p_description IS NULL OR length(btrim(p_description)) < 5 THEN
    RAISE EXCEPTION 'Keterangan jurnal manual wajib diisi minimal 5 karakter.';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'Jurnal memorial wajib memiliki minimal dua baris akun (Debit & Kredit seimbang).';
  END IF;

  -- Validasi Periode Akuntansi Terbuka
  v_period_month := to_char(p_transaction_date, 'YYYY-MM');
  SELECT * INTO v_period
  FROM public.accounting_period
  WHERE company_id = p_company_id AND period_month = v_period_month;

  IF NOT FOUND OR v_period.status <> 'open' OR v_period.state <> 'open' THEN
    RAISE EXCEPTION 'Periode akuntansi % belum dibuka atau sudah ditutup.', v_period_month;
  END IF;

  -- Validasi Tiap Baris Akun
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_account_id := (v_line->>'account_id')::uuid;
    v_debit := coalesce((v_line->>'debit')::bigint, 0);
    v_credit := coalesce((v_line->>'credit')::bigint, 0);
    v_desc := coalesce(v_line->>'description', p_description);

    IF v_account_id IS NULL THEN
      RAISE EXCEPTION 'ID akun pada baris % wajib diisi.', v_line_idx;
    END IF;

    IF v_debit < 0 OR v_credit < 0 THEN
      RAISE EXCEPTION 'Nilai debit dan kredit tidak boleh negatif pada baris %.', v_line_idx;
    END IF;

    IF (v_debit = 0 AND v_credit = 0) OR (v_debit > 0 AND v_credit > 0) THEN
      RAISE EXCEPTION 'Baris % wajib memilih satu sisi: Debit atau Kredit bernilai positif.', v_line_idx;
    END IF;

    SELECT * INTO v_account
    FROM public.ledger_account
    WHERE company_id = p_company_id AND id = v_account_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Akun COA pada baris % tidak ditemukan.', v_line_idx;
    END IF;

    IF NOT v_account.is_active THEN
      RAISE EXCEPTION 'Akun COA % (%) tidak aktif.', v_account.code, v_account.name;
    END IF;

    -- Dilarang memilih akun virtual presentation-only (3-3.0.00 — Laba Tahun Berjalan)
    IF v_account.code = '3-3.0.00' THEN
      RAISE EXCEPTION 'Akun 3-3.0.00 (Laba Tahun Berjalan) adalah akun virtual presentasi laporan dan dilarang sebagai target posting jurnal.';
    END IF;

    v_total_debit := v_total_debit + v_debit;
    v_total_credit := v_total_credit + v_credit;
    v_line_idx := v_line_idx + 1;
  END LOOP;

  -- Validasi Keseimbangan Total Debit = Total Kredit
  IF v_total_debit <> v_total_credit THEN
    RAISE EXCEPTION 'Total Debit (%) dan Total Kredit (%) tidak seimbang.', v_total_debit, v_total_credit;
  END IF;

  IF v_total_debit <= 0 THEN
    RAISE EXCEPTION 'Total nominal jurnal harus lebih besar dari 0.';
  END IF;

  -- Penomoran Jurnal Memorial JU-YYMMDD-###
  v_prefix := 'JU-' || to_char(p_transaction_date, 'YYMMDD') || '-';
  v_seq_key := 'journal_entry-' || to_char(p_transaction_date, 'YYMMDD');

  INSERT INTO public.document_sequence (
    company_id, sequence_key, prefix, padding, current_number, current_value, updated_at
  ) VALUES (
    p_company_id, v_seq_key, v_prefix, 3, 1, 1, now()
  )
  ON CONFLICT (company_id, sequence_key)
  DO UPDATE SET
    current_number = public.document_sequence.current_number + 1,
    current_value = public.document_sequence.current_value + 1,
    updated_at = now()
  RETURNING current_number INTO v_seq_num;

  v_doc_number := v_prefix || lpad(v_seq_num::text, 3, '0');

  -- Header Business Document
  INSERT INTO public.business_document (
    id, company_id, document_kind, document_number, status,
    transaction_date, total_amount, paid_amount, data,
    posted_at, posted_by_user_id, created_by_user_id, created_at, updated_at
  ) VALUES (
    v_doc_id, p_company_id, 'manual_journal', v_doc_number, 'posted',
    p_transaction_date, v_total_debit, v_total_debit,
    jsonb_build_object('description', btrim(p_description)),
    now(), p_user_id::text, p_user_id::text, now(), now()
  );

  -- Journal Entry
  INSERT INTO public.journal_entry (
    id, company_id, entry_number, period_id, source_document_id,
    transaction_date, entry_type, memo, description, status,
    posted_at, created_at
  ) VALUES (
    v_journal_id, p_company_id, v_doc_number, v_period.id, v_doc_id,
    p_transaction_date, 'general', btrim(p_description), btrim(p_description),
    'posted', now(), now()
  );

  -- Journal Lines
  v_line_idx := 1;
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_account_id := (v_line->>'account_id')::uuid;
    v_debit := coalesce((v_line->>'debit')::bigint, 0);
    v_credit := coalesce((v_line->>'credit')::bigint, 0);
    v_desc := coalesce(v_line->>'description', p_description);

    INSERT INTO public.journal_line (
      company_id, journal_entry_id, line_number, account_id,
      debit_amount, credit_amount, debit, credit, description
    ) VALUES (
      p_company_id, v_journal_id, v_line_idx, v_account_id,
      v_debit, v_credit, v_debit, v_credit, v_desc
    );

    INSERT INTO public.business_document_line (
      company_id, document_id, line_number, account_id,
      description, quantity, unit_price, subtotal, total_amount, created_at
    ) VALUES (
      p_company_id, v_doc_id, v_line_idx, v_account_id,
      v_desc, 1, greatest(v_debit, v_credit), greatest(v_debit, v_credit), greatest(v_debit, v_credit), now()
    );

    v_line_idx := v_line_idx + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'journalId', v_journal_id,
    'documentId', v_doc_id,
    'entryNumber', v_doc_number,
    'totalAmount', v_total_debit,
    'status', 'posted'
  );
END;
$$;

-- 12. Fungsi Atomik: Membalikkan Jurnal Manual (Reverse Manual Journal)
CREATE OR REPLACE FUNCTION public.reverse_manual_journal(
  p_company_id uuid,
  p_journal_id uuid,
  p_reason text,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_orig_journal RECORD;
  v_period RECORD;
  v_period_month text;
  v_rev_journal_id uuid := gen_random_uuid();
  v_prefix text;
  v_seq_key text;
  v_seq_num bigint;
  v_rev_entry_number text;
  v_line RECORD;
  v_line_idx integer := 1;
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'Alasan pembalikan jurnal wajib diisi minimal 5 karakter.';
  END IF;

  SELECT * INTO v_orig_journal
  FROM public.journal_entry
  WHERE company_id = p_company_id AND id = p_journal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jurnal umum dengan ID % tidak ditemukan.', p_journal_id;
  END IF;

  IF v_orig_journal.status <> 'posted' THEN
    RAISE EXCEPTION 'Hanya jurnal berstatus posted yang dapat dibalikkan.';
  END IF;

  IF v_orig_journal.is_closing_entry THEN
    RAISE EXCEPTION 'Jurnal penutup periode tidak dapat dibalik secara langsung.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.journal_entry
    WHERE company_id = p_company_id AND reversal_of_id = p_journal_id
  ) THEN
    RAISE EXCEPTION 'Jurnal ini sudah pernah dibalik sebelumnya.';
  END IF;

  -- Validasi Periode Akuntansi Terbuka
  v_period_month := to_char(current_date, 'YYYY-MM');
  SELECT * INTO v_period
  FROM public.accounting_period
  WHERE company_id = p_company_id AND period_month = v_period_month;

  IF NOT FOUND OR v_period.status <> 'open' OR v_period.state <> 'open' THEN
    RAISE EXCEPTION 'Periode akuntansi aktif % tertutup; pembalikan jurnal tidak dapat diproses.', v_period_month;
  END IF;

  -- Penomoran Jurnal Pembalik JU-YYMMDD-###
  v_prefix := 'JU-' || to_char(current_date, 'YYMMDD') || '-';
  v_seq_key := 'journal_entry-' || to_char(current_date, 'YYMMDD');

  INSERT INTO public.document_sequence (
    company_id, sequence_key, prefix, padding, current_number, current_value, updated_at
  ) VALUES (
    p_company_id, v_seq_key, v_prefix, 3, 1, 1, now()
  )
  ON CONFLICT (company_id, sequence_key)
  DO UPDATE SET
    current_number = public.document_sequence.current_number + 1,
    current_value = public.document_sequence.current_value + 1,
    updated_at = now()
  RETURNING current_number INTO v_seq_num;

  v_rev_entry_number := v_prefix || lpad(v_seq_num::text, 3, '0');

  INSERT INTO public.journal_entry (
    id, company_id, entry_number, period_id, source_document_id,
    transaction_date, entry_type, memo, description, status,
    reversal_of_id, posted_at, created_at
  ) VALUES (
    v_rev_journal_id, p_company_id, v_rev_entry_number, v_period.id, v_orig_journal.source_document_id,
    current_date, 'reversal', 'Pembalik ' || v_orig_journal.entry_number,
    'Pembalik ' || v_orig_journal.entry_number || ': ' || btrim(p_reason),
    'posted', v_orig_journal.id, now(), now()
  );

  FOR v_line IN
    SELECT * FROM public.journal_line
    WHERE journal_entry_id = v_orig_journal.id AND company_id = p_company_id
    ORDER BY line_number ASC
  LOOP
    INSERT INTO public.journal_line (
      company_id, journal_entry_id, line_number, account_id,
      debit_amount, credit_amount, debit, credit, description
    ) VALUES (
      p_company_id, v_rev_journal_id, v_line_idx, v_line.account_id,
      v_line.credit_amount, v_line.debit_amount, v_line.credit, v_line.debit,
      'Pembalik: ' || coalesce(v_line.description, '')
    );
    v_line_idx := v_line_idx + 1;
  END LOOP;

  IF v_orig_journal.source_document_id IS NOT NULL THEN
    UPDATE public.business_document
    SET
      status = 'void',
      void_reason = p_reason,
      voided_at = now(),
      voided_by_user_id = p_user_id::text,
      version = version + 1,
      updated_at = now()
    WHERE id = v_orig_journal.source_document_id AND document_kind = 'manual_journal';
  END IF;

  RETURN jsonb_build_object(
    'originalJournalId', p_journal_id,
    'reversalJournalId', v_rev_journal_id,
    'reversalEntryNumber', v_rev_entry_number,
    'status', 'posted'
  );
END;
$$;

-- 13. Fungsi Atomik: Penutupan Periode Akuntansi (Close Accounting Period)
CREATE OR REPLACE FUNCTION public.close_accounting_period(
  p_company_id uuid,
  p_period_month text,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_period RECORD;
  v_total_debit bigint;
  v_total_credit bigint;
  v_draft_count bigint;
  v_cash_diff_count integer := 0;
  v_subledger_diff_count integer := 0;
  v_close_summary jsonb;
BEGIN
  SELECT * INTO v_period
  FROM public.accounting_period
  WHERE company_id = p_company_id AND period_month = p_period_month
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Periode akuntansi % tidak ditemukan.', p_period_month;
  END IF;

  IF v_period.state = 'closed' OR v_period.status = 'closed' THEN
    RAISE EXCEPTION 'Periode akuntansi % sudah dalam kondisi tertutup.', p_period_month;
  END IF;

  -- 1. Pengecekan Keseimbangan Jurnal Umum
  SELECT coalesce(sum(jl.debit), 0), coalesce(sum(jl.credit), 0)
  INTO v_total_debit, v_total_credit
  FROM public.journal_line jl
  JOIN public.journal_entry je ON je.id = jl.journal_entry_id AND je.company_id = jl.company_id
  WHERE je.company_id = p_company_id
    AND je.period_id = v_period.id
    AND je.status = 'posted';

  IF v_total_debit <> v_total_credit THEN
    RAISE EXCEPTION 'Kontrol integritas gagal: Jurnal umum periode % tidak seimbang (Total Debit: %, Total Kredit: %).',
      p_period_month, v_total_debit, v_total_credit;
  END IF;

  -- 2. Pengecekan Transaksi Draf Gantung
  SELECT count(*) INTO v_draft_count
  FROM public.business_document
  WHERE company_id = p_company_id
    AND status = 'draft'
    AND to_char(transaction_date, 'YYYY-MM') = p_period_month;

  IF v_draft_count > 0 THEN
    RAISE EXCEPTION 'Kontrol integritas gagal: Masih terdapat % dokumen draf transaksi yang belum diselesaikan pada periode %.',
      v_draft_count, p_period_month;
  END IF;

  -- 3. Rekonsiliasi Kas/Bank: Saldo Buku Mutasi Kas vs Buku Besar Kas
  SELECT count(*) INTO v_cash_diff_count
  FROM (
    SELECT
      mr.id AS cash_account_id,
      mr.name,
      coalesce(sum(
        CASE
          WHEN cm.movement_type IN ('receipt', 'revenue', 'income', 'opening_balance', 'transfer_in') THEN cm.amount
          WHEN cm.movement_type IN ('expense', 'disbursement', 'transfer_out') THEN -cm.amount
          WHEN cm.amount < 0 THEN cm.amount
          ELSE cm.amount
        END
      ), 0) AS subledger_cash_balance,
      coalesce(gl.gl_balance, 0) AS gl_cash_balance
    FROM public.master_record mr
    LEFT JOIN public.cash_movement cm ON cm.cash_account_id = mr.id AND cm.company_id = mr.company_id
      AND to_char(cm.transaction_date, 'YYYY-MM') <= p_period_month
    LEFT JOIN (
      SELECT jl.account_id, coalesce(sum(jl.debit - jl.credit), 0) AS gl_balance
      FROM public.journal_line jl
      JOIN public.journal_entry je ON je.id = jl.journal_entry_id AND je.company_id = jl.company_id
      WHERE je.company_id = p_company_id
        AND to_char(je.transaction_date, 'YYYY-MM') <= p_period_month
        AND je.status = 'posted'
      GROUP BY jl.account_id
    ) gl ON gl.account_id = mr.ledger_account_id
    WHERE mr.company_id = p_company_id
      AND mr.record_kind = 'cash_account'
      AND mr.is_active = true
      AND mr.ledger_account_id IS NOT NULL
    GROUP BY mr.id, mr.name, gl.gl_balance
    HAVING coalesce(sum(
      CASE
        WHEN cm.movement_type IN ('receipt', 'revenue', 'income', 'opening_balance', 'transfer_in') THEN cm.amount
        WHEN cm.movement_type IN ('expense', 'disbursement', 'transfer_out') THEN -cm.amount
        WHEN cm.amount < 0 THEN cm.amount
        ELSE cm.amount
      END
    ), 0) <> coalesce(gl.gl_balance, 0)
  ) diff;

  IF v_cash_diff_count > 0 THEN
    RAISE EXCEPTION 'Kontrol integritas gagal: Terdapat % rekening kas/bank yang tidak sesuai dengan saldo buku besar.', v_cash_diff_count;
  END IF;

  -- Susun Ringkasan Audit Penutupan Buku
  v_close_summary := jsonb_build_object(
    'periodMonth', p_period_month,
    'totalDebit', v_total_debit,
    'totalCredit', v_total_credit,
    'pendingDrafts', 0,
    'cashReconciliation', 'balanced',
    'closedAt', now(),
    'closedByUserId', p_user_id
  );

  -- Kunci Periode Akuntansi
  UPDATE public.accounting_period
  SET
    status = 'closed',
    state = 'closed',
    closed_at = now(),
    closed_by_user_id = p_user_id::text,
    close_summary = v_close_summary,
    version = version + 1,
    updated_at = now()
  WHERE id = v_period.id;

  RETURN jsonb_build_object(
    'periodId', v_period.id,
    'periodMonth', p_period_month,
    'status', 'closed',
    'closeSummary', v_close_summary
  );
END;
$$;

-- 14. Fungsi Atomik: Membuka Kembali Periode Akuntansi (Reopen Accounting Period)
CREATE OR REPLACE FUNCTION public.reopen_accounting_period(
  p_company_id uuid,
  p_period_month text,
  p_reason text,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_period RECORD;
BEGIN
  -- Validasi Otorisasi Khusus Pemilik Perusahaan (Owner)
  IF NOT public.is_company_owner(p_company_id, p_user_id) THEN
    RAISE EXCEPTION 'Hanya Pemilik Perusahaan (Owner) yang berwenang membuka kembali periode akuntansi yang telah ditutup.';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'Alasan pembukaan kembali periode akuntansi wajib diisi minimal 5 karakter.';
  END IF;

  SELECT * INTO v_period
  FROM public.accounting_period
  WHERE company_id = p_company_id AND period_month = p_period_month
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Periode akuntansi % tidak ditemukan.', p_period_month;
  END IF;

  IF v_period.state <> 'closed' AND v_period.status <> 'closed' THEN
    RAISE EXCEPTION 'Periode akuntansi % tidak dalam kondisi tertutup.', p_period_month;
  END IF;

  UPDATE public.accounting_period
  SET
    status = 'open',
    state = 'open',
    reopened_at = now(),
    reopened_by_user_id = p_user_id::text,
    reopen_reason = btrim(p_reason),
    version = version + 1,
    updated_at = now()
  WHERE id = v_period.id;

  RETURN jsonb_build_object(
    'periodId', v_period.id,
    'periodMonth', p_period_month,
    'status', 'open',
    'reopenReason', btrim(p_reason),
    'reopenedAt', now()
  );
END;
$$;

-- Hak Akses Eksekusi Fungsi
GRANT EXECUTE ON FUNCTION public.update_ledger_account_status(uuid, uuid, boolean, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_accounting_mappings(uuid, jsonb, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_report_account_mappings(uuid, jsonb, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_cash_transfer(uuid, uuid, uuid, bigint, date, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_operating_expense(uuid, text, uuid, uuid, date, text, jsonb, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.void_operating_expense(uuid, uuid, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_wage_payment(uuid, uuid, uuid, date, jsonb, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_prepaid_expense(uuid, text, uuid, uuid, date, integer, bigint, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_prepaid_amortization(uuid, uuid, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_opening_balance(uuid, date, text, jsonb, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_manual_journal(uuid, date, text, jsonb, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reverse_manual_journal(uuid, uuid, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.close_accounting_period(uuid, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reopen_accounting_period(uuid, text, text, uuid) TO authenticated, service_role;
