-- ==============================================================================
-- Migrasi 000007: Stored Procedures & Atomic Functions Fixed Assets & Depreciation
-- ==============================================================================

-- 1. Fungsi Atomik: Buat Pengadaan Aset Tetap (Asset Purchase - Draft)
CREATE OR REPLACE FUNCTION public.create_asset_purchase(
  p_company_id uuid,
  p_supplier_id uuid,
  p_transaction_date date,
  p_notes text,
  p_lines jsonb,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_supplier RECORD;
  v_doc_id uuid := gen_random_uuid();
  v_prefix text;
  v_seq_key text;
  v_seq_num bigint;
  v_doc_number text;
  v_total_amount bigint := 0;
  v_line jsonb;
  v_line_idx integer := 1;
  v_name text;
  v_qty numeric(18, 4);
  v_price bigint;
  v_subtotal bigint;
  v_trans_date date := coalesce(p_transaction_date, current_date);
BEGIN
  -- Validasi Perusahaan
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'ID Perusahaan wajib diisi.';
  END IF;

  -- Validasi Pemasok Aktif
  IF p_supplier_id IS NULL THEN
    RAISE EXCEPTION 'Pemasok wajib dipilih.';
  END IF;

  SELECT * INTO v_supplier
  FROM public.master_record
  WHERE id = p_supplier_id
    AND company_id = p_company_id
    AND record_kind = 'supplier'
    AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pemasok tidak ditemukan atau tidak aktif pada perusahaan ini.';
  END IF;

  -- Validasi Baris Aset (Minimal 1 baris)
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Pengadaan aset wajib memiliki minimal satu baris item.';
  END IF;

  -- Validasi Rincian Baris & Hitung Total Nilai
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_name := coalesce(nullif(btrim(v_line->>'name'), ''), nullif(btrim(v_line->>'description'), ''));
    IF v_name IS NULL THEN
      RAISE EXCEPTION 'Nama atau deskripsi aset wajib diisi pada baris %.', v_line_idx;
    END IF;

    v_qty := coalesce((v_line->>'quantity')::numeric, 0);
    IF v_qty <= 0 OR v_qty <> floor(v_qty) THEN
      RAISE EXCEPTION 'Kuantitas pada baris % harus berupa bilangan bulat positif (unit fisik).', v_line_idx;
    END IF;

    v_price := coalesce((v_line->>'unitPrice')::bigint, (v_line->>'unit_price')::bigint, 0);
    IF v_price <= 0 THEN
      RAISE EXCEPTION 'Harga satuan pada baris % harus lebih dari nol (Rupiah).', v_line_idx;
    END IF;

    v_subtotal := (v_qty::bigint) * v_price;
    v_total_amount := v_total_amount + v_subtotal;
    v_line_idx := v_line_idx + 1;
  END LOOP;

  -- Penomoran Bukti Pengadaan Aset BA-YYMMDD-### via document_sequence
  v_prefix := 'BA-' || to_char(v_trans_date, 'YYMMDD') || '-';
  v_seq_key := 'asset_purchase-' || to_char(v_trans_date, 'YYMMDD');

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

  -- Simpan Dokumen Header Pengadaan Aset (Status: Draft)
  INSERT INTO public.business_document (
    id, company_id, document_kind, document_number, status,
    transaction_date, counterparty_id, total_amount, paid_amount,
    data, created_by_user_id, created_at, updated_at
  ) VALUES (
    v_doc_id, p_company_id, 'asset_purchase', v_doc_number, 'draft',
    v_trans_date, p_supplier_id, v_total_amount, 0,
    jsonb_build_object(
      'notes', coalesce(p_notes, ''),
      'fundingMethod', 'payable'
    ),
    p_user_id::text, now(), now()
  );

  -- Simpan Baris Rincian Dokumen
  v_line_idx := 1;
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_name := coalesce(nullif(btrim(v_line->>'name'), ''), nullif(btrim(v_line->>'description'), ''));
    v_qty := (v_line->>'quantity')::numeric;
    v_price := coalesce((v_line->>'unitPrice')::bigint, (v_line->>'unit_price')::bigint);
    v_subtotal := (v_qty::bigint) * v_price;

    INSERT INTO public.business_document_line (
      id, company_id, document_id, line_number,
      description, unit_code, conversion_factor,
      quantity, unit_price, subtotal, total_amount,
      data, is_current, revision, version, created_at
    ) VALUES (
      gen_random_uuid(), p_company_id, v_doc_id, v_line_idx,
      v_name, 'unit', 1,
      v_qty, v_price, v_subtotal, v_subtotal,
      jsonb_build_object('assetName', v_name),
      true, 1, 1, now()
    );

    v_line_idx := v_line_idx + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_doc_id,
    'documentNumber', v_doc_number,
    'totalAmount', v_total_amount,
    'status', 'draft'
  );
END;
$$;


-- 2. Fungsi Atomik: Posting Pengadaan Aset Tetap (Post Asset Purchase)
CREATE OR REPLACE FUNCTION public.post_asset_purchase(
  p_company_id uuid,
  p_document_id uuid,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_doc RECORD;
  v_line RECORD;
  v_counterparty RECORD;
  v_period_id uuid;
  v_total_amount bigint := 0;
  v_unit_idx integer;
  v_asset_code text;
  v_asset_name text;
  v_unit_cost bigint;
  v_fa_account_id uuid;
  v_ap_account_id uuid;
  v_journal_id uuid;
  v_journal_prefix text;
  v_journal_seq_key text;
  v_journal_seq_num bigint;
  v_journal_number text;
  v_base_code text;
  v_created_assets_count integer := 0;
BEGIN
  -- 1. Validasi & Kunci Dokumen
  SELECT * INTO v_doc
  FROM public.business_document
  WHERE id = p_document_id AND company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dokumen pengadaan aset dengan ID % tidak ditemukan.', p_document_id;
  END IF;

  IF v_doc.status <> 'draft' THEN
    RAISE EXCEPTION 'Hanya dokumen berstatus draft yang dapat diposting. Status saat ini: %', v_doc.status;
  END IF;

  IF v_doc.document_kind <> 'asset_purchase' THEN
    RAISE EXCEPTION 'Jenis dokumen % bukan pengadaan aset tetap (asset_purchase).', v_doc.document_kind;
  END IF;

  -- 2. Validasi Pemasok Aktif
  IF v_doc.counterparty_id IS NULL THEN
    RAISE EXCEPTION 'Pemasok wajib dipilih sebelum memposting pengadaan aset.';
  END IF;

  SELECT * INTO v_counterparty
  FROM public.master_record
  WHERE id = v_doc.counterparty_id
    AND company_id = p_company_id
    AND record_kind = 'supplier'
    AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pemasok tidak ditemukan atau tidak aktif.';
  END IF;

  -- 3. Validasi Periode Akuntansi Terbuka
  SELECT id INTO v_period_id
  FROM public.accounting_period
  WHERE company_id = p_company_id
    AND v_doc.transaction_date >= start_date
    AND v_doc.transaction_date <= end_date
    AND status = 'open';

  IF v_period_id IS NULL THEN
    RAISE EXCEPTION 'Tanggal transaksi % tidak berada di dalam periode akuntansi yang terbuka.', v_doc.transaction_date;
  END IF;

  -- 4. Validasi Baris Dokumen
  SELECT coalesce(sum(total_amount), 0) INTO v_total_amount
  FROM public.business_document_line
  WHERE document_id = v_doc.id AND is_current = true;

  IF v_total_amount <= 0 THEN
    RAISE EXCEPTION 'Total nilai pengadaan aset harus lebih dari nol (saat ini: %).', v_total_amount;
  END IF;

  -- 5. Bentuk 1 Rekaman Aset Unik pada asset_record untuk Setiap Unit Fisik (1..Qty)
  -- Pola Kode: AST-YYMMDD-###-L{line}-{unit}
  v_base_code := replace(v_doc.document_number, 'BA-', 'AST-');

  FOR v_line IN
    SELECT * FROM public.business_document_line
    WHERE document_id = v_doc.id AND is_current = true
    ORDER BY line_number ASC
  LOOP
    IF v_line.quantity <= 0 OR v_line.quantity <> floor(v_line.quantity) THEN
      RAISE EXCEPTION 'Kuantitas pada baris % harus berupa bilangan bulat positif.', v_line.line_number;
    END IF;

    v_unit_cost := v_line.unit_price;

    FOR v_unit_idx IN 1..v_line.quantity::integer LOOP
      v_asset_code := v_base_code || '-L' || v_line.line_number || '-' || v_unit_idx;
      v_asset_name := CASE
        WHEN v_line.quantity = 1 THEN v_line.description
        ELSE v_line.description || ' (Unit ' || v_unit_idx || ')'
      END;

      INSERT INTO public.asset_record (
        company_id,
        asset_code,
        name,
        status,
        source_document_id,
        source_purchase_line_id,
        acquisition_cost,
        residual_value,
        depreciation_method,
        useful_life_months,
        capitalization_date,
        depreciation_start_date,
        accumulated_depreciation,
        data,
        created_at,
        updated_at
      ) VALUES (
        p_company_id,
        v_asset_code,
        v_asset_name,
        'active',
        v_doc.id,
        v_line.id,
        v_unit_cost,
        0,
        NULL,
        NULL,
        v_doc.transaction_date,
        v_doc.transaction_date,
        0,
        jsonb_build_object(
          'acquisitionEvent', 'asset_purchase',
          'sourcePurchaseLineId', v_line.id,
          'unitIndex', v_unit_idx
        ),
        now(),
        now()
      )
      ON CONFLICT (company_id, asset_code)
      DO UPDATE SET
        status = 'active',
        name = EXCLUDED.name,
        acquisition_cost = EXCLUDED.acquisition_cost,
        residual_value = 0,
        accumulated_depreciation = 0,
        capitalization_date = EXCLUDED.capitalization_date,
        depreciation_start_date = EXCLUDED.depreciation_start_date,
        data = EXCLUDED.data,
        updated_at = now();

      v_created_assets_count := v_created_assets_count + 1;
    END LOOP;
  END LOOP;

  -- 6. Catat Kewajiban Hutang Pemasok pada Subledger
  INSERT INTO public.subledger_entry (
    company_id, subledger_kind, subledger_type, counterparty_id,
    source_document_id, transaction_date, amount, credit_amount,
    remaining_balance, status, posted_at, created_at
  ) VALUES (
    p_company_id, 'supplier_payable', 'supplier_payable', v_doc.counterparty_id,
    v_doc.id, v_doc.transaction_date, v_total_amount, v_total_amount,
    v_total_amount, 'open', now(), now()
  );

  -- 7. Ambil Pemetaan Akun Jurnal (Accounting Mapping)
  SELECT account_id INTO v_fa_account_id
  FROM public.accounting_mapping
  WHERE company_id = p_company_id AND mapping_key = 'fixed_asset';

  IF v_fa_account_id IS NULL THEN
    SELECT id INTO v_fa_account_id
    FROM public.ledger_account
    WHERE company_id = p_company_id AND code = '1-2.0.04';
  END IF;

  SELECT account_id INTO v_ap_account_id
  FROM public.accounting_mapping
  WHERE company_id = p_company_id AND mapping_key = 'supplier_payable';

  IF v_ap_account_id IS NULL THEN
    SELECT id INTO v_ap_account_id
    FROM public.ledger_account
    WHERE company_id = p_company_id AND code = '2-1.1.01';
  END IF;

  IF v_fa_account_id IS NULL OR v_ap_account_id IS NULL THEN
    RAISE EXCEPTION 'Akun Aset Tetap atau Hutang Usaha belum dipetakan pada bagan akun.';
  END IF;

  -- 8. Penomoran & Pembukuan Jurnal Umum JU-YYMMDD-###
  v_journal_prefix := 'JU-' || to_char(v_doc.transaction_date, 'YYMMDD') || '-';
  v_journal_seq_key := 'journal_entry-' || to_char(v_doc.transaction_date, 'YYMMDD');

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
    company_id, entry_number, period_id, source_document_id,
    transaction_date, entry_type, memo, description, status, posted_at, created_at
  ) VALUES (
    p_company_id, v_journal_number, v_period_id, v_doc.id,
    v_doc.transaction_date, 'asset_purchase',
    'Pengadaan Aset ' || v_doc.document_number,
    'Jurnal pengadaan aset ' || v_doc.document_number || ' dari ' || v_counterparty.name,
    'posted', now(), now()
  ) RETURNING id INTO v_journal_id;

  -- Baris Jurnal Debit: Aset Tetap
  INSERT INTO public.journal_line (
    company_id, journal_entry_id, line_number, account_id,
    debit_amount, credit_amount, debit, credit, description
  ) VALUES (
    p_company_id, v_journal_id, 1, v_fa_account_id,
    v_total_amount, 0, v_total_amount, 0,
    'Kapitalisasi Aset Tetap (' || v_doc.document_number || ')'
  );

  -- Baris Jurnal Kredit: Hutang Pemasok
  INSERT INTO public.journal_line (
    company_id, journal_entry_id, line_number, account_id,
    debit_amount, credit_amount, debit, credit, description,
    subledger_type, subledger_id
  ) VALUES (
    p_company_id, v_journal_id, 2, v_ap_account_id,
    0, v_total_amount, 0, v_total_amount,
    'Hutang Pengadaan Aset (' || v_counterparty.name || ')',
    'supplier_payable', v_doc.counterparty_id
  );

  -- 9. Perbarui Dokumen Menjadi Posted
  UPDATE public.business_document
  SET status = 'posted',
      total_amount = v_total_amount,
      posted_at = now(),
      posted_by_user_id = p_user_id::text,
      updated_at = now()
  WHERE id = v_doc.id;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_doc.id,
    'documentNumber', v_doc.document_number,
    'journalNumber', v_journal_number,
    'assetsCreated', v_created_assets_count,
    'totalAmount', v_total_amount
  );
END;
$$;


-- 3. Fungsi Atomik: Batalkan Pengadaan Aset Tetap (Cancel Asset Purchase)
CREATE OR REPLACE FUNCTION public.cancel_asset_purchase(
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
  v_orig_journal RECORD;
  v_orig_line RECORD;
  v_rev_journal_id uuid;
  v_rev_prefix text;
  v_rev_seq_key text;
  v_rev_seq_num bigint;
  v_rev_journal_number text;
  v_line_idx integer := 1;
BEGIN
  -- 1. Validasi Keberadaan & Kunci Dokumen
  SELECT * INTO v_doc
  FROM public.business_document
  WHERE id = p_document_id AND company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dokumen pengadaan aset dengan ID % tidak ditemukan.', p_document_id;
  END IF;

  IF v_doc.status <> 'posted' THEN
    RAISE EXCEPTION 'Hanya dokumen berstatus posted yang dapat dibatalkan. Status saat ini: %', v_doc.status;
  END IF;

  IF v_doc.document_kind <> 'asset_purchase' THEN
    RAISE EXCEPTION 'Jenis dokumen % bukan pengadaan aset tetap.', v_doc.document_kind;
  END IF;

  -- 2. Menolak pembatalan jika aset telah memiliki pembayaran hutang kas keluar aktif
  IF v_doc.paid_amount > 0 THEN
    RAISE EXCEPTION 'Pengadaan aset tidak dapat dibatalkan karena telah memiliki pembayaran hutang kas keluar aktif (terbayar: Rp %).', v_doc.paid_amount;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.business_document
    WHERE company_id = p_company_id
      AND source_document_id = v_doc.id
      AND document_kind = 'purchase_payment'
      AND status = 'posted'
  ) THEN
    RAISE EXCEPTION 'Pengadaan aset tidak dapat dibatalkan karena memiliki bukti pembayaran kas keluar terposting.';
  END IF;

  -- 3. Menolak pembatalan jika ada rekaman aset terkait yang sudah disusutkan
  IF EXISTS (
    SELECT 1 FROM public.asset_record
    WHERE company_id = p_company_id
      AND source_document_id = v_doc.id
      AND accumulated_depreciation > 0
  ) THEN
    RAISE EXCEPTION 'Pengadaan aset tidak dapat dibatalkan karena terdapat unit aset yang sudah disusutkan (memiliki akumulasi depresiasi).';
  END IF;

  -- 4. Menolak jika ada unit aset yang sudah dilepas (disposed)
  IF EXISTS (
    SELECT 1 FROM public.asset_record
    WHERE company_id = p_company_id
      AND source_document_id = v_doc.id
      AND status = 'disposed'
  ) THEN
    RAISE EXCEPTION 'Pengadaan aset tidak dapat dibatalkan karena terdapat unit aset yang sudah dilepas (disposed).';
  END IF;

  -- 5. Buat Jurnal Pembalik Seimbang (Reversal Journal)
  SELECT * INTO v_orig_journal
  FROM public.journal_entry
  WHERE company_id = p_company_id
    AND source_document_id = v_doc.id
    AND status = 'posted'
    AND reversal_of_id IS NULL
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_orig_journal.id IS NOT NULL THEN
    v_rev_prefix := 'JU-' || to_char(current_date, 'YYMMDD') || '-';
    v_rev_seq_key := 'journal_entry-' || to_char(current_date, 'YYMMDD');

    INSERT INTO public.document_sequence (
      company_id, sequence_key, prefix, padding, current_number, current_value, updated_at
    ) VALUES (
      p_company_id, v_rev_seq_key, v_rev_prefix, 3, 1, 1, now()
    )
    ON CONFLICT (company_id, sequence_key)
    DO UPDATE SET
      current_number = public.document_sequence.current_number + 1,
      current_value = public.document_sequence.current_value + 1,
      updated_at = now()
    RETURNING current_number INTO v_rev_seq_num;

    v_rev_journal_number := v_rev_prefix || lpad(v_rev_seq_num::text, 3, '0');

    INSERT INTO public.journal_entry (
      company_id, entry_number, period_id, source_document_id,
      reversal_of_id, transaction_date, entry_type, memo, description,
      status, posted_at, created_at
    ) VALUES (
      p_company_id, v_rev_journal_number, v_orig_journal.period_id, v_doc.id,
      v_orig_journal.id, current_date, 'reversal',
      'Pembalik Pengadaan Aset ' || v_doc.document_number,
      'Pembalik jurnal pengadaan aset ' || v_doc.document_number || '. Alasan: ' || coalesce(p_reason, '-'),
      'posted', now(), now()
    ) RETURNING id INTO v_rev_journal_id;

    -- Balikkan Sisi Debit & Kredit
    FOR v_orig_line IN
      SELECT * FROM public.journal_line
      WHERE journal_entry_id = v_orig_journal.id
      ORDER BY line_number ASC
    LOOP
      INSERT INTO public.journal_line (
        company_id, journal_entry_id, line_number, account_id,
        debit_amount, credit_amount, debit, credit, description,
        subledger_type, subledger_id
      ) VALUES (
        p_company_id, v_rev_journal_id, v_line_idx, v_orig_line.account_id,
        v_orig_line.credit_amount, v_orig_line.debit_amount,
        v_orig_line.credit, v_orig_line.debit,
        'Pembalik: ' || coalesce(v_orig_line.description, ''),
        v_orig_line.subledger_type, v_orig_line.subledger_id
      );
      v_line_idx := v_line_idx + 1;
    END LOOP;
  END IF;

  -- 6. Batalkan Entri Subledger Hutang
  UPDATE public.subledger_entry
  SET status = 'voided'
  WHERE company_id = p_company_id AND source_document_id = v_doc.id;

  -- 7. Tandai Rekaman Aset Terkait Menjadi Cancelled
  UPDATE public.asset_record
  SET status = 'cancelled',
      updated_at = now()
  WHERE company_id = p_company_id AND source_document_id = v_doc.id;

  -- 8. Ubah Status Dokumen Pengadaan Menjadi Void
  UPDATE public.business_document
  SET status = 'void',
      voided_at = now(),
      voided_by_user_id = p_user_id::text,
      void_reason = p_reason,
      updated_at = now()
  WHERE id = v_doc.id;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_doc.id,
    'documentNumber', v_doc.document_number,
    'status', 'void',
    'reversalJournalNumber', v_rev_journal_number
  );
END;
$$;


-- 4. Fungsi Atomik: Perbarui Parameter Penyusutan Aset Tetap (Update Asset Parameters)
CREATE OR REPLACE FUNCTION public.update_asset_parameters(
  p_company_id uuid,
  p_asset_id uuid,
  p_category_id uuid DEFAULT NULL,
  p_depreciation_method text DEFAULT NULL,
  p_useful_life_months integer DEFAULT NULL,
  p_residual_value bigint DEFAULT NULL,
  p_depreciation_start_date date DEFAULT NULL,
  p_location text DEFAULT NULL,
  p_custodian text DEFAULT NULL,
  p_serial_number text DEFAULT NULL,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_asset RECORD;
  v_category RECORD;
BEGIN
  -- 1. Validasi Eksistensi & Kunci Rekaman Aset
  SELECT * INTO v_asset
  FROM public.asset_record
  WHERE id = p_asset_id AND company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rekaman aset tidak ditemukan pada perusahaan ini.';
  END IF;

  IF v_asset.status NOT IN ('active', 'candidate') THEN
    RAISE EXCEPTION 'Hanya aset aktif yang dapat diperbarui parameternya. Status saat ini: %', v_asset.status;
  END IF;

  -- 2. Validasi Kategori jika Dipilih
  IF p_category_id IS NOT NULL THEN
    SELECT * INTO v_category
    FROM public.configuration_category
    WHERE id = p_category_id AND company_id = p_company_id AND category_kind = 'asset';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Kategori aset tidak ditemukan atau bukan jenis kategori aset.';
    END IF;
  END IF;

  -- 3. Validasi Penguncian Akuntansi (Accounting Lock)
  -- Jika aset telah memiliki riwayat penyusutan terposting (accumulated_depreciation > 0),
  -- parameter akuntansi (metode, masa manfaat, residu, tanggal mulai) dikunci dan dilarang diubah.
  IF v_asset.accumulated_depreciation > 0 THEN
    IF (p_depreciation_method IS DISTINCT FROM v_asset.depreciation_method) OR
       (p_useful_life_months IS DISTINCT FROM v_asset.useful_life_months) OR
       (p_residual_value IS DISTINCT FROM v_asset.residual_value) OR
       (p_depreciation_start_date IS DISTINCT FROM v_asset.depreciation_start_date) THEN
      RAISE EXCEPTION 'Parameter akuntansi penyusutan terkunci karena aset telah memiliki riwayat penyusutan terposting.';
    END IF;

    -- Perbarui hanya informasi operasional
    UPDATE public.asset_record
    SET category_id = coalesce(p_category_id, v_asset.category_id),
        location = p_location,
        custodian = p_custodian,
        serial_number = p_serial_number,
        updated_at = now()
    WHERE id = v_asset.id;

  ELSE
    -- Validasi Parameter Baru saat Belum Ada Depresiasi
    IF p_depreciation_method IS NOT NULL AND p_depreciation_method NOT IN ('straight_line', 'declining_balance') THEN
      RAISE EXCEPTION 'Metode penyusutan % tidak valid. Pilihan yang didukung: straight_line, declining_balance.', p_depreciation_method;
    END IF;

    IF p_useful_life_months IS NOT NULL AND p_useful_life_months <= 0 THEN
      RAISE EXCEPTION 'Masa manfaat aset harus lebih dari 0 bulan.';
    END IF;

    IF p_residual_value IS NOT NULL THEN
      IF p_residual_value < 0 OR p_residual_value >= v_asset.acquisition_cost THEN
        RAISE EXCEPTION 'Nilai residu (Rp %) harus bernilai positif dan lebih kecil dari biaya perolehan (Rp %).', p_residual_value, v_asset.acquisition_cost;
      END IF;
    END IF;

    IF p_depreciation_start_date IS NOT NULL AND v_asset.capitalization_date IS NOT NULL THEN
      IF p_depreciation_start_date < v_asset.capitalization_date THEN
        RAISE EXCEPTION 'Tanggal mulai penyusutan (%) tidak boleh lebih awal dari tanggal kapitalisasi/perolehan (%).', p_depreciation_start_date, v_asset.capitalization_date;
      END IF;
    END IF;

    -- Perbarui Seluruh Parameter Aset
    UPDATE public.asset_record
    SET category_id = p_category_id,
        depreciation_method = p_depreciation_method,
        useful_life_months = p_useful_life_months,
        residual_value = coalesce(p_residual_value, 0),
        depreciation_start_date = p_depreciation_start_date,
        location = p_location,
        custodian = p_custodian,
        serial_number = p_serial_number,
        updated_at = now()
    WHERE id = v_asset.id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_asset.id,
    'assetCode', v_asset.asset_code
  );
END;
$$;


-- 5. Fungsi Atomik: Pratinjau Penyusutan Bulanan (Get Depreciation Preview)
CREATE OR REPLACE FUNCTION public.get_depreciation_preview(
  p_company_id uuid,
  p_period_month text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_period_year integer;
  v_period_month_num integer;
  v_start_year integer;
  v_start_month integer;
  v_period_number integer;
  v_rec RECORD;
  v_reason text;
  v_basis bigint;
  v_remaining_basis bigint;
  v_monthly_amount bigint;
  v_opening_bv bigint;
  v_depreciation_amount bigint;
  v_book_value_before bigint;
  v_book_value_after bigint;
  v_eligible_list jsonb := '[]'::jsonb;
  v_ineligible_list jsonb := '[]'::jsonb;
  v_total_eligible_amount bigint := 0;
BEGIN
  -- Validasi Format Bulan Periode YYYY-MM
  IF p_period_month IS NULL OR p_period_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'Format periode bulan % tidak valid. Gunakan format YYYY-MM.', p_period_month;
  END IF;

  v_period_year := substring(p_period_month from 1 for 4)::integer;
  v_period_month_num := substring(p_period_month from 6 for 2)::integer;

  -- Iterasi Seluruh Aset Aktif Milik Perusahaan
  FOR v_rec IN
    SELECT a.*, c.name as category_name
    FROM public.asset_record a
    LEFT JOIN public.configuration_category c ON c.id = a.category_id
    WHERE a.company_id = p_company_id
      AND a.status = 'active'
    ORDER BY a.asset_code ASC
  LOOP
    v_reason := NULL;

    -- Evaluasi Kategori Ineligible
    IF v_rec.depreciation_method IS NULL OR
       v_rec.useful_life_months IS NULL OR
       v_rec.useful_life_months <= 0 OR
       v_rec.depreciation_start_date IS NULL THEN
      v_reason := 'Perlu Pengaturan Penyusutan';

    ELSE
      v_start_year := substring(v_rec.depreciation_start_date::text from 1 for 4)::integer;
      v_start_month := substring(v_rec.depreciation_start_date::text from 6 for 2)::integer;
      v_period_number := (v_period_year - v_start_year) * 12 + v_period_month_num - v_start_month + 1;

      IF v_period_number < 1 THEN
        v_reason := 'Tanggal Mulai di Masa Depan';

      ELSIF EXISTS (
        SELECT 1 FROM public.depreciation_entry
        WHERE company_id = p_company_id
          AND asset_id = v_rec.id
          AND period_month = p_period_month
          AND reversal_of_id IS NULL
      ) THEN
        v_reason := 'Sudah Disusutkan pada Periode Ini';

      ELSIF v_rec.accumulated_depreciation >= (v_rec.acquisition_cost - v_rec.residual_value) OR
            v_period_number > v_rec.useful_life_months THEN
        v_reason := 'Sudah Disusutkan Penuh';

      ELSE
        -- Perhitungan Nilai Depresiasi Periode Terpilih
        IF v_rec.depreciation_method = 'straight_line' THEN
          v_basis := v_rec.acquisition_cost - v_rec.residual_value;
          v_remaining_basis := v_basis - v_rec.accumulated_depreciation;

          IF v_period_number = v_rec.useful_life_months THEN
            v_depreciation_amount := v_remaining_basis;
          ELSE
            v_monthly_amount := greatest(1, floor(v_basis::numeric / v_rec.useful_life_months)::bigint);
            v_depreciation_amount := least(v_monthly_amount, v_remaining_basis);
          END IF;

        ELSIF v_rec.depreciation_method = 'declining_balance' THEN
          v_remaining_basis := v_rec.acquisition_cost - v_rec.residual_value - v_rec.accumulated_depreciation;

          IF v_period_number = v_rec.useful_life_months THEN
            v_depreciation_amount := v_remaining_basis;
          ELSE
            v_opening_bv := v_rec.acquisition_cost - v_rec.accumulated_depreciation;
            v_monthly_amount := greatest(1, floor((v_opening_bv::numeric * 2) / v_rec.useful_life_months)::bigint);
            v_depreciation_amount := least(v_monthly_amount, v_remaining_basis);
          END IF;
        ELSE
          v_depreciation_amount := 0;
        END IF;

        IF v_depreciation_amount <= 0 THEN
          v_reason := 'Sudah Disusutkan Penuh';
        ELSE
          -- Aset Memenuhi Syarat (Eligible)
          v_book_value_before := v_rec.acquisition_cost - v_rec.accumulated_depreciation;
          v_book_value_after := v_book_value_before - v_depreciation_amount;
          v_total_eligible_amount := v_total_eligible_amount + v_depreciation_amount;

          v_eligible_list := v_eligible_list || jsonb_build_object(
            'assetId', v_rec.id,
            'assetCode', v_rec.asset_code,
            'name', v_rec.name,
            'categoryName', coalesce(v_rec.category_name, '-'),
            'acquisitionCost', v_rec.acquisition_cost,
            'residualValue', v_rec.residual_value,
            'depreciationMethod', v_rec.depreciation_method,
            'usefulLifeMonths', v_rec.useful_life_months,
            'periodNumber', v_period_number,
            'accumulatedDepreciation', v_rec.accumulated_depreciation,
            'bookValueBefore', v_book_value_before,
            'depreciationAmount', v_depreciation_amount,
            'bookValueAfter', v_book_value_after
          );
        END IF;
      END IF;
    END IF;

    -- Jika Tidak Memenuhi Syarat (Ineligible)
    IF v_reason IS NOT NULL THEN
      v_ineligible_list := v_ineligible_list || jsonb_build_object(
        'assetId', v_rec.id,
        'assetCode', v_rec.asset_code,
        'name', v_rec.name,
        'categoryName', coalesce(v_rec.category_name, '-'),
        'acquisitionCost', v_rec.acquisition_cost,
        'accumulatedDepreciation', v_rec.accumulated_depreciation,
        'reason', v_reason
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'periodMonth', p_period_month,
    'totalEligibleAssets', jsonb_array_length(v_eligible_list),
    'totalEligibleAmount', v_total_eligible_amount,
    'totalIneligibleAssets', jsonb_array_length(v_ineligible_list),
    'eligibleAssets', v_eligible_list,
    'ineligibleAssets', v_ineligible_list
  );
END;
$$;


-- 6. Fungsi Atomik: Posting Penyusutan Bulanan (Post Monthly Depreciation)
CREATE OR REPLACE FUNCTION public.post_monthly_depreciation(
  p_company_id uuid,
  p_period_month text,
  p_asset_ids jsonb,
  p_notes text DEFAULT NULL,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_period_year integer;
  v_period_month_num integer;
  v_start_year integer;
  v_start_month integer;
  v_period_number integer;
  v_trans_date date;
  v_period_id uuid;
  v_doc_id uuid := gen_random_uuid();
  v_prefix text;
  v_seq_key text;
  v_seq_num bigint;
  v_doc_number text;
  v_asset_id_text text;
  v_asset_id uuid;
  v_asset RECORD;
  v_basis bigint;
  v_remaining_basis bigint;
  v_monthly_amount bigint;
  v_opening_bv bigint;
  v_depreciation_amount bigint;
  v_total_depreciation bigint := 0;
  v_asset_count integer := 0;
  v_line_num integer := 1;
  v_dep_expense_account_id uuid;
  v_accum_dep_account_id uuid;
  v_journal_id uuid;
  v_journal_prefix text;
  v_journal_seq_key text;
  v_journal_seq_num bigint;
  v_journal_number text;
BEGIN
  -- 1. Validasi Format Bulan Periode YYYY-MM
  IF p_period_month IS NULL OR p_period_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'Format periode bulan % tidak valid. Gunakan format YYYY-MM.', p_period_month;
  END IF;

  v_period_year := substring(p_period_month from 1 for 4)::integer;
  v_period_month_num := substring(p_period_month from 6 for 2)::integer;

  -- Tanggal transaksi penyusutan adalah hari terakhir bulan periode
  v_trans_date := (to_date(p_period_month || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date;

  -- 2. Validasi Periode Akuntansi Berstatus Terbuka (Open)
  SELECT id INTO v_period_id
  FROM public.accounting_period
  WHERE company_id = p_company_id
    AND (
      (v_trans_date >= start_date AND v_trans_date <= end_date)
      OR period_month = p_period_month
    )
    AND status = 'open'
  LIMIT 1;

  IF v_period_id IS NULL THEN
    RAISE EXCEPTION 'Periode akuntansi % belum dibuka atau telah ditutup.', p_period_month;
  END IF;

  -- 3. Validasi Daftar Aset Terpilih
  IF p_asset_ids IS NULL OR jsonb_typeof(p_asset_ids) <> 'array' OR jsonb_array_length(p_asset_ids) = 0 THEN
    RAISE EXCEPTION 'Minimal satu aset harus dipilih untuk memposting penyusutan bulanan.';
  END IF;

  -- 4. Penomoran Dokumen Penyusutan DP-YYMMDD-###
  v_prefix := 'DP-' || to_char(v_trans_date, 'YYMMDD') || '-';
  v_seq_key := 'depreciation-' || to_char(v_trans_date, 'YYMMDD');

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

  -- 5. Buat Header Dokumen Penyusutan (business_document)
  INSERT INTO public.business_document (
    id, company_id, document_kind, document_number, status,
    transaction_date, total_amount, paid_amount,
    data, posted_at, posted_by_user_id, created_at, updated_at
  ) VALUES (
    v_doc_id, p_company_id, 'depreciation', v_doc_number, 'posted',
    v_trans_date, 0, 0,
    jsonb_build_object(
      'periodMonth', p_period_month,
      'notes', coalesce(p_notes, 'Penyusutan Periode ' || p_period_month)
    ),
    now(), p_user_id::text, now(), now()
  );

  -- 6. Loop & Proses Setiap Aset
  FOR v_asset_id_text IN SELECT * FROM jsonb_array_elements_text(p_asset_ids) LOOP
    v_asset_id := v_asset_id_text::uuid;

    SELECT * INTO v_asset
    FROM public.asset_record
    WHERE id = v_asset_id AND company_id = p_company_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Aset dengan ID % tidak ditemukan pada perusahaan ini.', v_asset_id;
    END IF;

    IF v_asset.status <> 'active' THEN
      RAISE EXCEPTION 'Aset % tidak berstatus aktif (status: %).', v_asset.asset_code, v_asset.status;
    END IF;

    IF v_asset.depreciation_method IS NULL OR v_asset.useful_life_months IS NULL OR v_asset.useful_life_months <= 0 OR v_asset.depreciation_start_date IS NULL THEN
      RAISE EXCEPTION 'Aset % belum memiliki parameter penyusutan yang lengkap.', v_asset.asset_code;
    END IF;

    -- Mencegah Double Posting pada Periode yang Sama
    IF EXISTS (
      SELECT 1 FROM public.depreciation_entry
      WHERE company_id = p_company_id
        AND asset_id = v_asset.id
        AND period_month = p_period_month
        AND reversal_of_id IS NULL
    ) THEN
      RAISE EXCEPTION 'Aset % sudah memiliki entri penyusutan pada periode % (mencegah double posting).', v_asset.asset_code, p_period_month;
    END IF;

    -- Hitung Nomor Bulan Penyusutan
    v_start_year := substring(v_asset.depreciation_start_date::text from 1 for 4)::integer;
    v_start_month := substring(v_asset.depreciation_start_date::text from 6 for 2)::integer;
    v_period_number := (v_period_year - v_start_year) * 12 + v_period_month_num - v_start_month + 1;

    IF v_period_number < 1 THEN
      RAISE EXCEPTION 'Aset % memiliki tanggal mulai penyusutan di masa depan.', v_asset.asset_code;
    END IF;

    -- Hitung Nominal Beban Penyusutan
    IF v_asset.depreciation_method = 'straight_line' THEN
      v_basis := v_asset.acquisition_cost - v_asset.residual_value;
      v_remaining_basis := v_basis - v_asset.accumulated_depreciation;

      IF v_period_number = v_asset.useful_life_months THEN
        v_depreciation_amount := v_remaining_basis;
      ELSE
        v_monthly_amount := greatest(1, floor(v_basis::numeric / v_asset.useful_life_months)::bigint);
        v_depreciation_amount := least(v_monthly_amount, v_remaining_basis);
      END IF;

    ELSIF v_asset.depreciation_method = 'declining_balance' THEN
      v_remaining_basis := v_asset.acquisition_cost - v_asset.residual_value - v_asset.accumulated_depreciation;

      IF v_period_number = v_asset.useful_life_months THEN
        v_depreciation_amount := v_remaining_basis;
      ELSE
        v_opening_bv := v_asset.acquisition_cost - v_asset.accumulated_depreciation;
        v_monthly_amount := greatest(1, floor((v_opening_bv::numeric * 2) / v_asset.useful_life_months)::bigint);
        v_depreciation_amount := least(v_monthly_amount, v_remaining_basis);
      END IF;
    ELSE
      v_depreciation_amount := 0;
    END IF;

    IF v_depreciation_amount <= 0 THEN
      RAISE EXCEPTION 'Aset % sudah disusutkan penuh atau tidak memiliki sisa beban penyusutan.', v_asset.asset_code;
    END IF;

    -- Sisipkan ke depreciation_entry
    INSERT INTO public.depreciation_entry (
      company_id, asset_id, period_month, amount, source_document_id, posted_at
    ) VALUES (
      p_company_id, v_asset.id, p_period_month, v_depreciation_amount, v_doc_id, now()
    );

    -- Perbarui Akumulasi Penyusutan pada asset_record
    UPDATE public.asset_record
    SET accumulated_depreciation = accumulated_depreciation + v_depreciation_amount,
        updated_at = now()
    WHERE id = v_asset.id;

    -- Tambah Baris Detail Dokumen
    INSERT INTO public.business_document_line (
      id, company_id, document_id, line_number,
      description, unit_code, conversion_factor,
      quantity, unit_price, subtotal, total_amount,
      data, is_current, revision, version, created_at
    ) VALUES (
      gen_random_uuid(), p_company_id, v_doc_id, v_line_num,
      'Penyusutan ' || v_asset.asset_code || ' (' || v_asset.name || ')',
      'bln', 1, 1, v_depreciation_amount, v_depreciation_amount, v_depreciation_amount,
      jsonb_build_object(
        'assetId', v_asset.id,
        'assetCode', v_asset.asset_code,
        'periodMonth', p_period_month,
        'periodNumber', v_period_number
      ),
      true, 1, 1, now()
    );

    v_total_depreciation := v_total_depreciation + v_depreciation_amount;
    v_asset_count := v_asset_count + 1;
    v_line_num := v_line_num + 1;
  END LOOP;

  -- Perbarui Total Dokumen
  UPDATE public.business_document
  SET total_amount = v_total_depreciation,
      data = jsonb_build_object(
        'periodMonth', p_period_month,
        'assetCount', v_asset_count,
        'notes', coalesce(p_notes, 'Penyusutan Periode ' || p_period_month)
      ),
      updated_at = now()
  WHERE id = v_doc_id;

  -- 7. Ambil Pemetaan Akun Beban & Akumulasi Penyusutan
  SELECT account_id INTO v_dep_expense_account_id
  FROM public.accounting_mapping
  WHERE company_id = p_company_id AND mapping_key = 'depreciation_expense';

  IF v_dep_expense_account_id IS NULL THEN
    SELECT id INTO v_dep_expense_account_id
    FROM public.ledger_account
    WHERE company_id = p_company_id AND code = '6-3.0.03';
  END IF;

  SELECT account_id INTO v_accum_dep_account_id
  FROM public.accounting_mapping
  WHERE company_id = p_company_id AND mapping_key = 'accumulated_depreciation';

  IF v_accum_dep_account_id IS NULL THEN
    SELECT id INTO v_accum_dep_account_id
    FROM public.ledger_account
    WHERE company_id = p_company_id AND code = '1-2.1.03';
  END IF;

  IF v_dep_expense_account_id IS NULL OR v_accum_dep_account_id IS NULL THEN
    RAISE EXCEPTION 'Akun Beban Penyusutan atau Akumulasi Penyusutan belum dipetakan.';
  END IF;

  -- 8. Pembukuan Jurnal Umum Penyusutan Seimbang JU-YYMMDD-###
  v_journal_prefix := 'JU-' || to_char(v_trans_date, 'YYMMDD') || '-';
  v_journal_seq_key := 'journal_entry-' || to_char(v_trans_date, 'YYMMDD');

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
    company_id, entry_number, period_id, source_document_id,
    transaction_date, entry_type, memo, description, status, posted_at, created_at
  ) VALUES (
    p_company_id, v_journal_number, v_period_id, v_doc_id,
    v_trans_date, 'depreciation',
    'Penyusutan Periode ' || p_period_month,
    'Jurnal penyusutan ' || v_asset_count || ' aset untuk periode ' || p_period_month,
    'posted', now(), now()
  ) RETURNING id INTO v_journal_id;

  -- Baris Debit: Beban Penyusutan Aset Tetap
  INSERT INTO public.journal_line (
    company_id, journal_entry_id, line_number, account_id,
    debit_amount, credit_amount, debit, credit, description
  ) VALUES (
    p_company_id, v_journal_id, 1, v_dep_expense_account_id,
    v_total_depreciation, 0, v_total_depreciation, 0,
    'Beban Penyusutan Aset Periode ' || p_period_month
  );

  -- Baris Kredit: Akumulasi Penyusutan Aset Tetap
  INSERT INTO public.journal_line (
    company_id, journal_entry_id, line_number, account_id,
    debit_amount, credit_amount, debit, credit, description
  ) VALUES (
    p_company_id, v_journal_id, 2, v_accum_dep_account_id,
    0, v_total_depreciation, 0, v_total_depreciation,
    'Akumulasi Penyusutan Aset Periode ' || p_period_month
  );

  RETURN jsonb_build_object(
    'success', true,
    'id', v_doc_id,
    'documentNumber', v_doc_number,
    'journalNumber', v_journal_number,
    'periodMonth', p_period_month,
    'totalAmount', v_total_depreciation,
    'assetCount', v_asset_count
  );
END;
$$;


-- 7. Fungsi Atomik: Pelepasan Aset Tetap (Post Asset Disposal)
CREATE OR REPLACE FUNCTION public.post_asset_disposal(
  p_company_id uuid,
  p_asset_id uuid,
  p_disposal_date date,
  p_proceeds bigint,
  p_cash_account_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_asset RECORD;
  v_period_id uuid;
  v_cash_account RECORD;
  v_disposal_date date := coalesce(p_disposal_date, current_date);
  v_doc_id uuid := gen_random_uuid();
  v_prefix text;
  v_seq_key text;
  v_seq_num bigint;
  v_doc_number text;
  v_proceeds bigint := coalesce(p_proceeds, 0);
  v_book_value bigint;
  v_gain bigint := 0;
  v_loss bigint := 0;
  v_cash_ledger_account_id uuid;
  v_accum_dep_account_id uuid;
  v_loss_account_id uuid;
  v_gain_account_id uuid;
  v_fa_account_id uuid;
  v_journal_id uuid;
  v_journal_prefix text;
  v_journal_seq_key text;
  v_journal_seq_num bigint;
  v_journal_number text;
  v_line_idx integer := 1;
BEGIN
  -- 1. Validasi & Kunci Rekaman Aset
  SELECT * INTO v_asset
  FROM public.asset_record
  WHERE id = p_asset_id AND company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aset tidak ditemukan pada perusahaan ini.';
  END IF;

  IF v_asset.status <> 'active' THEN
    RAISE EXCEPTION 'Hanya aset berstatus aktif yang dapat dilepas. Status saat ini: %', v_asset.status;
  END IF;

  -- 2. Validasi Periode Akuntansi Terbuka
  SELECT id INTO v_period_id
  FROM public.accounting_period
  WHERE company_id = p_company_id
    AND v_disposal_date >= start_date
    AND v_disposal_date <= end_date
    AND status = 'open';

  IF v_period_id IS NULL THEN
    RAISE EXCEPTION 'Tanggal pelepasan % tidak berada di dalam periode akuntansi yang terbuka.', v_disposal_date;
  END IF;

  -- 3. Validasi Hasil Penjualan (Proceeds) & Rekening Kas
  IF v_proceeds < 0 THEN
    RAISE EXCEPTION 'Hasil penjualan pelepasan aset tidak boleh negatif.';
  END IF;

  IF v_proceeds > 0 THEN
    IF p_cash_account_id IS NULL THEN
      RAISE EXCEPTION 'Rekening Kas/Bank wajib dipilih jika hasil penjualan pelepasan aset lebih dari nol.';
    END IF;

    SELECT * INTO v_cash_account
    FROM public.master_record
    WHERE id = p_cash_account_id
      AND company_id = p_company_id
      AND record_kind = 'cash_account'
      AND is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Rekening Kas/Bank tidak ditemukan atau tidak aktif.';
    END IF;

    v_cash_ledger_account_id := v_cash_account.ledger_account_id;
    IF v_cash_ledger_account_id IS NULL THEN
      SELECT account_id INTO v_cash_ledger_account_id
      FROM public.accounting_mapping
      WHERE company_id = p_company_id AND mapping_key = 'cash';
    END IF;
  END IF;

  -- 4. Hitung Nilai Buku, Laba, dan Rugi Pelepasan
  v_book_value := v_asset.acquisition_cost - v_asset.accumulated_depreciation;

  IF v_proceeds > v_book_value THEN
    v_gain := v_proceeds - v_book_value;
    v_loss := 0;
  ELSIF v_book_value > v_proceeds THEN
    v_loss := v_book_value - v_proceeds;
    v_gain := 0;
  ELSE
    v_gain := 0;
    v_loss := 0;
  END IF;

  -- 5. Penomoran Dokumen Pelepasan DA-YYMMDD-### via document_sequence
  v_prefix := 'DA-' || to_char(v_disposal_date, 'YYMMDD') || '-';
  v_seq_key := 'asset_disposal-' || to_char(v_disposal_date, 'YYMMDD');

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

  -- 6. Buat Header Dokumen Pelepasan (Status: Posted)
  INSERT INTO public.business_document (
    id, company_id, document_kind, document_number, status,
    transaction_date, total_amount, paid_amount,
    data, posted_at, posted_by_user_id, created_at, updated_at
  ) VALUES (
    v_doc_id, p_company_id, 'asset_disposal', v_doc_number, 'posted',
    v_disposal_date, v_asset.acquisition_cost, v_proceeds,
    jsonb_build_object(
      'assetId', p_asset_id,
      'assetCode', v_asset.asset_code,
      'assetName', v_asset.name,
      'acquisitionCost', v_asset.acquisition_cost,
      'accumulatedDepreciation', v_asset.accumulated_depreciation,
      'bookValue', v_book_value,
      'proceeds', v_proceeds,
      'gain', v_gain,
      'loss', v_loss,
      'cashAccountId', p_cash_account_id,
      'reason', coalesce(p_reason, '')
    ),
    now(), p_user_id::text, now(), now()
  );

  -- Buat Baris Rincian Dokumen Pelepasan
  INSERT INTO public.business_document_line (
    id, company_id, document_id, line_number,
    description, unit_code, conversion_factor,
    quantity, unit_price, subtotal, total_amount,
    data, is_current, revision, version, created_at
  ) VALUES (
    gen_random_uuid(), p_company_id, v_doc_id, 1,
    'Pelepasan ' || v_asset.asset_code || ' - ' || v_asset.name,
    'unit', 1, 1, v_asset.acquisition_cost, v_asset.acquisition_cost, v_asset.acquisition_cost,
    jsonb_build_object(
      'assetId', p_asset_id,
      'bookValue', v_book_value,
      'proceeds', v_proceeds,
      'gain', v_gain,
      'loss', v_loss
    ),
    true, 1, 1, now()
  );

  -- 7. Catat Mutasi Kas Masuk jika Terdapat Hasil Penjualan
  IF v_proceeds > 0 THEN
    INSERT INTO public.cash_movement (
      company_id, cash_account_id, movement_type, transaction_date,
      amount, source_document_id, notes, posted_at, created_at
    ) VALUES (
      p_company_id, p_cash_account_id, 'receipt', v_disposal_date,
      v_proceeds, v_doc_id,
      'Hasil penjualan pelepasan aset ' || v_asset.asset_code,
      now(), now()
    );
  END IF;

  -- 8. Ambil Pemetaan Akun Jurnal Pelepasan
  SELECT account_id INTO v_accum_dep_account_id
  FROM public.accounting_mapping
  WHERE company_id = p_company_id AND mapping_key = 'accumulated_depreciation';

  IF v_accum_dep_account_id IS NULL THEN
    SELECT id INTO v_accum_dep_account_id
    FROM public.ledger_account
    WHERE company_id = p_company_id AND code = '1-2.1.03';
  END IF;

  SELECT account_id INTO v_loss_account_id
  FROM public.accounting_mapping
  WHERE company_id = p_company_id AND mapping_key = 'asset_disposal_loss';

  IF v_loss_account_id IS NULL THEN
    SELECT id INTO v_loss_account_id
    FROM public.ledger_account
    WHERE company_id = p_company_id AND code = '8-2.0.00';
  END IF;

  SELECT account_id INTO v_gain_account_id
  FROM public.accounting_mapping
  WHERE company_id = p_company_id AND mapping_key = 'asset_disposal_gain';

  IF v_gain_account_id IS NULL THEN
    SELECT id INTO v_gain_account_id
    FROM public.ledger_account
    WHERE company_id = p_company_id AND code = '4-2.0.03';
  END IF;

  SELECT account_id INTO v_fa_account_id
  FROM public.accounting_mapping
  WHERE company_id = p_company_id AND mapping_key = 'fixed_asset';

  IF v_fa_account_id IS NULL THEN
    SELECT id INTO v_fa_account_id
    FROM public.ledger_account
    WHERE company_id = p_company_id AND code = '1-2.0.04';
  END IF;

  -- 9. Penomoran & Pembukuan Jurnal Pelepasan Aset Seimbang JU-YYMMDD-###
  v_journal_prefix := 'JU-' || to_char(v_disposal_date, 'YYMMDD') || '-';
  v_journal_seq_key := 'journal_entry-' || to_char(v_disposal_date, 'YYMMDD');

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
    company_id, entry_number, period_id, source_document_id,
    transaction_date, entry_type, memo, description, status, posted_at, created_at
  ) VALUES (
    p_company_id, v_journal_number, v_period_id, v_doc_id,
    v_disposal_date, 'asset_disposal',
    'Pelepasan Aset ' || v_asset.asset_code,
    'Jurnal pelepasan aset ' || v_asset.asset_code || ' (' || v_asset.name || ')',
    'posted', now(), now()
  ) RETURNING id INTO v_journal_id;

  -- 1) Baris Debit: Kas/Bank (jika ada proceeds)
  IF v_proceeds > 0 THEN
    INSERT INTO public.journal_line (
      company_id, journal_entry_id, line_number, account_id,
      debit_amount, credit_amount, debit, credit, description
    ) VALUES (
      p_company_id, v_journal_id, v_line_idx, v_cash_ledger_account_id,
      v_proceeds, 0, v_proceeds, 0,
      'Penerimaan Penjualan Aset (' || v_asset.asset_code || ')'
    );
    v_line_idx := v_line_idx + 1;
  END IF;

  -- 2) Baris Debit: Akumulasi Penyusutan (jika ada akumulasi)
  IF v_asset.accumulated_depreciation > 0 THEN
    INSERT INTO public.journal_line (
      company_id, journal_entry_id, line_number, account_id,
      debit_amount, credit_amount, debit, credit, description
    ) VALUES (
      p_company_id, v_journal_id, v_line_idx, v_accum_dep_account_id,
      v_asset.accumulated_depreciation, 0, v_asset.accumulated_depreciation, 0,
      'Penghapusan Akumulasi Penyusutan (' || v_asset.asset_code || ')'
    );
    v_line_idx := v_line_idx + 1;
  END IF;

  -- 3) Baris Debit: Rugi Pelepasan Aset (jika book_value > proceeds)
  IF v_loss > 0 THEN
    INSERT INTO public.journal_line (
      company_id, journal_entry_id, line_number, account_id,
      debit_amount, credit_amount, debit, credit, description
    ) VALUES (
      p_company_id, v_journal_id, v_line_idx, v_loss_account_id,
      v_loss, 0, v_loss, 0,
      'Rugi Pelepasan Aset (' || v_asset.asset_code || ')'
    );
    v_line_idx := v_line_idx + 1;
  END IF;

  -- 4) Baris Kredit: Laba Pelepasan Aset (jika proceeds > book_value)
  IF v_gain > 0 THEN
    INSERT INTO public.journal_line (
      company_id, journal_entry_id, line_number, account_id,
      debit_amount, credit_amount, debit, credit, description
    ) VALUES (
      p_company_id, v_journal_id, v_line_idx, v_gain_account_id,
      0, v_gain, 0, v_gain,
      'Laba Pelepasan Aset (' || v_asset.asset_code || ')'
    );
    v_line_idx := v_line_idx + 1;
  END IF;

  -- 5) Baris Kredit: Aset Tetap Sebesar Biaya Perolehan (acquisition_cost)
  INSERT INTO public.journal_line (
    company_id, journal_entry_id, line_number, account_id,
    debit_amount, credit_amount, debit, credit, description
  ) VALUES (
    p_company_id, v_journal_id, v_line_idx, v_fa_account_id,
    0, v_asset.acquisition_cost, 0, v_asset.acquisition_cost,
    'Pengeluaran Aset Tetap (' || v_asset.asset_code || ')'
  );

  -- 10. Perbarui Status Rekaman Aset Menjadi Disposed
  UPDATE public.asset_record
  SET status = 'disposed',
      data = v_asset.data || jsonb_build_object(
        'disposalDate', v_disposal_date,
        'disposalReason', coalesce(p_reason, ''),
        'disposalDocumentId', v_doc_id,
        'proceeds', v_proceeds,
        'bookValueAtDisposal', v_book_value,
        'gain', v_gain,
        'loss', v_loss
      ),
      updated_at = now()
  WHERE id = v_asset.id;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_doc_id,
    'documentNumber', v_doc_number,
    'journalNumber', v_journal_number,
    'bookValue', v_book_value,
    'proceeds', v_proceeds,
    'gain', v_gain,
    'loss', v_loss
  );
END;
$$;


-- ==============================================================================
-- Hak Akses (Permissions & Grants)
-- ==============================================================================

GRANT EXECUTE ON FUNCTION public.create_asset_purchase(uuid, uuid, date, text, jsonb, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_asset_purchase(uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_asset_purchase(uuid, uuid, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_asset_parameters(uuid, uuid, uuid, text, integer, bigint, date, text, text, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_depreciation_preview(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_monthly_depreciation(uuid, text, jsonb, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_asset_disposal(uuid, uuid, date, bigint, uuid, text, uuid) TO authenticated, service_role;
