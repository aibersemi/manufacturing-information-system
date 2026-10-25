BEGIN;
-- Seluruh signature live dipertahankan, termasuk kedua overload packing.

CREATE OR REPLACE FUNCTION public.assign_repair_spk(p_repair_case_id uuid, p_operator_id uuid, p_wage_mode text, p_custom_rate bigint, p_notes text, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_case RECORD;
  v_bundle RECORD;
  v_profile RECORD;
  v_rate RECORD;
  v_comp_mode text;
  v_rate_snapshot bigint := 0;
  v_repair_spk_id uuid;
  v_prefix text;
  v_seq_key text;
  v_seq_number bigint;
  v_doc_number text;
BEGIN
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  p_user_id := tenant_private.assert_mis_company_access((SELECT r.company_id FROM public.production_repair_case r WHERE r.id=p_repair_case_id), p_user_id);
  -- Ambil Kasus Perbaikan
  SELECT * INTO v_case
  FROM public.production_repair_case
  WHERE id = p_repair_case_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Kasus perbaikan dengan ID % tidak ditemukan.', p_repair_case_id;
  END IF;

  IF v_case.business_status <> 'pending_assignment' THEN
    RAISE EXCEPTION 'Kasus perbaikan ini sudah ditugaskan (status: %).', v_case.business_status;
  END IF;

  -- Ambil data ikatan terkait
  SELECT * INTO v_bundle
  FROM public.production_bundle
  WHERE id = v_case.bundle_id;

  -- Tentukan mode kompensasi
  IF p_wage_mode IN ('unpaid', 'tidak_dibayar') THEN
    v_comp_mode := 'unpaid';
    v_rate_snapshot := 0;
  ELSIF p_wage_mode IN ('reference', 'reference_rate', 'tarif_acuan') THEN
    v_comp_mode := 'reference_rate';
    
    SELECT * INTO v_rate
    FROM public.wage_rate
    WHERE company_id = v_case.company_id
      AND product_id = v_bundle.product_id
      AND service_kind = v_case.repair_work_kind;

    IF NOT FOUND OR v_rate.rate IS NULL THEN
      RAISE EXCEPTION 'Tarif acuan upah untuk pekerjaan % produk % belum dikonfigurasi.', v_case.repair_work_kind, v_bundle.product_id;
    END IF;
    v_rate_snapshot := v_rate.rate;
  ELSIF p_wage_mode IN ('custom', 'special_rate', 'tarif_khusus') THEN
    v_comp_mode := 'special_rate';
    IF p_custom_rate IS NULL OR p_custom_rate < 0 THEN
      RAISE EXCEPTION 'Tarif khusus wajib diisi bilangan non-negatif.';
    END IF;
    v_rate_snapshot := p_custom_rate;
  ELSE
    RAISE EXCEPTION 'Mode kompensasi % tidak valid. Pilihan: unpaid, reference, custom.', p_wage_mode;
  END IF;

  -- Ambil Operator Profile
  SELECT * INTO v_profile
  FROM public.production_operator_profile
  WHERE id = p_operator_id AND company_id = v_case.company_id;

  IF NOT FOUND THEN
    SELECT * INTO v_profile
    FROM public.production_operator_profile
    WHERE (employee_id = p_operator_id OR user_id = p_operator_id)
      AND company_id = v_case.company_id
    LIMIT 1;
  END IF;

  IF v_profile.id IS NULL THEN
    RAISE EXCEPTION 'Operator perbaikan tidak ditemukan.';
  END IF;

  -- Penomoran SPK Perbaikan: SPK-REP-YYMMDD-###
  v_prefix := 'SPK-REP-' || to_char(current_date, 'YYMMDD') || '-';
  v_seq_key := 'SPK-repair-' || to_char(current_date, 'YYMMDD');

  INSERT INTO public.document_sequence (
    company_id, sequence_key, prefix, padding, current_number, current_value, updated_at
  ) VALUES (
    v_case.company_id, v_seq_key, v_prefix, 3, 1, 1, now()
  )
  ON CONFLICT (company_id, sequence_key)
  DO UPDATE SET
    current_number = public.document_sequence.current_number + 1,
    current_value = public.document_sequence.current_value + 1,
    updated_at = now()
  RETURNING current_number INTO v_seq_number;

  v_doc_number := v_prefix || lpad(v_seq_number::text, 3, '0');
  v_repair_spk_id := gen_random_uuid();

  -- Dokumen SPK Perbaikan (business_document)
  INSERT INTO public.business_document (
    id,
    company_id,
    document_kind,
    document_number,
    status,
    transaction_date,
    source_document_id,
    total_amount,
    paid_amount,
    data,
    version,
    posted_at,
    posted_by_user_id,
    created_by_user_id,
    updated_by_user_id,
    created_at,
    updated_at
  ) VALUES (
    v_repair_spk_id,
    v_case.company_id,
    'spk_repair',
    v_doc_number,
    'posted',
    current_date,
    v_case.production_order_id,
    0,
    0,
    jsonb_build_object(
      'repairCaseId', p_repair_case_id,
      'bundleId', v_bundle.id,
      'bundleCode', v_bundle.bundle_code,
      'quantity', v_case.quantity,
      'compensationMode', v_comp_mode,
      'rateSnapshot', v_rate_snapshot,
      'notes', coalesce(p_notes, '')
    ),
    1,
    now(),
    p_user_id::text,
    p_user_id::text,
    p_user_id::text,
    now(),
    now()
  );

  -- Relasi Work Order SPK
  INSERT INTO public.production_work_order (
    document_id,
    company_id,
    production_order_id,
    stage,
    operator_profile_id,
    business_status,
    assigned_at,
    assigned_by_user_id,
    created_at,
    updated_at
  ) VALUES (
    v_repair_spk_id,
    v_case.company_id,
    v_case.production_order_id,
    'repair',
    v_profile.id,
    'assigned',
    now(),
    p_user_id::text,
    now(),
    now()
  );

  -- Update Kasus Perbaikan
  UPDATE public.production_repair_case
  SET business_status = 'in_progress',
      compensation_mode = v_comp_mode,
      rate_snapshot = v_rate_snapshot,
      repair_work_order_id = v_repair_spk_id,
      updated_at = now()
  WHERE id = p_repair_case_id;

  -- Jejak Audit
  INSERT INTO public.audit_log (
    company_id,
    user_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    details,
    created_at
  ) VALUES (
    v_case.company_id,
    p_user_id::text,
    p_user_id::text,
    'production.repair.assign',
    'production_repair_case',
    p_repair_case_id::text,
    jsonb_build_object(
      'repairSpkNumber', v_doc_number,
      'compensationMode', v_comp_mode,
      'rateSnapshot', v_rate_snapshot,
      'operatorProfileId', v_profile.id
    ),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'repairCaseId', p_repair_case_id,
    'spkId', v_repair_spk_id,
    'spkNumber', v_doc_number,
    'compensationMode', v_comp_mode,
    'rateSnapshot', v_rate_snapshot
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_asset_purchase(p_company_id uuid, p_document_id uuid, p_reason text, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  p_user_id := tenant_private.assert_mis_company_access(p_company_id, p_user_id);
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
$function$;

CREATE OR REPLACE FUNCTION public.close_accounting_period(p_company_id uuid, p_period_month text, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_period RECORD;
  v_total_debit bigint;
  v_total_credit bigint;
  v_draft_count bigint;
  v_cash_diff_count integer := 0;
  v_subledger_diff_count integer := 0;
  v_close_summary jsonb;
BEGIN
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  p_user_id := tenant_private.assert_mis_company_access(p_company_id, p_user_id);
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
$function$;

CREATE OR REPLACE FUNCTION public.confirm_operator_cutting(p_spk_id uuid, p_roll_id uuid, p_actual_date date, p_actual_lines jsonb, p_bundles jsonb, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_spk RECORD;
  v_pp RECORD;
  v_roll RECORD;
  v_profile RECORD;
  v_act_id uuid;
  v_prefix text;
  v_seq_key text;
  v_seq_number bigint;
  v_act_number text;
  v_lot_id uuid;
  v_lot_code text;
  v_line jsonb;
  v_bundle jsonb;
  v_prod RECORD;
  v_product_id uuid;
  v_qty numeric;
  v_rate RECORD;
  v_total_actual_pcs numeric := 0;
  v_total_wage bigint := 0;
  v_wage_amount bigint := 0;
  v_line_idx integer := 0;
  v_bundle_idx integer := 0;
  v_bundle_code text;
  v_sku text;
  v_roll_cost bigint := 0;
  v_unit_cost bigint := 0;
BEGIN
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  p_user_id := tenant_private.assert_mis_company_access((SELECT d.company_id FROM public.production_work_order w JOIN public.business_document d ON d.id=w.document_id WHERE w.document_id=p_spk_id), p_user_id);
  -- Validasi SPK Potong
  SELECT pwo.*, bd.company_id, bd.document_number as spk_number INTO v_spk
  FROM public.production_work_order pwo
  JOIN public.business_document bd ON bd.id = pwo.document_id
  WHERE pwo.document_id = p_spk_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SPK Potong dengan ID % tidak ditemukan.', p_spk_id;
  END IF;

  IF v_spk.stage <> 'cutting' THEN
    RAISE EXCEPTION 'Fungsi ini khusus untuk SPK Potong (tahapan saat ini: %).', v_spk.stage;
  END IF;

  IF v_spk.business_status NOT IN ('assigned', 'in_progress') THEN
    RAISE EXCEPTION 'SPK Potong tidak dapat dikerjakan (status: %).', v_spk.business_status;
  END IF;

  -- Validasi Profil Operator
  SELECT * INTO v_profile
  FROM public.production_operator_profile
  WHERE id = v_spk.operator_profile_id;

  -- Validasi Unit Fisik Roll Kain
  SELECT * INTO v_roll
  FROM public.production_material_unit
  WHERE id = p_roll_id AND company_id = v_spk.company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Roll kain fisik dengan ID % tidak ditemukan pada fasilitas ini.', p_roll_id;
  END IF;

  IF v_roll.status <> 'available' THEN
    RAISE EXCEPTION 'Roll kain % tidak berstatus available (status saat ini: %).', v_roll.physical_code, v_roll.status;
  END IF;

  IF p_actual_lines IS NULL OR jsonb_array_length(p_actual_lines) = 0 THEN
    RAISE EXCEPTION 'Wajib mengisi minimal 1 baris hasil aktual potong.';
  END IF;

  IF p_bundles IS NULL OR jsonb_array_length(p_bundles) = 0 THEN
    RAISE EXCEPTION 'Wajib membentuk minimal 1 ikatan komponen (bundle).';
  END IF;

  -- Validasi BOM Material Roll Cocok dengan SKU Hasil Potong
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_actual_lines) LOOP
    v_product_id := (v_line->>'productId')::uuid;
    v_qty := (v_line->>'quantity')::numeric;

    SELECT * INTO v_prod
    FROM public.master_record
    WHERE id = v_product_id AND company_id = v_spk.company_id AND record_kind = 'product';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produk dengan ID % tidak ditemukan.', v_product_id;
    END IF;

    -- Cek ketersediaan formula BOM yang memuat material roll
    IF NOT EXISTS (
      SELECT 1 FROM public.master_record bom
      WHERE bom.company_id = v_spk.company_id
        AND bom.record_kind = 'bom'
        AND bom.is_active = true
        AND bom.data->>'productId' = v_product_id::text
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(coalesce(bom.data->'materialLines', '[]'::jsonb)) mline
          WHERE mline->>'materialId' = v_roll.material_id::text
        )
    ) THEN
      RAISE EXCEPTION 'Material roll % tidak cocok dengan formula BOM SKU %.', v_roll.physical_code, v_prod.name;
    END IF;

    v_total_actual_pcs := v_total_actual_pcs + v_qty;
  END LOOP;

  -- Penomoran Dokumen Aktual Potong: ACT-POT-YYMMDD-###
  v_prefix := 'ACT-POT-' || to_char(p_actual_date, 'YYMMDD') || '-';
  v_seq_key := 'ACT-POT-' || to_char(p_actual_date, 'YYMMDD');

  INSERT INTO public.document_sequence (
    company_id, sequence_key, prefix, padding, current_number, current_value, updated_at
  ) VALUES (
    v_spk.company_id, v_seq_key, v_prefix, 3, 1, 1, now()
  )
  ON CONFLICT (company_id, sequence_key)
  DO UPDATE SET
    current_number = public.document_sequence.current_number + 1,
    current_value = public.document_sequence.current_value + 1,
    updated_at = now()
  RETURNING current_number INTO v_seq_number;

  v_act_number := v_prefix || lpad(v_seq_number::text, 3, '0');
  v_act_id := gen_random_uuid();
  v_lot_code := 'LOT-' || to_char(p_actual_date, 'YYMMDD') || '-' || lpad(v_seq_number::text, 3, '0');

  -- Header Dokumen Aktual (business_document)
  INSERT INTO public.business_document (
    id,
    company_id,
    document_kind,
    document_number,
    status,
    transaction_date,
    source_document_id,
    total_amount,
    paid_amount,
    data,
    version,
    posted_at,
    posted_by_user_id,
    created_by_user_id,
    updated_by_user_id,
    created_at,
    updated_at
  ) VALUES (
    v_act_id,
    v_spk.company_id,
    'cutting_output',
    v_act_number,
    'posted',
    p_actual_date,
    p_spk_id,
    0,
    0,
    jsonb_build_object(
      'physicalRollId', p_roll_id,
      'physicalCode', v_roll.physical_code,
      'totalActualPcs', v_total_actual_pcs,
      'lotCode', v_lot_code
    ),
    1,
    now(),
    p_user_id::text,
    p_user_id::text,
    p_user_id::text,
    now(),
    now()
  );

  -- Konsumsi Roll Fisik secara Utuh
  UPDATE public.production_material_unit
  SET status = 'consumed',
      consumed_by_document_id = v_act_id,
      consumed_at = now()
  WHERE id = p_roll_id;

  -- Buat Entri Cutting Lot
  INSERT INTO public.production_cutting_lot (
    company_id,
    production_order_id,
    cutting_work_order_id,
    source_actual_document_id,
    physical_material_unit_id,
    lot_code,
    created_at
  ) VALUES (
    v_spk.company_id,
    v_spk.production_order_id,
    p_spk_id,
    v_act_id,
    p_roll_id,
    v_lot_code,
    now()
  ) RETURNING id INTO v_lot_id;

  -- Baris Hasil Aktual Potong (business_document_line)
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_actual_lines) LOOP
    v_line_idx := v_line_idx + 1;
    v_product_id := (v_line->>'productId')::uuid;
    v_qty := (v_line->>'quantity')::numeric;

    SELECT * INTO v_prod FROM public.master_record WHERE id = v_product_id;

    INSERT INTO public.business_document_line (
      company_id,
      document_id,
      line_number,
      item_id,
      description,
      unit_code,
      conversion_factor,
      quantity,
      unit_price,
      subtotal,
      total_amount,
      data,
      revision,
      is_current,
      version
    ) VALUES (
      v_spk.company_id,
      v_act_id,
      v_line_idx,
      v_product_id,
      'Hasil Potong ' || v_prod.name,
      'PCS',
      1,
      v_qty,
      0,
      0,
      0,
      jsonb_build_object('cuttingLotId', v_lot_id, 'lotCode', v_lot_code),
      1,
      true,
      1
    );

    -- Hitung Tarif Upah Potong & Bentuk Wage Liability
    SELECT * INTO v_rate
    FROM public.wage_rate
    WHERE company_id = v_spk.company_id AND product_id = v_product_id AND service_kind = 'cutting';

    v_wage_amount := round(v_qty * coalesce(v_rate.rate, 0));
    v_total_wage := v_total_wage + v_wage_amount;

    INSERT INTO public.wage_liability (
      company_id,
      employee_id,
      service_kind,
      quantity,
      rate,
      gross_amount,
      paid_amount,
      item_id,
      source_document_id,
      posted_at
    ) VALUES (
      v_spk.company_id,
      v_profile.employee_id,
      'cutting',
      v_qty,
      coalesce(v_rate.rate, 0),
      v_wage_amount,
      0,
      v_product_id,
      v_act_id,
      now()
    );

    -- Tambah mutasi WIP Potong (cut_components)
    INSERT INTO public.inventory_movement (
      company_id,
      item_id,
      inventory_state,
      movement_type,
      lot_code,
      quantity,
      unit_cost,
      total_cost,
      transaction_date,
      business_date,
      source_document_id,
      posted_at
    ) VALUES (
      v_spk.company_id,
      v_product_id,
      'cut_components',
      'production_wip_in',
      v_lot_code,
      v_qty,
      0,
      0,
      p_actual_date,
      p_actual_date,
      v_act_id,
      now()
    );
  END LOOP;

  -- Pengurangan Stok Bahan Baku Kain (material movement out)
  INSERT INTO public.inventory_movement (
    company_id,
    item_id,
    inventory_state,
    movement_type,
    lot_code,
    quantity,
    unit_cost,
    total_cost,
    transaction_date,
    business_date,
    source_document_id,
    posted_at
  ) VALUES (
    v_spk.company_id,
    v_roll.material_id,
    'material',
    'production_issue',
    v_lot_code,
    -v_roll.initial_base_quantity,
    0,
    0,
    p_actual_date,
    p_actual_date,
    v_act_id,
    now()
  );

  -- Pembentukan Baris Ikatan Komponen (production_bundle)
  v_bundle_idx := 0;
  FOR v_bundle IN SELECT * FROM jsonb_array_elements(p_bundles) LOOP
    v_bundle_idx := v_bundle_idx + 1;
    v_product_id := (v_bundle->>'productId')::uuid;
    v_qty := (v_bundle->>'quantity')::numeric;

    SELECT sku INTO v_sku FROM public.master_record WHERE id = v_product_id;
    v_bundle_code := coalesce(v_bundle->>'bundleCode', v_lot_code || '-' || coalesce(v_sku, 'SKU') || '-' || lpad(v_bundle_idx::text, 2, '0'));

    INSERT INTO public.production_bundle (
      company_id,
      production_order_id,
      cutting_lot_id,
      product_id,
      bundle_code,
      initial_quantity,
      active_quantity,
      final_rejected_quantity,
      stage,
      work_condition,
      last_actual_work_order_id,
      created_at,
      updated_at
    ) VALUES (
      v_spk.company_id,
      v_spk.production_order_id,
      v_lot_id,
      v_product_id,
      v_bundle_code,
      v_qty,
      v_qty,
      0,
      'cutting',
      'available',
      p_spk_id,
      now(),
      now()
    );
  END LOOP;

  -- Perbarui status SPK Potong menjadi in_progress
  UPDATE public.production_work_order
  SET business_status = 'in_progress',
      updated_at = now()
  WHERE document_id = p_spk_id;

  -- Jejak Audit
  INSERT INTO public.audit_log (
    company_id,
    user_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    details,
    created_at
  ) VALUES (
    v_spk.company_id,
    p_user_id::text,
    p_user_id::text,
    'operator.cutting.confirm',
    'business_document',
    v_act_id::text,
    jsonb_build_object(
      'actualNumber', v_act_number,
      'lotCode', v_lot_code,
      'rollCode', v_roll.physical_code,
      'totalActualPcs', v_total_actual_pcs,
      'bundleCount', v_bundle_idx,
      'wageLiabilityAmount', v_total_wage
    ),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'actualId', v_act_id,
    'actualNumber', v_act_number,
    'lotCode', v_lot_code,
    'totalActualPcs', v_total_actual_pcs,
    'bundleCount', v_bundle_idx,
    'wageAmount', v_total_wage
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_operator_packing(p_spk_id uuid, p_bundle_id uuid, p_success_qty integer, p_notes text, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_spk RECORD;
  v_bundle RECORD;
  v_profile RECORD;
  v_act_id uuid;
  v_prefix text;
  v_seq_key text;
  v_seq_number bigint;
  v_act_number text;
  v_worked_qty integer;
  v_rate RECORD;
  v_wage_rate bigint;
  v_wage_amount bigint := 0;
  v_all_completed boolean := false;
BEGIN
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  p_user_id := tenant_private.assert_mis_company_access((SELECT d.company_id FROM public.production_work_order w JOIN public.business_document d ON d.id=w.document_id WHERE w.document_id=p_spk_id), p_user_id);
  -- Validasi SPK Packing
  SELECT pwo.*, bd.company_id, bd.document_number as spk_number INTO v_spk
  FROM public.production_work_order pwo
  JOIN public.business_document bd ON bd.id = pwo.document_id
  WHERE pwo.document_id = p_spk_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SPK Packing dengan ID % tidak ditemukan.', p_spk_id;
  END IF;

  IF v_spk.stage <> 'packing' THEN
    RAISE EXCEPTION 'Fungsi ini khusus untuk SPK Packing (tahapan saat ini: %).', v_spk.stage;
  END IF;

  IF v_spk.business_status NOT IN ('assigned', 'in_progress') THEN
    RAISE EXCEPTION 'SPK Packing tidak dapat dikerjakan (status: %).', v_spk.business_status;
  END IF;

  -- Validasi Profil Operator Packing
  SELECT * INTO v_profile
  FROM public.production_operator_profile
  WHERE id = v_spk.operator_profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profil operator packing tidak ditemukan.';
  END IF;

  -- Kunci Ikatan Komponen
  SELECT b.*, lot.lot_code INTO v_bundle
  FROM public.production_bundle b
  JOIN public.production_cutting_lot lot ON lot.id = b.cutting_lot_id
  WHERE b.id = p_bundle_id AND b.company_id = v_spk.company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ikatan komponen dengan ID % tidak ditemukan.', p_bundle_id;
  END IF;

  -- Pastikan ikatan terdaftar pada SPK ini
  IF NOT EXISTS (
    SELECT 1 FROM public.production_work_order_bundle
    WHERE work_order_id = p_spk_id AND bundle_id = p_bundle_id
  ) THEN
    RAISE EXCEPTION 'Ikatan % tidak terdaftar pada SPK Packing ini.', v_bundle.bundle_code;
  END IF;

  -- Pastikan ikatan belum pernah diproses pada tahapan packing di SPK ini
  IF EXISTS (
    SELECT 1 FROM public.production_bundle_stage_result
    WHERE work_order_id = p_spk_id AND bundle_id = p_bundle_id
  ) THEN
    RAISE EXCEPTION 'Ikatan % sudah memiliki hasil pengerjaan pada SPK Packing ini.', v_bundle.bundle_code;
  END IF;

  v_worked_qty := v_bundle.active_quantity::integer;

  -- Validasi Kuantitas: p_success_qty = bundle.active_quantity
  IF p_success_qty <= 0 THEN
    RAISE EXCEPTION 'Kuantitas hasil packing harus lebih besar dari 0.';
  END IF;

  IF p_success_qty <> v_worked_qty THEN
    RAISE EXCEPTION 'Kuantitas hasil packing (%) wajib tepat sama dengan kuantitas aktif ikatan (%).',
      p_success_qty, v_worked_qty;
  END IF;

  -- Penomoran Dokumen Aktual Packing: ACT-PCK-YYMMDD-###
  v_prefix := 'ACT-PCK-' || to_char(current_date, 'YYMMDD') || '-';
  v_seq_key := 'ACT-PCK-' || to_char(current_date, 'YYMMDD');

  INSERT INTO public.document_sequence (
    company_id, sequence_key, prefix, padding, current_number, current_value, updated_at
  ) VALUES (
    v_spk.company_id, v_seq_key, v_prefix, 3, 1, 1, now()
  )
  ON CONFLICT (company_id, sequence_key)
  DO UPDATE SET
    current_number = public.document_sequence.current_number + 1,
    current_value = public.document_sequence.current_value + 1,
    updated_at = now()
  RETURNING current_number INTO v_seq_number;

  v_act_number := v_prefix || lpad(v_seq_number::text, 3, '0');
  v_act_id := gen_random_uuid();

  -- Header Dokumen Aktual Packing (business_document)
  INSERT INTO public.business_document (
    id,
    company_id,
    document_kind,
    document_number,
    status,
    transaction_date,
    source_document_id,
    total_amount,
    paid_amount,
    data,
    version,
    posted_at,
    posted_by_user_id,
    created_by_user_id,
    updated_by_user_id,
    created_at,
    updated_at
  ) VALUES (
    v_act_id,
    v_spk.company_id,
    'packing_output',
    v_act_number,
    'posted',
    current_date,
    p_spk_id,
    0,
    0,
    jsonb_build_object(
      'bundleId', p_bundle_id,
      'bundleCode', v_bundle.bundle_code,
      'workedQuantity', v_worked_qty,
      'successQuantity', p_success_qty,
      'notes', coalesce(p_notes, '')
    ),
    1,
    now(),
    p_user_id::text,
    p_user_id::text,
    p_user_id::text,
    now(),
    now()
  );

  -- Baris Hasil Pengerjaan Tahap (production_bundle_stage_result)
  INSERT INTO public.production_bundle_stage_result (
    company_id,
    production_order_id,
    work_order_id,
    actual_document_id,
    bundle_id,
    stage,
    worked_quantity,
    success_quantity,
    repair_quantity,
    final_rejected_quantity,
    created_at
  ) VALUES (
    v_spk.company_id,
    v_spk.production_order_id,
    p_spk_id,
    v_act_id,
    p_bundle_id,
    'packing',
    v_worked_qty,
    p_success_qty,
    0,
    0,
    now()
  );

  -- Mutasi Produk Jadi Siap Jual (packed_finished_goods)
  INSERT INTO public.inventory_movement (
    company_id,
    item_id,
    inventory_state,
    movement_type,
    lot_code,
    quantity,
    unit_cost,
    total_cost,
    transaction_date,
    business_date,
    source_document_id,
    posted_at
  ) VALUES (
    v_spk.company_id,
    v_bundle.product_id,
    'packed_finished_goods',
    'production_receipt',
    v_bundle.lot_code,
    p_success_qty,
    0,
    0,
    current_date,
    current_date,
    v_act_id,
    now()
  );

  -- Perbarui status ikatan bundle menjadi completed
  UPDATE public.production_bundle
  SET stage = 'packing',
      work_condition = 'completed',
      active_quantity = p_success_qty,
      last_actual_work_order_id = p_spk_id,
      updated_at = now()
  WHERE id = p_bundle_id;

  -- Lepaskan reservasi ikatan dari SPK Packing
  DELETE FROM public.production_bundle_reservation
  WHERE bundle_id = p_bundle_id;

  -- Hitung Kewajiban Upah Packing (Qty Dikerjakan penuh * tarif, default Rp 1.000 jika 0/null)
  SELECT * INTO v_rate
  FROM public.wage_rate
  WHERE company_id = v_spk.company_id AND product_id = v_bundle.product_id AND service_kind = 'packing';

  IF v_rate.rate IS NULL OR v_rate.rate = 0 THEN
    v_wage_rate := 1000;
  ELSE
    v_wage_rate := v_rate.rate;
  END IF;

  v_wage_amount := round(v_worked_qty * v_wage_rate);

  INSERT INTO public.wage_liability (
    company_id,
    employee_id,
    service_kind,
    quantity,
    rate,
    gross_amount,
    paid_amount,
    item_id,
    source_document_id,
    posted_at
  ) VALUES (
    v_spk.company_id,
    v_profile.employee_id,
    'packing',
    v_worked_qty,
    v_wage_rate,
    v_wage_amount,
    0,
    v_bundle.product_id,
    v_act_id,
    now()
  );

  -- Cek apakah seluruh bundle pada SPK Packing ini telah memiliki hasil pengerjaan
  SELECT NOT EXISTS (
    SELECT 1 FROM public.production_work_order_bundle wob
    WHERE wob.work_order_id = p_spk_id
      AND NOT EXISTS (
        SELECT 1 FROM public.production_bundle_stage_result bsr
        WHERE bsr.work_order_id = p_spk_id AND bsr.bundle_id = wob.bundle_id
      )
  ) INTO v_all_completed;

  IF v_all_completed THEN
    UPDATE public.production_work_order
    SET business_status = 'completed',
        updated_at = now()
    WHERE document_id = p_spk_id;
  ELSE
    UPDATE public.production_work_order
    SET business_status = 'in_progress',
        updated_at = now()
    WHERE document_id = p_spk_id;
  END IF;

  -- Jejak Audit
  INSERT INTO public.audit_log (
    company_id,
    user_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    details,
    created_at
  ) VALUES (
    v_spk.company_id,
    p_user_id::text,
    p_user_id::text,
    'operator.packing.confirm',
    'business_document',
    v_act_id::text,
    jsonb_build_object(
      'actualNumber', v_act_number,
      'bundleCode', v_bundle.bundle_code,
      'workedQuantity', v_worked_qty,
      'successQuantity', p_success_qty,
      'wageAmount', v_wage_amount
    ),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'actualId', v_act_id,
    'actualNumber', v_act_number,
    'bundleCode', v_bundle.bundle_code,
    'successQuantity', p_success_qty,
    'wageAmount', v_wage_amount,
    'spkCompleted', v_all_completed
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_operator_packing(p_spk_id uuid, p_bundle_id uuid, p_success_qty integer, p_repair_qty integer, p_reject_qty integer, p_notes text, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_spk RECORD;
  v_bundle RECORD;
  v_profile RECORD;
  v_act_id uuid;
  v_prefix text;
  v_seq_key text;
  v_seq_number bigint;
  v_act_number text;
  v_worked_qty integer;
  v_rate RECORD;
  v_wage_amount bigint := 0;
  v_repair_case_id uuid := NULL;
  v_all_completed boolean := false;
BEGIN
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  p_user_id := tenant_private.assert_mis_company_access((SELECT d.company_id FROM public.production_work_order w JOIN public.business_document d ON d.id=w.document_id WHERE w.document_id=p_spk_id), p_user_id);
  -- Validasi SPK Packing
  SELECT pwo.*, bd.company_id, bd.document_number as spk_number INTO v_spk
  FROM public.production_work_order pwo
  JOIN public.business_document bd ON bd.id = pwo.document_id
  WHERE pwo.document_id = p_spk_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SPK Packing dengan ID % tidak ditemukan.', p_spk_id;
  END IF;

  IF v_spk.stage <> 'packing' THEN
    RAISE EXCEPTION 'Fungsi ini khusus untuk SPK Packing (tahapan saat ini: %).', v_spk.stage;
  END IF;

  IF v_spk.business_status NOT IN ('assigned', 'in_progress') THEN
    RAISE EXCEPTION 'SPK Packing tidak dapat dikerjakan (status: %).', v_spk.business_status;
  END IF;

  -- Validasi Profil Operator Packing
  SELECT * INTO v_profile
  FROM public.production_operator_profile
  WHERE id = v_spk.operator_profile_id;

  -- Kunci Ikatan Komponen
  SELECT b.*, lot.lot_code INTO v_bundle
  FROM public.production_bundle b
  JOIN public.production_cutting_lot lot ON lot.id = b.cutting_lot_id
  WHERE b.id = p_bundle_id AND b.company_id = v_spk.company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ikatan komponen dengan ID % tidak ditemukan.', p_bundle_id;
  END IF;

  -- Pastikan ikatan terdaftar pada SPK ini
  IF NOT EXISTS (
    SELECT 1 FROM public.production_work_order_bundle
    WHERE work_order_id = p_spk_id AND bundle_id = p_bundle_id
  ) THEN
    RAISE EXCEPTION 'Ikatan % tidak terdaftar pada SPK Packing ini.', v_bundle.bundle_code;
  END IF;

  v_worked_qty := v_bundle.active_quantity::integer;

  -- Validasi Invariant Kuantitas: success + repair + reject = active_quantity
  IF p_success_qty < 0 OR p_repair_qty < 0 OR p_reject_qty < 0 THEN
    RAISE EXCEPTION 'Kuantitas hasil packing tidak boleh negatif.';
  END IF;

  IF (p_success_qty + p_repair_qty + p_reject_qty) <> v_worked_qty THEN
    RAISE EXCEPTION 'Total kuantitas hasil packing (% + % + % = %) wajib tepat sama dengan kuantitas aktif ikatan (%).',
      p_success_qty, p_repair_qty, p_reject_qty, (p_success_qty + p_repair_qty + p_reject_qty), v_worked_qty;
  END IF;

  -- Penomoran Dokumen Aktual Packing: ACT-PCK-YYMMDD-###
  v_prefix := 'ACT-PCK-' || to_char(current_date, 'YYMMDD') || '-';
  v_seq_key := 'ACT-PCK-' || to_char(current_date, 'YYMMDD');

  INSERT INTO public.document_sequence (
    company_id, sequence_key, prefix, padding, current_number, current_value, updated_at
  ) VALUES (
    v_spk.company_id, v_seq_key, v_prefix, 3, 1, 1, now()
  )
  ON CONFLICT (company_id, sequence_key)
  DO UPDATE SET
    current_number = public.document_sequence.current_number + 1,
    current_value = public.document_sequence.current_value + 1,
    updated_at = now()
  RETURNING current_number INTO v_seq_number;

  v_act_number := v_prefix || lpad(v_seq_number::text, 3, '0');
  v_act_id := gen_random_uuid();

  -- Header Dokumen Aktual Packing (business_document)
  INSERT INTO public.business_document (
    id,
    company_id,
    document_kind,
    document_number,
    status,
    transaction_date,
    source_document_id,
    total_amount,
    paid_amount,
    data,
    version,
    posted_at,
    posted_by_user_id,
    created_by_user_id,
    updated_by_user_id,
    created_at,
    updated_at
  ) VALUES (
    v_act_id,
    v_spk.company_id,
    'packing_output',
    v_act_number,
    'posted',
    current_date,
    p_spk_id,
    0,
    0,
    jsonb_build_object(
      'bundleId', p_bundle_id,
      'bundleCode', v_bundle.bundle_code,
      'workedQuantity', v_worked_qty,
      'successQuantity', p_success_qty,
      'repairQuantity', p_repair_qty,
      'rejectQuantity', p_reject_qty,
      'notes', coalesce(p_notes, '')
    ),
    1,
    now(),
    p_user_id::text,
    p_user_id::text,
    p_user_id::text,
    now(),
    now()
  );

  -- Baris Hasil Pengerjaan Tahap (production_bundle_stage_result)
  INSERT INTO public.production_bundle_stage_result (
    company_id,
    production_order_id,
    work_order_id,
    actual_document_id,
    bundle_id,
    stage,
    worked_quantity,
    success_quantity,
    repair_quantity,
    final_rejected_quantity,
    created_at
  ) VALUES (
    v_spk.company_id,
    v_spk.production_order_id,
    p_spk_id,
    v_act_id,
    p_bundle_id,
    'packing',
    v_worked_qty,
    p_success_qty,
    p_repair_qty,
    p_reject_qty,
    now()
  );

  -- Jika ada reject final, catat mutasi persediaan waste
  IF p_reject_qty > 0 THEN
    INSERT INTO public.inventory_movement (
      company_id,
      item_id,
      inventory_state,
      movement_type,
      lot_code,
      quantity,
      unit_cost,
      total_cost,
      transaction_date,
      business_date,
      source_document_id,
      posted_at
    ) VALUES (
      v_spk.company_id,
      v_bundle.product_id,
      'waste',
      'production_reject',
      v_bundle.lot_code,
      p_reject_qty,
      0,
      0,
      current_date,
      current_date,
      v_act_id,
      now()
    );
  END IF;

  -- Jika ada pengerjaan berhasil, catat mutasi ke packed_finished_goods (Stok Produk Jadi siap jual)
  IF p_success_qty > 0 THEN
    INSERT INTO public.inventory_movement (
      company_id,
      item_id,
      inventory_state,
      movement_type,
      lot_code,
      quantity,
      unit_cost,
      total_cost,
      transaction_date,
      business_date,
      source_document_id,
      posted_at
    ) VALUES (
      v_spk.company_id,
      v_bundle.product_id,
      'packed_finished_goods',
      'production_wip_transfer',
      v_bundle.lot_code,
      p_success_qty,
      0,
      0,
      current_date,
      current_date,
      v_act_id,
      now()
    );
  END IF;

  -- Jika ada kuantitas cacat/perbaikan, bentuk baris Kasus Perbaikan
  IF p_repair_qty > 0 THEN
    INSERT INTO public.production_repair_case (
      company_id,
      production_order_id,
      source_work_order_id,
      bundle_id,
      found_at_stage,
      repair_work_kind,
      quantity,
      issue_reason,
      business_status,
      created_at,
      updated_at
    ) VALUES (
      v_spk.company_id,
      v_spk.production_order_id,
      p_spk_id,
      p_bundle_id,
      'packing',
      'packing',
      p_repair_qty,
      coalesce(p_notes, 'Cacat hasil packing operator'),
      'pending_assignment',
      now(),
      now()
    ) RETURNING id INTO v_repair_case_id;

    -- Bundle tertahan perbaikan (repair_hold)
    UPDATE public.production_bundle
    SET stage = 'packing',
        work_condition = 'repair_hold',
        active_quantity = p_success_qty + p_repair_qty,
        final_rejected_quantity = v_bundle.final_rejected_quantity + p_reject_qty,
        last_actual_work_order_id = p_spk_id,
        updated_at = now()
    WHERE id = p_bundle_id;
  ELSE
    -- Jika tidak ada repair
    IF p_success_qty > 0 THEN
      -- Selesai packing, produk selesai diproduksi dan siap dijual
      UPDATE public.production_bundle
      SET stage = 'completed',
          work_condition = 'completed',
          active_quantity = p_success_qty,
          final_rejected_quantity = v_bundle.final_rejected_quantity + p_reject_qty,
          last_actual_work_order_id = p_spk_id,
          updated_at = now()
      WHERE id = p_bundle_id;
    ELSE
      -- Seluruhnya reject
      UPDATE public.production_bundle
      SET stage = 'completed',
          work_condition = 'completed',
          active_quantity = 0,
          final_rejected_quantity = v_bundle.final_rejected_quantity + p_reject_qty,
          last_actual_work_order_id = p_spk_id,
          updated_at = now()
      WHERE id = p_bundle_id;
    END IF;
  END IF;

  -- Lepaskan reservasi ikatan dari SPK Packing
  DELETE FROM public.production_bundle_reservation
  WHERE bundle_id = p_bundle_id;

  -- Hitung Kewajiban Upah Packing (Qty Dikerjakan penuh * tarif)
  SELECT * INTO v_rate
  FROM public.wage_rate
  WHERE company_id = v_spk.company_id AND product_id = v_bundle.product_id AND service_kind = 'packing';

  v_wage_amount := round(v_worked_qty * coalesce(v_rate.rate, 0));

  INSERT INTO public.wage_liability (
    company_id,
    employee_id,
    service_kind,
    quantity,
    rate,
    gross_amount,
    paid_amount,
    item_id,
    source_document_id,
    posted_at
  ) VALUES (
    v_spk.company_id,
    v_profile.employee_id,
    'packing',
    v_worked_qty,
    coalesce(v_rate.rate, 0),
    v_wage_amount,
    0,
    v_bundle.product_id,
    v_act_id,
    now()
  );

  -- Cek apakah seluruh bundle pada SPK Packing ini telah memiliki hasil pengerjaan
  SELECT NOT EXISTS (
    SELECT 1 FROM public.production_work_order_bundle wob
    WHERE wob.work_order_id = p_spk_id
      AND NOT EXISTS (
        SELECT 1 FROM public.production_bundle_stage_result bsr
        WHERE bsr.work_order_id = p_spk_id AND bsr.bundle_id = wob.bundle_id
      )
  ) INTO v_all_completed;

  IF v_all_completed THEN
    UPDATE public.production_work_order
    SET business_status = 'completed',
        updated_at = now()
    WHERE document_id = p_spk_id;
  ELSE
    UPDATE public.production_work_order
    SET business_status = 'in_progress',
        updated_at = now()
    WHERE document_id = p_spk_id;
  END IF;

  -- Jejak Audit
  INSERT INTO public.audit_log (
    company_id,
    user_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    details,
    created_at
  ) VALUES (
    v_spk.company_id,
    p_user_id::text,
    p_user_id::text,
    'operator.packing.confirm',
    'business_document',
    v_act_id::text,
    jsonb_build_object(
      'actualNumber', v_act_number,
      'bundleCode', v_bundle.bundle_code,
      'workedQuantity', v_worked_qty,
      'successQuantity', p_success_qty,
      'repairQuantity', p_repair_qty,
      'rejectQuantity', p_reject_qty,
      'wageAmount', v_wage_amount,
      'repairCaseId', v_repair_case_id
    ),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'actualId', v_act_id,
    'actualNumber', v_act_number,
    'bundleCode', v_bundle.bundle_code,
    'successQuantity', p_success_qty,
    'repairQuantity', p_repair_qty,
    'rejectQuantity', p_reject_qty,
    'wageAmount', v_wage_amount,
    'repairCaseId', v_repair_case_id,
    'spkCompleted', v_all_completed
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_operator_printing(p_spk_id uuid, p_bundle_id uuid, p_success_qty integer, p_repair_qty integer, p_reject_qty integer, p_notes text, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_spk RECORD;
  v_bundle RECORD;
  v_profile RECORD;
  v_act_id uuid;
  v_prefix text;
  v_seq_key text;
  v_seq_number bigint;
  v_act_number text;
  v_worked_qty integer;
  v_rate RECORD;
  v_wage_amount bigint := 0;
  v_repair_case_id uuid := NULL;
  v_all_completed boolean := false;
BEGIN
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  p_user_id := tenant_private.assert_mis_company_access((SELECT d.company_id FROM public.production_work_order w JOIN public.business_document d ON d.id=w.document_id WHERE w.document_id=p_spk_id), p_user_id);
  -- Validasi SPK Sablon
  SELECT pwo.*, bd.company_id, bd.document_number as spk_number INTO v_spk
  FROM public.production_work_order pwo
  JOIN public.business_document bd ON bd.id = pwo.document_id
  WHERE pwo.document_id = p_spk_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SPK Sablon dengan ID % tidak ditemukan.', p_spk_id;
  END IF;

  IF v_spk.stage <> 'printing' THEN
    RAISE EXCEPTION 'Fungsi ini khusus untuk SPK Sablon (tahapan saat ini: %).', v_spk.stage;
  END IF;

  IF v_spk.business_status NOT IN ('assigned', 'in_progress') THEN
    RAISE EXCEPTION 'SPK Sablon tidak dapat dikerjakan (status: %).', v_spk.business_status;
  END IF;

  -- Validasi Profil Operator Sablon
  SELECT * INTO v_profile
  FROM public.production_operator_profile
  WHERE id = v_spk.operator_profile_id;

  -- Kunci Ikatan Komponen
  SELECT b.*, lot.lot_code INTO v_bundle
  FROM public.production_bundle b
  JOIN public.production_cutting_lot lot ON lot.id = b.cutting_lot_id
  WHERE b.id = p_bundle_id AND b.company_id = v_spk.company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ikatan komponen dengan ID % tidak ditemukan.', p_bundle_id;
  END IF;

  -- Pastikan ikatan terdaftar pada SPK ini
  IF NOT EXISTS (
    SELECT 1 FROM public.production_work_order_bundle
    WHERE work_order_id = p_spk_id AND bundle_id = p_bundle_id
  ) THEN
    RAISE EXCEPTION 'Ikatan % tidak terdaftar pada SPK Sablon ini.', v_bundle.bundle_code;
  END IF;

  v_worked_qty := v_bundle.active_quantity::integer;

  -- Validasi Invariant Kuantitas: success + repair + reject = active_quantity
  IF p_success_qty < 0 OR p_repair_qty < 0 OR p_reject_qty < 0 THEN
    RAISE EXCEPTION 'Kuantitas hasil sablon tidak boleh negatif.';
  END IF;

  IF (p_success_qty + p_repair_qty + p_reject_qty) <> v_worked_qty THEN
    RAISE EXCEPTION 'Total kuantitas hasil sablon (% + % + % = %) wajib tepat sama dengan kuantitas aktif ikatan (%).',
      p_success_qty, p_repair_qty, p_reject_qty, (p_success_qty + p_repair_qty + p_reject_qty), v_worked_qty;
  END IF;

  -- Penomoran Dokumen Aktual Sablon: ACT-SAB-YYMMDD-###
  v_prefix := 'ACT-SAB-' || to_char(current_date, 'YYMMDD') || '-';
  v_seq_key := 'ACT-SAB-' || to_char(current_date, 'YYMMDD');

  INSERT INTO public.document_sequence (
    company_id, sequence_key, prefix, padding, current_number, current_value, updated_at
  ) VALUES (
    v_spk.company_id, v_seq_key, v_prefix, 3, 1, 1, now()
  )
  ON CONFLICT (company_id, sequence_key)
  DO UPDATE SET
    current_number = public.document_sequence.current_number + 1,
    current_value = public.document_sequence.current_value + 1,
    updated_at = now()
  RETURNING current_number INTO v_seq_number;

  v_act_number := v_prefix || lpad(v_seq_number::text, 3, '0');
  v_act_id := gen_random_uuid();

  -- Header Dokumen Aktual Sablon (business_document)
  INSERT INTO public.business_document (
    id,
    company_id,
    document_kind,
    document_number,
    status,
    transaction_date,
    source_document_id,
    total_amount,
    paid_amount,
    data,
    version,
    posted_at,
    posted_by_user_id,
    created_by_user_id,
    updated_by_user_id,
    created_at,
    updated_at
  ) VALUES (
    v_act_id,
    v_spk.company_id,
    'printing_output',
    v_act_number,
    'posted',
    current_date,
    p_spk_id,
    0,
    0,
    jsonb_build_object(
      'bundleId', p_bundle_id,
      'bundleCode', v_bundle.bundle_code,
      'workedQuantity', v_worked_qty,
      'successQuantity', p_success_qty,
      'repairQuantity', p_repair_qty,
      'rejectQuantity', p_reject_qty,
      'notes', coalesce(p_notes, '')
    ),
    1,
    now(),
    p_user_id::text,
    p_user_id::text,
    p_user_id::text,
    now(),
    now()
  );

  -- Baris Hasil Pengerjaan Tahap (production_bundle_stage_result)
  INSERT INTO public.production_bundle_stage_result (
    company_id,
    production_order_id,
    work_order_id,
    actual_document_id,
    bundle_id,
    stage,
    worked_quantity,
    success_quantity,
    repair_quantity,
    final_rejected_quantity,
    created_at
  ) VALUES (
    v_spk.company_id,
    v_spk.production_order_id,
    p_spk_id,
    v_act_id,
    p_bundle_id,
    'printing',
    v_worked_qty,
    p_success_qty,
    p_repair_qty,
    p_reject_qty,
    now()
  );

  -- Jika ada reject final, catat mutasi persediaan waste
  IF p_reject_qty > 0 THEN
    INSERT INTO public.inventory_movement (
      company_id,
      item_id,
      inventory_state,
      movement_type,
      lot_code,
      quantity,
      unit_cost,
      total_cost,
      transaction_date,
      business_date,
      source_document_id,
      posted_at
    ) VALUES (
      v_spk.company_id,
      v_bundle.product_id,
      'waste',
      'production_reject',
      v_bundle.lot_code,
      p_reject_qty,
      0,
      0,
      current_date,
      current_date,
      v_act_id,
      now()
    );
  END IF;

  -- Jika ada pengerjaan berhasil, catat mutasi WIP ke printed_components
  IF p_success_qty > 0 THEN
    INSERT INTO public.inventory_movement (
      company_id,
      item_id,
      inventory_state,
      movement_type,
      lot_code,
      quantity,
      unit_cost,
      total_cost,
      transaction_date,
      business_date,
      source_document_id,
      posted_at
    ) VALUES (
      v_spk.company_id,
      v_bundle.product_id,
      'printed_components',
      'production_wip_transfer',
      v_bundle.lot_code,
      p_success_qty,
      0,
      0,
      current_date,
      current_date,
      v_act_id,
      now()
    );
  END IF;

  -- Jika ada kuantitas cacat/perbaikan, bentuk baris Kasus Perbaikan
  IF p_repair_qty > 0 THEN
    INSERT INTO public.production_repair_case (
      company_id,
      production_order_id,
      source_work_order_id,
      bundle_id,
      found_at_stage,
      repair_work_kind,
      quantity,
      issue_reason,
      business_status,
      created_at,
      updated_at
    ) VALUES (
      v_spk.company_id,
      v_spk.production_order_id,
      p_spk_id,
      p_bundle_id,
      'printing',
      'printing',
      p_repair_qty,
      coalesce(p_notes, 'Cacat hasil sablon operator'),
      'pending_assignment',
      now(),
      now()
    ) RETURNING id INTO v_repair_case_id;

    -- Bundle tertahan perbaikan (repair_hold)
    UPDATE public.production_bundle
    SET stage = 'printing',
        work_condition = 'repair_hold',
        active_quantity = p_success_qty + p_repair_qty,
        final_rejected_quantity = v_bundle.final_rejected_quantity + p_reject_qty,
        last_actual_work_order_id = p_spk_id,
        updated_at = now()
    WHERE id = p_bundle_id;
  ELSE
    -- Jika tidak ada repair
    IF p_success_qty > 0 THEN
      -- Selesai sablon, siap masuk SPK Jahit
      UPDATE public.production_bundle
      SET stage = 'printing',
          work_condition = 'available',
          active_quantity = p_success_qty,
          final_rejected_quantity = v_bundle.final_rejected_quantity + p_reject_qty,
          last_actual_work_order_id = p_spk_id,
          updated_at = now()
      WHERE id = p_bundle_id;
    ELSE
      -- Seluruhnya reject
      UPDATE public.production_bundle
      SET stage = 'printing',
          work_condition = 'completed',
          active_quantity = 0,
          final_rejected_quantity = v_bundle.final_rejected_quantity + p_reject_qty,
          last_actual_work_order_id = p_spk_id,
          updated_at = now()
      WHERE id = p_bundle_id;
    END IF;
  END IF;

  -- Lepaskan reservasi ikatan dari SPK Sablon
  DELETE FROM public.production_bundle_reservation
  WHERE bundle_id = p_bundle_id;

  -- Hitung Kewajiban Upah Sablon (Qty Dikerjakan penuh * tarif)
  SELECT * INTO v_rate
  FROM public.wage_rate
  WHERE company_id = v_spk.company_id AND product_id = v_bundle.product_id AND service_kind = 'printing';

  v_wage_amount := round(v_worked_qty * coalesce(v_rate.rate, 0));

  INSERT INTO public.wage_liability (
    company_id,
    employee_id,
    service_kind,
    quantity,
    rate,
    gross_amount,
    paid_amount,
    item_id,
    source_document_id,
    posted_at
  ) VALUES (
    v_spk.company_id,
    v_profile.employee_id,
    'printing',
    v_worked_qty,
    coalesce(v_rate.rate, 0),
    v_wage_amount,
    0,
    v_bundle.product_id,
    v_act_id,
    now()
  );

  -- Cek apakah seluruh bundle pada SPK Sablon ini telah memiliki hasil pengerjaan
  SELECT NOT EXISTS (
    SELECT 1 FROM public.production_work_order_bundle wob
    WHERE wob.work_order_id = p_spk_id
      AND NOT EXISTS (
        SELECT 1 FROM public.production_bundle_stage_result bsr
        WHERE bsr.work_order_id = p_spk_id AND bsr.bundle_id = wob.bundle_id
      )
  ) INTO v_all_completed;

  IF v_all_completed THEN
    UPDATE public.production_work_order
    SET business_status = 'completed',
        updated_at = now()
    WHERE document_id = p_spk_id;
  ELSE
    UPDATE public.production_work_order
    SET business_status = 'in_progress',
        updated_at = now()
    WHERE document_id = p_spk_id;
  END IF;

  -- Jejak Audit
  INSERT INTO public.audit_log (
    company_id,
    user_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    details,
    created_at
  ) VALUES (
    v_spk.company_id,
    p_user_id::text,
    p_user_id::text,
    'operator.printing.confirm',
    'business_document',
    v_act_id::text,
    jsonb_build_object(
      'actualNumber', v_act_number,
      'bundleCode', v_bundle.bundle_code,
      'workedQuantity', v_worked_qty,
      'successQuantity', p_success_qty,
      'repairQuantity', p_repair_qty,
      'rejectQuantity', p_reject_qty,
      'wageAmount', v_wage_amount,
      'repairCaseId', v_repair_case_id
    ),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'actualId', v_act_id,
    'actualNumber', v_act_number,
    'bundleCode', v_bundle.bundle_code,
    'successQuantity', p_success_qty,
    'repairQuantity', p_repair_qty,
    'rejectQuantity', p_reject_qty,
    'wageAmount', v_wage_amount,
    'repairCaseId', v_repair_case_id,
    'spkCompleted', v_all_completed
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_operator_sewing(p_spk_id uuid, p_bundle_id uuid, p_success_qty integer, p_repair_qty integer, p_reject_qty integer, p_notes text, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_spk RECORD;
  v_bundle RECORD;
  v_profile RECORD;
  v_act_id uuid;
  v_prefix text;
  v_seq_key text;
  v_seq_number bigint;
  v_act_number text;
  v_worked_qty integer;
  v_rate RECORD;
  v_wage_rate bigint;
  v_wage_amount bigint := 0;
  v_repair_case_id uuid := NULL;
  v_all_completed boolean := false;
BEGIN
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  p_user_id := tenant_private.assert_mis_company_access((SELECT d.company_id FROM public.production_work_order w JOIN public.business_document d ON d.id=w.document_id WHERE w.document_id=p_spk_id), p_user_id);
  -- Validasi SPK Jahit
  SELECT pwo.*, bd.company_id, bd.document_number as spk_number INTO v_spk
  FROM public.production_work_order pwo
  JOIN public.business_document bd ON bd.id = pwo.document_id
  WHERE pwo.document_id = p_spk_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SPK Jahit dengan ID % tidak ditemukan.', p_spk_id;
  END IF;

  IF v_spk.stage <> 'sewing' THEN
    RAISE EXCEPTION 'Fungsi ini khusus untuk SPK Jahit (tahapan saat ini: %).', v_spk.stage;
  END IF;

  IF v_spk.business_status NOT IN ('assigned', 'in_progress') THEN
    RAISE EXCEPTION 'SPK Jahit tidak dapat dikerjakan (status: %).', v_spk.business_status;
  END IF;

  -- Validasi Profil Operator Jahit
  SELECT * INTO v_profile
  FROM public.production_operator_profile
  WHERE id = v_spk.operator_profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profil operator jahit tidak ditemukan.';
  END IF;

  -- Kunci Ikatan Komponen
  SELECT b.*, lot.lot_code INTO v_bundle
  FROM public.production_bundle b
  JOIN public.production_cutting_lot lot ON lot.id = b.cutting_lot_id
  WHERE b.id = p_bundle_id AND b.company_id = v_spk.company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ikatan komponen dengan ID % tidak ditemukan.', p_bundle_id;
  END IF;

  -- Pastikan ikatan terdaftar pada SPK ini
  IF NOT EXISTS (
    SELECT 1 FROM public.production_work_order_bundle
    WHERE work_order_id = p_spk_id AND bundle_id = p_bundle_id
  ) THEN
    RAISE EXCEPTION 'Ikatan % tidak terdaftar pada SPK Jahit ini.', v_bundle.bundle_code;
  END IF;

  -- Pastikan ikatan belum pernah diproses pada tahapan jahit di SPK ini
  IF EXISTS (
    SELECT 1 FROM public.production_bundle_stage_result
    WHERE work_order_id = p_spk_id AND bundle_id = p_bundle_id
  ) THEN
    RAISE EXCEPTION 'Ikatan % sudah memiliki hasil pengerjaan pada SPK Jahit ini.', v_bundle.bundle_code;
  END IF;

  v_worked_qty := v_bundle.active_quantity::integer;

  -- Validasi Invariant Kuantitas: success + repair + reject = active_quantity
  IF p_success_qty < 0 OR p_repair_qty < 0 OR p_reject_qty < 0 THEN
    RAISE EXCEPTION 'Kuantitas hasil jahit tidak boleh negatif.';
  END IF;

  IF (p_success_qty + p_repair_qty + p_reject_qty) <> v_worked_qty THEN
    RAISE EXCEPTION 'Total kuantitas hasil jahit (% + % + % = %) wajib tepat sama dengan kuantitas aktif ikatan (%).',
      p_success_qty, p_repair_qty, p_reject_qty, (p_success_qty + p_repair_qty + p_reject_qty), v_worked_qty;
  END IF;

  -- Penomoran Dokumen Aktual Jahit: ACT-JAH-YYMMDD-###
  v_prefix := 'ACT-JAH-' || to_char(current_date, 'YYMMDD') || '-';
  v_seq_key := 'ACT-JAH-' || to_char(current_date, 'YYMMDD');

  INSERT INTO public.document_sequence (
    company_id, sequence_key, prefix, padding, current_number, current_value, updated_at
  ) VALUES (
    v_spk.company_id, v_seq_key, v_prefix, 3, 1, 1, now()
  )
  ON CONFLICT (company_id, sequence_key)
  DO UPDATE SET
    current_number = public.document_sequence.current_number + 1,
    current_value = public.document_sequence.current_value + 1,
    updated_at = now()
  RETURNING current_number INTO v_seq_number;

  v_act_number := v_prefix || lpad(v_seq_number::text, 3, '0');
  v_act_id := gen_random_uuid();

  -- Header Dokumen Aktual Jahit (business_document)
  INSERT INTO public.business_document (
    id,
    company_id,
    document_kind,
    document_number,
    status,
    transaction_date,
    source_document_id,
    total_amount,
    paid_amount,
    data,
    version,
    posted_at,
    posted_by_user_id,
    created_by_user_id,
    updated_by_user_id,
    created_at,
    updated_at
  ) VALUES (
    v_act_id,
    v_spk.company_id,
    'sewing_output',
    v_act_number,
    'posted',
    current_date,
    p_spk_id,
    0,
    0,
    jsonb_build_object(
      'bundleId', p_bundle_id,
      'bundleCode', v_bundle.bundle_code,
      'workedQuantity', v_worked_qty,
      'successQuantity', p_success_qty,
      'repairQuantity', p_repair_qty,
      'rejectQuantity', p_reject_qty,
      'notes', coalesce(p_notes, '')
    ),
    1,
    now(),
    p_user_id::text,
    p_user_id::text,
    p_user_id::text,
    now(),
    now()
  );

  -- Baris Hasil Pengerjaan Tahap (production_bundle_stage_result)
  INSERT INTO public.production_bundle_stage_result (
    company_id,
    production_order_id,
    work_order_id,
    actual_document_id,
    bundle_id,
    stage,
    worked_quantity,
    success_quantity,
    repair_quantity,
    final_rejected_quantity,
    created_at
  ) VALUES (
    v_spk.company_id,
    v_spk.production_order_id,
    p_spk_id,
    v_act_id,
    p_bundle_id,
    'sewing',
    v_worked_qty,
    p_success_qty,
    p_repair_qty,
    p_reject_qty,
    now()
  );

  -- Jika ada reject final, catat mutasi persediaan waste
  IF p_reject_qty > 0 THEN
    INSERT INTO public.inventory_movement (
      company_id,
      item_id,
      inventory_state,
      movement_type,
      lot_code,
      quantity,
      unit_cost,
      total_cost,
      transaction_date,
      business_date,
      source_document_id,
      posted_at
    ) VALUES (
      v_spk.company_id,
      v_bundle.product_id,
      'waste',
      'production_reject',
      v_bundle.lot_code,
      p_reject_qty,
      0,
      0,
      current_date,
      current_date,
      v_act_id,
      now()
    );
  END IF;

  -- Jika ada pengerjaan berhasil, catat mutasi WIP ke sewn_wip
  IF p_success_qty > 0 THEN
    INSERT INTO public.inventory_movement (
      company_id,
      item_id,
      inventory_state,
      movement_type,
      lot_code,
      quantity,
      unit_cost,
      total_cost,
      transaction_date,
      business_date,
      source_document_id,
      posted_at
    ) VALUES (
      v_spk.company_id,
      v_bundle.product_id,
      'sewn_wip',
      'production_wip_transfer',
      v_bundle.lot_code,
      p_success_qty,
      0,
      0,
      current_date,
      current_date,
      v_act_id,
      now()
    );
  END IF;

  -- Jika ada kuantitas cacat/perbaikan, bentuk baris Kasus Perbaikan
  IF p_repair_qty > 0 THEN
    INSERT INTO public.production_repair_case (
      company_id,
      production_order_id,
      source_work_order_id,
      bundle_id,
      found_at_stage,
      repair_work_kind,
      quantity,
      issue_reason,
      business_status,
      created_at,
      updated_at
    ) VALUES (
      v_spk.company_id,
      v_spk.production_order_id,
      p_spk_id,
      p_bundle_id,
      'sewing',
      'sewing',
      p_repair_qty,
      coalesce(p_notes, 'Cacat hasil jahit operator'),
      'pending_assignment',
      now(),
      now()
    ) RETURNING id INTO v_repair_case_id;

    -- Bundle tertahan perbaikan (repair_hold)
    UPDATE public.production_bundle
    SET stage = 'sewing',
        work_condition = 'repair_hold',
        active_quantity = p_success_qty + p_repair_qty,
        final_rejected_quantity = v_bundle.final_rejected_quantity + p_reject_qty,
        last_actual_work_order_id = p_spk_id,
        updated_at = now()
    WHERE id = p_bundle_id;
  ELSE
    -- Jika tidak ada repair
    IF p_success_qty > 0 THEN
      -- Selesai jahit, siap masuk SPK Packing
      UPDATE public.production_bundle
      SET stage = 'sewing',
          work_condition = 'available',
          active_quantity = p_success_qty,
          final_rejected_quantity = v_bundle.final_rejected_quantity + p_reject_qty,
          last_actual_work_order_id = p_spk_id,
          updated_at = now()
      WHERE id = p_bundle_id;
    ELSE
      -- Seluruhnya reject
      UPDATE public.production_bundle
      SET stage = 'sewing',
          work_condition = 'completed',
          active_quantity = 0,
          final_rejected_quantity = v_bundle.final_rejected_quantity + p_reject_qty,
          last_actual_work_order_id = p_spk_id,
          updated_at = now()
      WHERE id = p_bundle_id;
    END IF;
  END IF;

  -- Lepaskan reservasi ikatan dari SPK Jahit
  DELETE FROM public.production_bundle_reservation
  WHERE bundle_id = p_bundle_id;

  -- Hitung Kewajiban Upah Jahit (Qty Dikerjakan penuh * tarif, default Rp 15.000 jika 0/null)
  SELECT * INTO v_rate
  FROM public.wage_rate
  WHERE company_id = v_spk.company_id AND product_id = v_bundle.product_id AND service_kind = 'sewing';

  IF v_rate.rate IS NULL OR v_rate.rate = 0 THEN
    v_wage_rate := 15000;
  ELSE
    v_wage_rate := v_rate.rate;
  END IF;

  v_wage_amount := round(v_worked_qty * v_wage_rate);

  INSERT INTO public.wage_liability (
    company_id,
    employee_id,
    service_kind,
    quantity,
    rate,
    gross_amount,
    paid_amount,
    item_id,
    source_document_id,
    posted_at
  ) VALUES (
    v_spk.company_id,
    v_profile.employee_id,
    'sewing',
    v_worked_qty,
    v_wage_rate,
    v_wage_amount,
    0,
    v_bundle.product_id,
    v_act_id,
    now()
  );

  -- Cek apakah seluruh bundle pada SPK Jahit ini telah memiliki hasil pengerjaan
  SELECT NOT EXISTS (
    SELECT 1 FROM public.production_work_order_bundle wob
    WHERE wob.work_order_id = p_spk_id
      AND NOT EXISTS (
        SELECT 1 FROM public.production_bundle_stage_result bsr
        WHERE bsr.work_order_id = p_spk_id AND bsr.bundle_id = wob.bundle_id
      )
  ) INTO v_all_completed;

  IF v_all_completed THEN
    UPDATE public.production_work_order
    SET business_status = 'completed',
        updated_at = now()
    WHERE document_id = p_spk_id;
  ELSE
    UPDATE public.production_work_order
    SET business_status = 'in_progress',
        updated_at = now()
    WHERE document_id = p_spk_id;
  END IF;

  -- Jejak Audit
  INSERT INTO public.audit_log (
    company_id,
    user_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    details,
    created_at
  ) VALUES (
    v_spk.company_id,
    p_user_id::text,
    p_user_id::text,
    'operator.sewing.confirm',
    'business_document',
    v_act_id::text,
    jsonb_build_object(
      'actualNumber', v_act_number,
      'bundleCode', v_bundle.bundle_code,
      'workedQuantity', v_worked_qty,
      'successQuantity', p_success_qty,
      'repairQuantity', p_repair_qty,
      'rejectQuantity', p_reject_qty,
      'wageAmount', v_wage_amount,
      'repairCaseId', v_repair_case_id
    ),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'actualId', v_act_id,
    'actualNumber', v_act_number,
    'bundleCode', v_bundle.bundle_code,
    'successQuantity', p_success_qty,
    'repairQuantity', p_repair_qty,
    'rejectQuantity', p_reject_qty,
    'wageAmount', v_wage_amount,
    'repairCaseId', v_repair_case_id,
    'spkCompleted', v_all_completed
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_asset_purchase(p_company_id uuid, p_supplier_id uuid, p_transaction_date date, p_notes text, p_lines jsonb, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  p_user_id := tenant_private.assert_mis_company_access(p_company_id, p_user_id);
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
$function$;

CREATE OR REPLACE FUNCTION public.create_company_with_bootstrap(p_code text, p_name text, p_address text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_email text DEFAULT NULL::text)
 RETURNS company
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid;
  v_cleaned_code text;
  v_cleaned_name text;
  v_new_company public.company;
BEGIN
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  PERFORM tenant_private.assert_mis_company_creation();
  v_user_id := (SELECT auth.uid());
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Akses ditolak: Pengguna belum terautentikasi.' USING ERRCODE = '42501';
  END IF;

  v_cleaned_code := upper(trim(p_code));
  v_cleaned_name := trim(p_name);

  -- Validasi kode perusahaan
  IF v_cleaned_code IS NULL OR v_cleaned_code = '' THEN
    RAISE EXCEPTION 'Kode perusahaan wajib diisi.' USING ERRCODE = '22023';
  END IF;

  IF NOT (v_cleaned_code ~ '^[A-Z0-9_-]+$') THEN
    RAISE EXCEPTION 'Kode perusahaan hanya boleh berupa huruf kapital, angka, garis bawah, atau tanda hubung tanpa spasi.' USING ERRCODE = '22023';
  END IF;

  IF length(v_cleaned_code) < 2 OR length(v_cleaned_code) > 20 THEN
    RAISE EXCEPTION 'Kode perusahaan harus terdiri dari 2 hingga 20 karakter.' USING ERRCODE = '22023';
  END IF;

  -- Validasi nama perusahaan
  IF v_cleaned_name IS NULL OR v_cleaned_name = '' THEN
    RAISE EXCEPTION 'Nama perusahaan wajib diisi.' USING ERRCODE = '22023';
  END IF;

  -- Cek keunikan kode & nama
  IF EXISTS (SELECT 1 FROM public.company WHERE code = v_cleaned_code) THEN
    RAISE EXCEPTION 'Kode perusahaan "%" sudah digunakan oleh entitas lain.', v_cleaned_code USING ERRCODE = '23505';
  END IF;

  IF EXISTS (SELECT 1 FROM public.company WHERE name = v_cleaned_name) THEN
    RAISE EXCEPTION 'Nama perusahaan "%" sudah digunakan oleh entitas lain.', v_cleaned_name USING ERRCODE = '23505';
  END IF;

  -- 1. Insert baris baru ke tabel public.company
  INSERT INTO public.company (
    code,
    name,
    address,
    phone,
    email,
    is_active,
    code_locked,
    version,
    created_at,
    updated_at
  )
  VALUES (
    v_cleaned_code,
    v_cleaned_name,
    NULLIF(trim(p_address), ''),
    NULLIF(trim(p_phone), ''),
    NULLIF(trim(p_email), ''),
    true,
    false,
    1,
    now(),
    now()
  )
  RETURNING * INTO v_new_company;

  -- 2. Jalankan stored procedure bootstrap_company_data
  -- Menginisialisasi UOM, kategori konfigurasi, COA 65 akun, matriks permission 7 peran, document sequence, serta assign creator sebagai owner
  PERFORM public.bootstrap_company_data(v_new_company.id, v_user_id);

  -- 3. Catat audit log
  INSERT INTO public.audit_log (
    company_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    result,
    details,
    after
  )
  VALUES (
    v_new_company.id,
    v_user_id,
    'company.create',
    'company',
    v_new_company.id::text,
    'success',
    jsonb_build_object(
      'code', v_new_company.code,
      'name', v_new_company.name,
      'address', v_new_company.address,
      'phone', v_new_company.phone,
      'email', v_new_company.email
    ),
    to_jsonb(v_new_company)
  );

  RETURN v_new_company;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_customer_po(p_company_id uuid, p_customer_id uuid, p_order_number text DEFAULT NULL::text, p_order_date date DEFAULT CURRENT_DATE, p_target_delivery_date date DEFAULT NULL::date, p_notes text DEFAULT NULL::text, p_lines jsonb DEFAULT '[]'::jsonb, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_customer RECORD;
  v_doc_id uuid := gen_random_uuid();
  v_order_number text;
  v_seq_key text;
  v_prefix text;
  v_seq_num bigint;
  v_total_amount bigint := 0;
  v_line jsonb;
  v_line_idx integer := 1;
  v_item_id uuid;
  v_product RECORD;
  v_qty numeric(18, 4);
  v_price bigint;
  v_subtotal bigint;
  v_line_id uuid;
  v_order_date date := coalesce(p_order_date, current_date);
BEGIN
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  p_user_id := tenant_private.assert_mis_company_access(p_company_id, p_user_id);
  -- 1. Validasi Pelanggan Aktif
  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'Pelanggan wajib dipilih.';
  END IF;

  SELECT * INTO v_customer
  FROM public.master_record
  WHERE id = p_customer_id
    AND company_id = p_company_id
    AND record_kind = 'customer'
    AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pelanggan tidak ditemukan atau tidak aktif pada perusahaan ini.';
  END IF;

  -- 2. Validasi Minimal 1 Baris
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Pesanan penjualan wajib memiliki minimal satu baris produk.';
  END IF;

  -- 3. Penomoran Dokumen PO: Manual atau Urut Otomatis PO-YYMMDD-###
  IF p_order_number IS NOT NULL AND btrim(p_order_number) <> '' THEN
    v_order_number := btrim(p_order_number);
    IF EXISTS (
      SELECT 1 FROM public.business_document
      WHERE company_id = p_company_id AND document_number = v_order_number
    ) THEN
      RAISE EXCEPTION 'Nomor pesanan % sudah digunakan.', v_order_number;
    END IF;
  ELSE
    v_prefix := 'PO-' || to_char(v_order_date, 'YYMMDD') || '-';
    v_seq_key := 'customer_po-' || to_char(v_order_date, 'YYMMDD');

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

    v_order_number := v_prefix || lpad(v_seq_num::text, 3, '0');
  END IF;

  -- 4. Buat Header Dokumen PO
  INSERT INTO public.business_document (
    id, company_id, document_kind, document_number, status,
    transaction_date, counterparty_id, total_amount, paid_amount,
    data, created_by_user_id, posted_at, posted_by_user_id, created_at, updated_at
  ) VALUES (
    v_doc_id, p_company_id, 'customer_po', v_order_number, 'posted',
    v_order_date, p_customer_id, 0, 0,
    jsonb_build_object(
      'poStatus', 'open',
      'deliveryStatus', 'unshipped',
      'targetDeliveryDate', p_target_delivery_date,
      'notes', coalesce(p_notes, '')
    ),
    p_user_id::text, now(), p_user_id::text, now(), now()
  );

  -- 5. Masukkan Baris Rincian Produk
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_item_id := (v_line->>'itemId')::uuid;
    IF v_item_id IS NULL THEN
      RAISE EXCEPTION 'Produk SKU wajib dipilih pada baris %.', v_line_idx;
    END IF;

    SELECT * INTO v_product
    FROM public.master_record
    WHERE id = v_item_id
      AND company_id = p_company_id
      AND record_kind = 'product'
      AND is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produk SKU baris % tidak ditemukan atau tidak aktif.', v_line_idx;
    END IF;

    v_qty := (v_line->>'quantity')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Kuantitas produk % pada baris % harus lebih besar dari nol.', v_product.name, v_line_idx;
    END IF;

    v_price := coalesce((v_line->>'unitPrice')::bigint, 0);
    IF v_price < 0 THEN
      RAISE EXCEPTION 'Harga satuan produk % tidak boleh negatif.', v_product.name;
    END IF;

    v_subtotal := round(v_qty * v_price);
    v_total_amount := v_total_amount + v_subtotal;
    v_line_id := gen_random_uuid();

    INSERT INTO public.business_document_line (
      id, company_id, document_id, line_number, item_id,
      description, unit_code, conversion_factor,
      quantity, unit_price, subtotal, total_amount,
      data, revision, is_current, created_at
    ) VALUES (
      v_line_id, p_company_id, v_doc_id, v_line_idx, v_item_id,
      coalesce(v_line->>'description', v_product.name),
      coalesce(v_line->>'unitCode', 'pcs'),
      1,
      v_qty, v_price, v_subtotal, v_subtotal,
      jsonb_build_object('notes', coalesce(v_line->>'notes', '')),
      1, true, now()
    );

    v_line_idx := v_line_idx + 1;
  END LOOP;

  -- 6. Update Total Amount Header
  UPDATE public.business_document
  SET total_amount = v_total_amount,
      updated_at = now()
  WHERE id = v_doc_id;

  -- 7. Audit Log
  INSERT INTO public.audit_log (
    company_id, user_id, actor_user_id, action,
    target_type, target_id, details, created_at
  ) VALUES (
    p_company_id, p_user_id::text, p_user_id::text, 'sales.po.create',
    'business_document', v_doc_id::text,
    jsonb_build_object(
      'orderNumber', v_order_number,
      'customerId', p_customer_id,
      'customerName', v_customer.name,
      'totalAmount', v_total_amount,
      'lineCount', v_line_idx - 1
    ),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'id', v_doc_id,
    'documentNumber', v_order_number,
    'totalAmount', v_total_amount
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_prepaid_expense(p_company_id uuid, p_description text, p_prepaid_account_id uuid, p_expense_account_id uuid, p_start_date date, p_number_of_months integer, p_original_amount bigint, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_prepaid_acc RECORD;
  v_expense_acc RECORD;
  v_end_date date;
  v_record RECORD;
BEGIN
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  p_user_id := tenant_private.assert_mis_company_access(p_company_id, p_user_id);
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
$function$;

CREATE OR REPLACE FUNCTION public.create_production_order(p_company_id uuid, p_target_date date, p_notes text, p_lines jsonb, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_pp_id uuid;
  v_seq_key text;
  v_prefix text;
  v_seq_number bigint;
  v_doc_number text;
  v_line jsonb;
  v_prod RECORD;
  v_product_id uuid;
  v_quantity numeric;
  v_req_printing boolean;
  v_line_idx integer := 0;
  v_total_qty numeric := 0;
BEGIN
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  p_user_id := tenant_private.assert_mis_company_access(p_company_id, p_user_id);
  -- Validasi perusahaan
  IF NOT EXISTS (SELECT 1 FROM public.company WHERE id = p_company_id) THEN
    RAISE EXCEPTION 'Perusahaan tidak valid.';
  END IF;

  IF p_target_date IS NULL THEN
    RAISE EXCEPTION 'Tanggal target pengerjaan wajib diisi.';
  END IF;

  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Perintah Produksi wajib memiliki minimal 1 baris target SKU.';
  END IF;

  -- Validasi setiap baris SKU & Snapshot Routing Sablon
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_line_idx := v_line_idx + 1;
    v_product_id := coalesce((v_line->>'productId')::uuid, (v_line->>'itemId')::uuid);
    v_quantity := (v_line->>'quantity')::numeric;

    IF v_product_id IS NULL THEN
      RAISE EXCEPTION 'Baris target ke-% tidak memiliki produk/SKU yang valid.', v_line_idx;
    END IF;

    SELECT * INTO v_prod
    FROM public.master_record
    WHERE id = v_product_id AND company_id = p_company_id AND record_kind = 'product' AND is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produk/SKU dengan ID % tidak ditemukan atau tidak aktif.', v_product_id;
    END IF;

    IF v_quantity IS NULL OR v_quantity <= 0 OR v_quantity <> trunc(v_quantity) THEN
      RAISE EXCEPTION 'Target kuantitas per SKU harus berupa bilangan bulat positif (PCS). Produk: %', v_prod.name;
    END IF;

    -- Snapshot Jalur Routing Sablon secara atomik (Fail-closed)
    SELECT requires_printing INTO v_req_printing
    FROM public.production_product_routing
    WHERE company_id = p_company_id AND product_id = v_product_id;

    IF NOT FOUND OR v_req_printing IS NULL THEN
      RAISE EXCEPTION 'SKU % (%) belum memiliki konfigurasi routing sablon.', v_prod.name, coalesce(v_prod.sku, v_prod.code, 'N/A');
    END IF;

    v_total_qty := v_total_qty + v_quantity;
  END LOOP;

  -- Penomoran Dokumen Urut: PP-YYMMDD-###
  v_prefix := 'PP-' || to_char(p_target_date, 'YYMMDD') || '-';
  v_seq_key := 'PP-' || to_char(p_target_date, 'YYMMDD');

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
  RETURNING current_number INTO v_seq_number;

  v_doc_number := v_prefix || lpad(v_seq_number::text, 3, '0');
  v_pp_id := gen_random_uuid();

  -- Header Perintah Produksi (business_document)
  INSERT INTO public.business_document (
    id,
    company_id,
    document_kind,
    document_number,
    status,
    transaction_date,
    total_amount,
    paid_amount,
    data,
    version,
    created_by_user_id,
    updated_by_user_id,
    created_at,
    updated_at
  ) VALUES (
    v_pp_id,
    p_company_id,
    'production_order',
    v_doc_number,
    'draft',
    p_target_date,
    0,
    0,
    jsonb_build_object(
      'notes', coalesce(p_notes, ''),
      'target_date', p_target_date,
      'code_locked', false,
      'total_target_pcs', v_total_qty
    ),
    1,
    p_user_id::text,
    p_user_id::text,
    now(),
    now()
  );

  -- Baris Target Perintah Produksi (business_document_line)
  v_line_idx := 0;
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_line_idx := v_line_idx + 1;
    v_product_id := coalesce((v_line->>'productId')::uuid, (v_line->>'itemId')::uuid);
    v_quantity := (v_line->>'quantity')::numeric;

    SELECT * INTO v_prod
    FROM public.master_record
    WHERE id = v_product_id AND company_id = p_company_id;

    SELECT requires_printing INTO v_req_printing
    FROM public.production_product_routing
    WHERE company_id = p_company_id AND product_id = v_product_id;

    INSERT INTO public.business_document_line (
      company_id,
      document_id,
      line_number,
      item_id,
      description,
      unit_code,
      conversion_factor,
      quantity,
      unit_price,
      subtotal,
      total_amount,
      data,
      revision,
      is_current,
      version
    ) VALUES (
      p_company_id,
      v_pp_id,
      v_line_idx,
      v_product_id,
      'Target SKU ' || v_prod.name,
      'PCS',
      1,
      v_quantity,
      0,
      0,
      0,
      jsonb_build_object(
        'requiresPrinting', v_req_printing,
        'requires_printing', v_req_printing,
        'sku', v_prod.sku,
        'productName', v_prod.name
      ),
      1,
      true,
      1
    );
  END LOOP;

  -- Jejak Audit
  INSERT INTO public.audit_log (
    company_id,
    user_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    details,
    created_at
  ) VALUES (
    p_company_id,
    p_user_id::text,
    p_user_id::text,
    'production.order.create',
    'business_document',
    v_pp_id::text,
    jsonb_build_object(
      'documentNumber', v_doc_number,
      'targetDate', p_target_date,
      'lineCount', v_line_idx,
      'totalTargetPcs', v_total_qty
    ),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'id', v_pp_id,
    'documentNumber', v_doc_number,
    'status', 'draft',
    'totalTargetPcs', v_total_qty
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_sales_invoice(p_company_id uuid, p_customer_id uuid, p_po_id uuid DEFAULT NULL::uuid, p_invoice_date date DEFAULT CURRENT_DATE, p_funding_method text DEFAULT 'receivable'::text, p_cash_account_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text, p_lines jsonb DEFAULT '[]'::jsonb, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_customer RECORD;
  v_po RECORD;
  v_cash_account RECORD;
  v_doc_id uuid := gen_random_uuid();
  v_funding_method text := coalesce(p_funding_method, 'receivable');
  v_total_amount bigint := 0;
  v_line jsonb;
  v_line_idx integer := 1;
  v_item_id uuid;
  v_product RECORD;
  v_qty numeric(18, 4);
  v_price bigint;
  v_subtotal bigint;
  v_line_id uuid;
  v_po_line_qty numeric(18, 4);
  v_posted_line_qty numeric(18, 4);
  v_remaining_line_qty numeric(18, 4);
  v_invoice_date date := coalesce(p_invoice_date, current_date);
BEGIN
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  p_user_id := tenant_private.assert_mis_company_access(p_company_id, p_user_id);
  -- 1. Validasi Pelanggan Aktif
  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'Pelanggan wajib dipilih.';
  END IF;

  SELECT * INTO v_customer
  FROM public.master_record
  WHERE id = p_customer_id
    AND company_id = p_company_id
    AND record_kind = 'customer'
    AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pelanggan tidak ditemukan atau tidak aktif pada perusahaan ini.';
  END IF;

  -- 2. Validasi Metode Pendanaan (Receivable / Cash)
  IF v_funding_method NOT IN ('receivable', 'cash') THEN
    RAISE EXCEPTION 'Metode pendanaan % tidak valid. Pilihan: receivable, cash.', v_funding_method;
  END IF;

  IF v_funding_method = 'cash' THEN
    IF p_cash_account_id IS NULL THEN
      RAISE EXCEPTION 'Akun Kas/Bank wajib dipilih untuk penjualan dengan metode tunai.';
    END IF;

    SELECT * INTO v_cash_account
    FROM public.master_record
    WHERE id = p_cash_account_id
      AND company_id = p_company_id
      AND record_kind = 'cash_account'
      AND is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Akun Kas/Bank tidak ditemukan atau tidak aktif.';
    END IF;
  END IF;

  -- 3. Validasi PO Sumber (Jika ada)
  IF p_po_id IS NOT NULL THEN
    SELECT * INTO v_po
    FROM public.business_document
    WHERE id = p_po_id
      AND company_id = p_company_id
      AND document_kind = 'customer_po';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Pesanan Pelanggan (PO) acuan tidak ditemukan.';
    END IF;

    IF v_po.counterparty_id <> p_customer_id THEN
      RAISE EXCEPTION 'Pelanggan faktur berbeda dengan pelanggan pada PO acuan.';
    END IF;
  END IF;

  -- 4. Validasi Baris Faktur Minimal 1
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Faktur penjualan wajib memiliki minimal satu baris produk.';
  END IF;

  -- 5. Buat Header Dokumen Draft
  INSERT INTO public.business_document (
    id, company_id, document_kind, document_number, status,
    transaction_date, counterparty_id, source_document_id, total_amount, paid_amount,
    data, created_by_user_id, created_at, updated_at
  ) VALUES (
    v_doc_id, p_company_id, 'sales_invoice', NULL, 'draft',
    v_invoice_date, p_customer_id, p_po_id, 0, 0,
    jsonb_build_object(
      'fundingMethod', v_funding_method,
      'cashAccountId', p_cash_account_id,
      'notes', coalesce(p_notes, '')
    ),
    p_user_id::text, now(), now()
  );

  -- 6. Masukkan Baris Detail & Validasi Sisa Kuantitas PO
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_item_id := (v_line->>'itemId')::uuid;
    IF v_item_id IS NULL THEN
      RAISE EXCEPTION 'Produk SKU wajib dipilih pada baris %.', v_line_idx;
    END IF;

    SELECT * INTO v_product
    FROM public.master_record
    WHERE id = v_item_id
      AND company_id = p_company_id
      AND record_kind = 'product'
      AND is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produk SKU baris % tidak ditemukan atau tidak aktif.', v_line_idx;
    END IF;

    v_qty := (v_line->>'quantity')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Kuantitas produk % pada baris % harus lebih besar dari nol.', v_product.name, v_line_idx;
    END IF;

    -- Validasi sisa kuantitas PO jika ada PO acuan
    IF p_po_id IS NOT NULL THEN
      SELECT coalesce(sum(quantity), 0) INTO v_po_line_qty
      FROM public.business_document_line
      WHERE document_id = p_po_id
        AND item_id = v_item_id
        AND is_current = true;

      IF v_po_line_qty = 0 THEN
        RAISE EXCEPTION 'Produk % tidak terdaftar pada Pesanan Pelanggan (PO) acuan.', v_product.name;
      END IF;

      -- Kuantitas yang sudah terkirim/difakturkan (posted) dari invoice sebelumnya
      SELECT coalesce(sum(bdl.quantity), 0) INTO v_posted_line_qty
      FROM public.business_document_line bdl
      JOIN public.business_document bd ON bdl.document_id = bd.id
      WHERE bd.source_document_id = p_po_id
        AND bd.status = 'posted'
        AND bdl.item_id = v_item_id
        AND bdl.is_current = true;

      v_remaining_line_qty := v_po_line_qty - v_posted_line_qty;

      IF v_qty > v_remaining_line_qty THEN
        RAISE EXCEPTION 'Kuantitas kirim produk % (%) melebihi sisa pesanan PO (%).',
          v_product.sku, v_qty, v_remaining_line_qty;
      END IF;
    END IF;

    v_price := coalesce((v_line->>'unitPrice')::bigint, 0);
    IF v_price < 0 THEN
      RAISE EXCEPTION 'Harga satuan produk % tidak boleh negatif.', v_product.name;
    END IF;

    v_subtotal := round(v_qty * v_price);
    v_total_amount := v_total_amount + v_subtotal;
    v_line_id := gen_random_uuid();

    INSERT INTO public.business_document_line (
      id, company_id, document_id, line_number, item_id,
      description, unit_code, conversion_factor,
      quantity, unit_price, subtotal, total_amount,
      data, revision, is_current, created_at
    ) VALUES (
      v_line_id, p_company_id, v_doc_id, v_line_idx, v_item_id,
      coalesce(v_line->>'description', v_product.name),
      coalesce(v_line->>'unitCode', 'pcs'),
      1,
      v_qty, v_price, v_subtotal, v_subtotal,
      jsonb_build_object(
        'notes', coalesce(v_line->>'notes', ''),
        'fallbackUnitCost', coalesce((v_line->>'fallbackUnitCost')::bigint, 0)
      ),
      1, true, now()
    );

    v_line_idx := v_line_idx + 1;
  END LOOP;

  -- 7. Update Total Amount Header
  UPDATE public.business_document
  SET total_amount = v_total_amount,
      updated_at = now()
  WHERE id = v_doc_id;

  -- 8. Audit Log
  INSERT INTO public.audit_log (
    company_id, user_id, actor_user_id, action,
    target_type, target_id, details, created_at
  ) VALUES (
    p_company_id, p_user_id::text, p_user_id::text, 'sales.invoice.create',
    'business_document', v_doc_id::text,
    jsonb_build_object(
      'customerId', p_customer_id,
      'poId', p_po_id,
      'totalAmount', v_total_amount,
      'fundingMethod', v_funding_method
    ),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'id', v_doc_id,
    'totalAmount', v_total_amount
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_spk(p_pp_id uuid, p_stage text, p_operator_id uuid, p_target_pcs integer, p_notes text, p_bundle_ids jsonb, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_pp RECORD;
  v_profile RECORD;
  v_expected_role text;
  v_spk_id uuid;
  v_prefix text;
  v_stage_code text;
  v_seq_key text;
  v_seq_number bigint;
  v_spk_number text;
  v_bundle_id uuid;
  v_bundle RECORD;
  v_line RECORD;
  v_line_idx integer := 0;
  v_bundle_count integer := 0;
  v_final_target_pcs integer := 0;
  v_routing RECORD;
BEGIN
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  p_user_id := tenant_private.assert_mis_company_access((SELECT d.company_id FROM public.business_document d WHERE d.id=p_pp_id AND d.document_kind='production_order'), p_user_id);
  -- Validasi Tahapan
  IF p_stage NOT IN ('cutting', 'printing', 'sewing', 'packing') THEN
    RAISE EXCEPTION 'Tahapan SPK % tidak didukung. Pilihan: cutting, printing, sewing, packing.', p_stage;
  END IF;

  -- Ambil Dokumen PP Induk dan kunci baris
  SELECT * INTO v_pp
  FROM public.business_document
  WHERE id = p_pp_id AND document_kind = 'production_order'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dokumen Perintah Produksi dengan ID % tidak ditemukan.', p_pp_id;
  END IF;

  -- Mapping Role Operator
  IF p_stage = 'cutting' THEN
    v_expected_role := 'operator_potong';
    v_stage_code := 'POT';
  ELSIF p_stage = 'printing' THEN
    v_expected_role := 'operator_sablon';
    v_stage_code := 'SAB';
  ELSIF p_stage = 'sewing' THEN
    v_expected_role := 'operator_jahit';
    v_stage_code := 'JAH';
  ELSE
    v_expected_role := 'operator_packing';
    v_stage_code := 'PAK';
  END IF;

  -- Validasi Operator Profile
  -- Coba cari berdasarkan profile id
  SELECT * INTO v_profile
  FROM public.production_operator_profile
  WHERE id = p_operator_id AND company_id = v_pp.company_id;

  -- Jika tidak ketemu, coba cari berdasarkan employee_id
  IF NOT FOUND THEN
    SELECT * INTO v_profile
    FROM public.production_operator_profile
    WHERE employee_id = p_operator_id AND company_id = v_pp.company_id AND operator_role = v_expected_role;
  END IF;

  -- Jika tidak ketemu, coba cari berdasarkan user_id
  IF NOT FOUND THEN
    SELECT * INTO v_profile
    FROM public.production_operator_profile
    WHERE user_id = p_operator_id AND company_id = v_pp.company_id AND operator_role = v_expected_role;
  END IF;

  -- Jika masih tidak ketemu, coba sinkronkan profil terlebih dahulu
  IF NOT FOUND THEN
    PERFORM public.sync_production_operator_profiles(v_pp.company_id);
    
    SELECT * INTO v_profile
    FROM public.production_operator_profile
    WHERE (id = p_operator_id OR employee_id = p_operator_id OR user_id = p_operator_id)
      AND company_id = v_pp.company_id AND operator_role = v_expected_role;
  END IF;

  IF v_profile.id IS NULL THEN
    RAISE EXCEPTION 'Operator tidak ditemukan atau tidak memiliki peran % yang sesuai dengan tahapan %.', v_expected_role, p_stage;
  END IF;

  IF NOT v_profile.is_active THEN
    RAISE EXCEPTION 'Profil operator tidak aktif.';
  END IF;

  -- Invariant Kunci Perintah Produksi (PP):
  -- Saat SPK Potong pertama kali dibuat/ditetapkan, dokumen PP induk secara permanen dikunci
  IF p_stage = 'cutting' THEN
    UPDATE public.business_document
    SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{code_locked}', 'true'::jsonb),
        updated_at = now()
    WHERE id = p_pp_id;
  END IF;

  -- Penomoran Urut SPK: SPK-POT-YYMMDD-###, dll.
  v_prefix := 'SPK-' || v_stage_code || '-' || to_char(current_date, 'YYMMDD') || '-';
  v_seq_key := 'SPK-' || p_stage || '-' || to_char(current_date, 'YYMMDD');

  INSERT INTO public.document_sequence (
    company_id, sequence_key, prefix, padding, current_number, current_value, updated_at
  ) VALUES (
    v_pp.company_id, v_seq_key, v_prefix, 3, 1, 1, now()
  )
  ON CONFLICT (company_id, sequence_key)
  DO UPDATE SET
    current_number = public.document_sequence.current_number + 1,
    current_value = public.document_sequence.current_value + 1,
    updated_at = now()
  RETURNING current_number INTO v_seq_number;

  v_spk_number := v_prefix || lpad(v_seq_number::text, 3, '0');
  v_spk_id := gen_random_uuid();

  -- Hitung Target PCS
  IF p_stage = 'cutting' THEN
    IF p_target_pcs IS NOT NULL AND p_target_pcs > 0 THEN
      v_final_target_pcs := p_target_pcs;
    ELSE
      SELECT coalesce(sum(quantity), 0)::integer INTO v_final_target_pcs
      FROM public.business_document_line
      WHERE document_id = p_pp_id AND is_current = true;
    END IF;
  ELSE
    -- Untuk Sablon, Jahit, Packing: dihitung dari ikatan yang dipilih
    IF p_bundle_ids IS NULL OR jsonb_array_length(p_bundle_ids) = 0 THEN
      RAISE EXCEPTION 'SPK tahapan % wajib memilih minimal 1 ikatan komponen (bundle).', p_stage;
    END IF;

    FOR v_bundle_id IN SELECT (jsonb_array_elements_text(p_bundle_ids))::uuid LOOP
      SELECT * INTO v_bundle
      FROM public.production_bundle
      WHERE id = v_bundle_id AND company_id = v_pp.company_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Ikatan komponen dengan ID % tidak ditemukan.', v_bundle_id;
      END IF;

      IF v_bundle.production_order_id <> p_pp_id THEN
        RAISE EXCEPTION 'Ikatan % bukan milik Perintah Produksi ini.', v_bundle.bundle_code;
      END IF;

      IF v_bundle.work_condition <> 'available' THEN
        RAISE EXCEPTION 'Ikatan % sedang tidak tersedia (kondisi: %).', v_bundle.bundle_code, v_bundle.work_condition;
      END IF;

      -- Validasi eligibility tahapan ikatan
      IF p_stage = 'printing' THEN
        IF v_bundle.stage <> 'cutting' THEN
          RAISE EXCEPTION 'Ikatan % belum menyelesaikan pemotongan kain.', v_bundle.bundle_code;
        END IF;

        -- Periksa snapshot routing PP
        SELECT data->>'requiresPrinting' as req_print INTO v_routing
        FROM public.business_document_line
        WHERE document_id = p_pp_id AND item_id = v_bundle.product_id AND is_current = true
        LIMIT 1;

        IF v_routing.req_print IS DISTINCT FROM 'true' THEN
          RAISE EXCEPTION 'Ikatan % tidak memerlukan proses sablon berdasarkan konfigurasi PP.', v_bundle.bundle_code;
        END IF;

      ELSIF p_stage = 'sewing' THEN
        -- Jahit menerima ikatan dari printing (jika perlu sablon) atau dari cutting (jika tanpa sablon)
        SELECT data->>'requiresPrinting' as req_print INTO v_routing
        FROM public.business_document_line
        WHERE document_id = p_pp_id AND item_id = v_bundle.product_id AND is_current = true
        LIMIT 1;

        IF v_routing.req_print = 'true' AND v_bundle.stage <> 'printing' THEN
          RAISE EXCEPTION 'Ikatan % memerlukan pengerjaan sablon sebelum jahit.', v_bundle.bundle_code;
        END IF;
      ELSIF p_stage = 'packing' THEN
        IF v_bundle.stage <> 'sewing' THEN
          RAISE EXCEPTION 'Ikatan % belum menyelesaikan tahapan jahit.', v_bundle.bundle_code;
        END IF;
      END IF;

      v_final_target_pcs := v_final_target_pcs + v_bundle.active_quantity::integer;
      v_bundle_count := v_bundle_count + 1;
    END LOOP;
  END IF;

  -- Header Dokumen SPK (business_document)
  INSERT INTO public.business_document (
    id,
    company_id,
    document_kind,
    document_number,
    status,
    transaction_date,
    source_document_id,
    total_amount,
    paid_amount,
    data,
    version,
    posted_at,
    posted_by_user_id,
    created_by_user_id,
    updated_by_user_id,
    created_at,
    updated_at
  ) VALUES (
    v_spk_id,
    v_pp.company_id,
    'spk_' || p_stage,
    v_spk_number,
    'posted',
    current_date,
    p_pp_id,
    0,
    0,
    jsonb_build_object(
      'stage', p_stage,
      'target_pcs', v_final_target_pcs,
      'notes', coalesce(p_notes, ''),
      'operator_profile_id', v_profile.id,
      'employee_id', v_profile.employee_id
    ),
    1,
    now(),
    p_user_id::text,
    p_user_id::text,
    p_user_id::text,
    now(),
    now()
  );

  -- Relasi production_work_order
  INSERT INTO public.production_work_order (
    document_id,
    company_id,
    production_order_id,
    stage,
    operator_profile_id,
    business_status,
    assigned_at,
    assigned_by_user_id,
    created_at,
    updated_at
  ) VALUES (
    v_spk_id,
    v_pp.company_id,
    p_pp_id,
    p_stage,
    v_profile.id,
    'assigned',
    now(),
    p_user_id::text,
    now(),
    now()
  );

  -- Penugasan Ikatan Komponen / Baris Dokumen
  IF p_stage = 'cutting' THEN
    -- Salin baris target PP ke baris SPK Potong
    FOR v_line IN
      SELECT * FROM public.business_document_line
      WHERE document_id = p_pp_id AND is_current = true
      ORDER BY line_number ASC
    LOOP
      v_line_idx := v_line_idx + 1;
      INSERT INTO public.business_document_line (
        company_id,
        document_id,
        line_number,
        item_id,
        description,
        unit_code,
        conversion_factor,
        quantity,
        unit_price,
        subtotal,
        total_amount,
        data,
        revision,
        is_current,
        version
      ) VALUES (
        v_pp.company_id,
        v_spk_id,
        v_line_idx,
        v_line.item_id,
        v_line.description,
        'PCS',
        1,
        v_line.quantity,
        0,
        0,
        0,
        v_line.data,
        1,
        true,
        1
      );
    END LOOP;
  ELSE
    -- Kunci Reservasi Ikatan & Hubungkan ke SPK
    FOR v_bundle_id IN SELECT (jsonb_array_elements_text(p_bundle_ids))::uuid LOOP
      SELECT * INTO v_bundle FROM public.production_bundle WHERE id = v_bundle_id;

      INSERT INTO public.production_bundle_reservation (
        bundle_id,
        company_id,
        work_order_id,
        reserved_at
      ) VALUES (
        v_bundle_id,
        v_pp.company_id,
        v_spk_id,
        now()
      );

      INSERT INTO public.production_work_order_bundle (
        work_order_id,
        bundle_id,
        company_id
      ) VALUES (
        v_spk_id,
        v_bundle_id,
        v_pp.company_id
      );

      -- Baris detail dokumen SPK
      v_line_idx := v_line_idx + 1;
      INSERT INTO public.business_document_line (
        company_id,
        document_id,
        line_number,
        item_id,
        description,
        unit_code,
        conversion_factor,
        quantity,
        unit_price,
        subtotal,
        total_amount,
        data,
        revision,
        is_current,
        version
      ) VALUES (
        v_pp.company_id,
        v_spk_id,
        v_line_idx,
        v_bundle.product_id,
        'Ikatan ' || v_bundle.bundle_code,
        'PCS',
        1,
        v_bundle.active_quantity,
        0,
        0,
        0,
        jsonb_build_object('bundleId', v_bundle.id, 'bundleCode', v_bundle.bundle_code),
        1,
        true,
        1
      );

      -- Binding Operator Sablon per PP & Produk
      IF p_stage = 'printing' THEN
        INSERT INTO public.production_printing_operator (
          company_id,
          production_order_id,
          product_id,
          operator_profile_id
        ) VALUES (
          v_pp.company_id,
          p_pp_id,
          v_bundle.product_id,
          v_profile.id
        )
        ON CONFLICT (company_id, production_order_id, product_id)
        DO UPDATE SET operator_profile_id = v_profile.id;
      END IF;
    END LOOP;
  END IF;

  -- Jejak Audit
  INSERT INTO public.audit_log (
    company_id,
    user_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    details,
    created_at
  ) VALUES (
    v_pp.company_id,
    p_user_id::text,
    p_user_id::text,
    'production.spk.create',
    'business_document',
    v_spk_id::text,
    jsonb_build_object(
      'documentNumber', v_spk_number,
      'stage', p_stage,
      'productionOrderNumber', v_pp.document_number,
      'operatorProfileId', v_profile.id,
      'targetPcs', v_final_target_pcs,
      'bundleCount', v_bundle_count
    ),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'id', v_spk_id,
    'documentNumber', v_spk_number,
    'stage', p_stage,
    'targetPcs', v_final_target_pcs,
    'status', 'assigned'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_accounting_reconciliation_summary(p_company_id uuid, p_as_of_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_as_of_date date;
  v_company_exists boolean;
  -- Pos 1: Kas & Bank
  v_cash_subledger numeric := 0;
  v_cash_gl numeric := 0;
  -- Pos 2: Piutang Usaha
  v_ar_subledger numeric := 0;
  v_ar_gl numeric := 0;
  -- Pos 3: Hutang Usaha
  v_ap_subledger numeric := 0;
  v_ap_gl numeric := 0;
  -- Pos 4: Persediaan
  v_inv_subledger numeric := 0;
  v_inv_gl numeric := 0;
  -- Pos 5: Aset Tetap
  v_fa_subledger numeric := 0;
  v_fa_gl numeric := 0;
  -- Pos 6: Akumulasi Penyusutan
  v_dep_subledger numeric := 0;
  v_dep_gl numeric := 0;
  -- Summary
  v_matched_count integer := 0;
  v_items jsonb;
BEGIN
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  PERFORM tenant_private.assert_mis_company_access(p_company_id, NULL);
  -- Validasi Perusahaan
  SELECT EXISTS (SELECT 1 FROM public.company WHERE id = p_company_id) INTO v_company_exists;
  IF NOT v_company_exists THEN
    RAISE EXCEPTION 'Perusahaan dengan ID % tidak ditemukan.', p_company_id;
  END IF;

  v_as_of_date := coalesce(p_as_of_date, (now() AT TIME ZONE 'Asia/Jakarta')::date);

  -- 1. Pos Kas & Bank
  SELECT coalesce(sum(
    CASE 
      WHEN movement_type IN ('expense', 'transfer_out') THEN -amount
      ELSE amount
    END
  ), 0)
  INTO v_cash_subledger
  FROM public.cash_movement
  WHERE company_id = p_company_id
    AND transaction_date <= v_as_of_date;

  SELECT coalesce(sum(jl.debit - jl.credit), 0)
  INTO v_cash_gl
  FROM public.journal_line jl
  JOIN public.journal_entry je ON je.id = jl.journal_entry_id AND je.company_id = jl.company_id
  JOIN public.ledger_account la ON la.id = jl.account_id AND la.company_id = jl.company_id
  WHERE je.company_id = p_company_id
    AND je.status = 'posted'
    AND je.transaction_date <= v_as_of_date
    AND la.level3 = 'KAS DAN BANK';

  -- 2. Pos Piutang Usaha
  SELECT coalesce(sum(remaining_balance), 0)
  INTO v_ar_subledger
  FROM public.subledger_entry
  WHERE company_id = p_company_id
    AND subledger_kind = 'receivable'
    AND status = 'open'
    AND transaction_date <= v_as_of_date;

  SELECT coalesce(sum(jl.debit - jl.credit), 0)
  INTO v_ar_gl
  FROM public.journal_line jl
  JOIN public.journal_entry je ON je.id = jl.journal_entry_id AND je.company_id = jl.company_id
  JOIN public.ledger_account la ON la.id = jl.account_id AND la.company_id = jl.company_id
  WHERE je.company_id = p_company_id
    AND je.status = 'posted'
    AND je.transaction_date <= v_as_of_date
    AND (la.code = '1-1.2.01' OR la.id IN (
      SELECT account_id FROM public.accounting_mapping WHERE company_id = p_company_id AND mapping_key = 'receivable'
    ));

  -- 3. Pos Hutang Usaha (Normal Kredit)
  SELECT coalesce(sum(remaining_balance), 0)
  INTO v_ap_subledger
  FROM public.subledger_entry
  WHERE company_id = p_company_id
    AND subledger_kind = 'supplier_payable'
    AND status = 'open'
    AND transaction_date <= v_as_of_date;

  SELECT coalesce(sum(jl.credit - jl.debit), 0)
  INTO v_ap_gl
  FROM public.journal_line jl
  JOIN public.journal_entry je ON je.id = jl.journal_entry_id AND je.company_id = jl.company_id
  JOIN public.ledger_account la ON la.id = jl.account_id AND la.company_id = jl.company_id
  WHERE je.company_id = p_company_id
    AND je.status = 'posted'
    AND je.transaction_date <= v_as_of_date
    AND (la.code = '2-1.1.01' OR la.id IN (
      SELECT account_id FROM public.accounting_mapping WHERE company_id = p_company_id AND mapping_key = 'supplier_payable'
    ));

  -- 4. Pos Persediaan
  SELECT coalesce(sum(total_cost), 0)
  INTO v_inv_subledger
  FROM public.inventory_movement
  WHERE company_id = p_company_id
    AND business_date <= v_as_of_date;

  SELECT coalesce(sum(jl.debit - jl.credit), 0)
  INTO v_inv_gl
  FROM public.journal_line jl
  JOIN public.journal_entry je ON je.id = jl.journal_entry_id AND je.company_id = jl.company_id
  JOIN public.ledger_account la ON la.id = jl.account_id AND la.company_id = jl.company_id
  WHERE je.company_id = p_company_id
    AND je.status = 'posted'
    AND je.transaction_date <= v_as_of_date
    AND (la.level3 = 'PERSEDIAAN' OR la.code LIKE '1-1.4.%');

  -- 5. Pos Aset Tetap (Biaya Perolehan Register Aset Aktif)
  SELECT coalesce(sum(acquisition_cost), 0)
  INTO v_fa_subledger
  FROM public.asset_record
  WHERE company_id = p_company_id
    AND status = 'active'
    AND (
      capitalization_date <= v_as_of_date OR
      (capitalization_date IS NULL AND (created_at AT TIME ZONE 'Asia/Jakarta')::date <= v_as_of_date)
    );

  SELECT coalesce(sum(jl.debit - jl.credit), 0)
  INTO v_fa_gl
  FROM public.journal_line jl
  JOIN public.journal_entry je ON je.id = jl.journal_entry_id AND je.company_id = jl.company_id
  JOIN public.ledger_account la ON la.id = jl.account_id AND la.company_id = jl.company_id
  WHERE je.company_id = p_company_id
    AND je.status = 'posted'
    AND je.transaction_date <= v_as_of_date
    AND la.level2 = 'AKTIVA TETAP'
    AND la.level3 IN ('AKTIVA TETAP', 'AKTIVA TIDAK BERWUJUD');

  -- 6. Pos Akumulasi Penyusutan (Normal Kredit)
  SELECT coalesce(sum(amount), 0)
  INTO v_dep_subledger
  FROM public.depreciation_entry
  WHERE company_id = p_company_id
    AND period_month <= to_char(v_as_of_date, 'YYYY-MM');

  SELECT coalesce(sum(jl.credit - jl.debit), 0)
  INTO v_dep_gl
  FROM public.journal_line jl
  JOIN public.journal_entry je ON je.id = jl.journal_entry_id AND je.company_id = jl.company_id
  JOIN public.ledger_account la ON la.id = jl.account_id AND la.company_id = jl.company_id
  WHERE je.company_id = p_company_id
    AND je.status = 'posted'
    AND to_char(je.transaction_date, 'YYYY-MM') <= to_char(v_as_of_date, 'YYYY-MM')
    AND la.level3 = 'PENYUSUTAN AKTIVA TETAP';

  -- Hitung Jumlah Pos yang Sinkron
  IF (v_cash_subledger - v_cash_gl) = 0 THEN v_matched_count := v_matched_count + 1; END IF;
  IF (v_ar_subledger - v_ar_gl) = 0 THEN v_matched_count := v_matched_count + 1; END IF;
  IF (v_ap_subledger - v_ap_gl) = 0 THEN v_matched_count := v_matched_count + 1; END IF;
  IF (v_inv_subledger - v_inv_gl) = 0 THEN v_matched_count := v_matched_count + 1; END IF;
  IF (v_fa_subledger - v_fa_gl) = 0 THEN v_matched_count := v_matched_count + 1; END IF;
  IF (v_dep_subledger - v_dep_gl) = 0 THEN v_matched_count := v_matched_count + 1; END IF;

  v_items := jsonb_build_array(
    jsonb_build_object(
      'key', 'cash_bank',
      'title', 'Kas & Bank',
      'category', 'Kas & Setara Kas',
      'subledgerAmount', v_cash_subledger,
      'glAmount', v_cash_gl,
      'variance', v_cash_subledger - v_cash_gl,
      'isMatched', (v_cash_subledger - v_cash_gl = 0),
      'controlAccountCode', '1-1.1.xx'
    ),
    jsonb_build_object(
      'key', 'receivable',
      'title', 'Piutang Usaha',
      'category', 'Piutang Pelanggan',
      'subledgerAmount', v_ar_subledger,
      'glAmount', v_ar_gl,
      'variance', v_ar_subledger - v_ar_gl,
      'isMatched', (v_ar_subledger - v_ar_gl = 0),
      'controlAccountCode', '1-1.2.01'
    ),
    jsonb_build_object(
      'key', 'supplier_payable',
      'title', 'Hutang Usaha',
      'category', 'Hutang Pemasok',
      'subledgerAmount', v_ap_subledger,
      'glAmount', v_ap_gl,
      'variance', v_ap_subledger - v_ap_gl,
      'isMatched', (v_ap_subledger - v_ap_gl = 0),
      'controlAccountCode', '2-1.1.01'
    ),
    jsonb_build_object(
      'key', 'inventory',
      'title', 'Persediaan',
      'category', 'Inventaris Fisik & WIP',
      'subledgerAmount', v_inv_subledger,
      'glAmount', v_inv_gl,
      'variance', v_inv_subledger - v_inv_gl,
      'isMatched', (v_inv_subledger - v_inv_gl = 0),
      'controlAccountCode', '1-1.4.xx'
    ),
    jsonb_build_object(
      'key', 'fixed_assets',
      'title', 'Aset Tetap',
      'category', 'Biaya Perolehan Register Aset',
      'subledgerAmount', v_fa_subledger,
      'glAmount', v_fa_gl,
      'variance', v_fa_subledger - v_fa_gl,
      'isMatched', (v_fa_subledger - v_fa_gl = 0),
      'controlAccountCode', '1-2.0.xx'
    ),
    jsonb_build_object(
      'key', 'accumulated_depreciation',
      'title', 'Akumulasi Penyusutan',
      'category', 'Akumulasi Beban Depresiasi',
      'subledgerAmount', v_dep_subledger,
      'glAmount', v_dep_gl,
      'variance', v_dep_subledger - v_dep_gl,
      'isMatched', (v_dep_subledger - v_dep_gl = 0),
      'controlAccountCode', '1-2.1.xx'
    )
  );

  RETURN jsonb_build_object(
    'companyId', p_company_id,
    'asOfDate', v_as_of_date,
    'allMatched', (v_matched_count = 6),
    'matchedCount', v_matched_count,
    'totalCount', 6,
    'items', v_items
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_balance_sheet(p_company_id uuid, p_date_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_date_to date;
  v_company_exists boolean;
  v_current_year_start date;
  v_prior_year_end date;
  v_current_year_earnings numeric := 0;
  v_prior_year_earnings numeric := 0;
  v_total_current_assets numeric := 0;
  v_total_fixed_assets numeric := 0;
  v_total_other_assets numeric := 0;
  v_total_assets numeric := 0;
  v_total_current_liabilities numeric := 0;
  v_total_long_term_liabilities numeric := 0;
  v_total_liabilities numeric := 0;
  v_total_gl_equity numeric := 0;
  v_total_equity numeric := 0;
  v_total_liabilities_and_equity numeric := 0;
  v_difference numeric := 0;
  v_current_asset_items jsonb;
  v_fixed_asset_items jsonb;
  v_other_asset_items jsonb;
  v_current_liability_items jsonb;
  v_long_term_liability_items jsonb;
  v_equity_items jsonb;
BEGIN
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  PERFORM tenant_private.assert_mis_company_access(p_company_id, NULL);
  -- Validasi Perusahaan
  SELECT EXISTS (SELECT 1 FROM public.company WHERE id = p_company_id) INTO v_company_exists;
  IF NOT v_company_exists THEN
    RAISE EXCEPTION 'Perusahaan dengan ID % tidak ditemukan.', p_company_id;
  END IF;

  v_date_to := coalesce(p_date_to, (now() AT TIME ZONE 'Asia/Jakarta')::date);
  v_current_year_start := (extract(year from v_date_to)::text || '-01-01')::date;
  v_prior_year_end := ((extract(year from v_date_to)::int - 1) || '-12-31')::date;

  -- 1. Hitung Laba Tahun Berjalan (Current-Year Earnings YTD)
  SELECT coalesce(sum(
    CASE
      WHEN la.level1 IN ('PENDAPATAN', 'PENDAPATAN LAIN') THEN
        CASE WHEN la.report_sign = 'negative' THEN -(jl.debit - jl.credit) ELSE (jl.credit - jl.debit) END
      ELSE -- Expense
        - (jl.debit - jl.credit)
    END
  ), 0)
  INTO v_current_year_earnings
  FROM public.journal_line jl
  JOIN public.journal_entry je ON je.id = jl.journal_entry_id AND je.company_id = jl.company_id
  JOIN public.ledger_account la ON la.id = jl.account_id AND la.company_id = jl.company_id
  WHERE je.company_id = p_company_id
    AND je.status = 'posted'
    AND je.transaction_date >= v_current_year_start
    AND je.transaction_date <= v_date_to
    AND la.account_type IN ('revenue', 'expense');

  -- 2. Hitung Laba Belum Ditutup Tahun Sebelumnya (Prior-Year Unclosed Earnings)
  SELECT coalesce(sum(
    CASE
      WHEN la.level1 IN ('PENDAPATAN', 'PENDAPATAN LAIN') THEN
        CASE WHEN la.report_sign = 'negative' THEN -(jl.debit - jl.credit) ELSE (jl.credit - jl.debit) END
      ELSE -- Expense
        - (jl.debit - jl.credit)
    END
  ), 0)
  INTO v_prior_year_earnings
  FROM public.journal_line jl
  JOIN public.journal_entry je ON je.id = jl.journal_entry_id AND je.company_id = jl.company_id
  JOIN public.ledger_account la ON la.id = jl.account_id AND la.company_id = jl.company_id
  WHERE je.company_id = p_company_id
    AND je.status = 'posted'
    AND je.transaction_date <= v_prior_year_end
    AND la.account_type IN ('revenue', 'expense');

  -- 3. Agregasi Akun Neraca (Aset, Kewajiban, Ekuitas)
  WITH balance_lines AS (
    SELECT
      la.id,
      la.code,
      la.name,
      la.level1,
      la.level2,
      la.level3,
      la.account_type,
      la.normal_balance,
      la.report_sign,
      coalesce(sum(jl.debit), 0) AS debit,
      coalesce(sum(jl.credit), 0) AS credit,
      CASE
        WHEN la.account_type = 'asset' THEN
          CASE
            -- Contra Asset (Akumulasi Penyusutan, report_sign = negative):
            WHEN la.report_sign = 'negative' THEN -(coalesce(sum(jl.credit), 0) - coalesce(sum(jl.debit), 0))
            ELSE (coalesce(sum(jl.debit), 0) - coalesce(sum(jl.credit), 0))
          END
        WHEN la.account_type = 'liability' THEN
          (coalesce(sum(jl.credit), 0) - coalesce(sum(jl.debit), 0))
        WHEN la.account_type = 'equity' THEN
          CASE
            -- Contra Equity (Prive, report_sign = negative):
            WHEN la.report_sign = 'negative' THEN -(coalesce(sum(jl.debit), 0) - coalesce(sum(jl.credit), 0))
            ELSE (coalesce(sum(jl.credit), 0) - coalesce(sum(jl.debit), 0))
          END
        ELSE 0
      END AS presentation_amount
    FROM public.ledger_account la
    LEFT JOIN (
      SELECT jl.account_id, jl.company_id, jl.debit, jl.credit
      FROM public.journal_line jl
      JOIN public.journal_entry je ON je.id = jl.journal_entry_id AND je.company_id = jl.company_id
      WHERE je.status = 'posted'
        AND je.transaction_date <= v_date_to
    ) jl ON jl.account_id = la.id AND jl.company_id = la.company_id
    WHERE la.company_id = p_company_id
      AND la.account_type IN ('asset', 'liability', 'equity')
      -- Akun virtual 3-3.0.00 di-exclude agar tidak double counting
      AND la.code <> '3-3.0.00'
    GROUP BY la.id, la.code, la.name, la.level1, la.level2, la.level3, la.account_type, la.normal_balance, la.report_sign
  )
  SELECT
    coalesce(sum(presentation_amount) FILTER (WHERE level1 = 'AKTIVA' AND level2 = 'AKTIVA LANCAR'), 0),
    coalesce(sum(presentation_amount) FILTER (WHERE level1 = 'AKTIVA' AND level2 = 'AKTIVA TETAP'), 0),
    coalesce(sum(presentation_amount) FILTER (WHERE level1 = 'AKTIVA' AND level2 NOT IN ('AKTIVA LANCAR', 'AKTIVA TETAP')), 0),
    coalesce(sum(presentation_amount) FILTER (WHERE level1 = 'KEWAJIBAN' AND level2 = 'HUTANG JANGKA PENDEK'), 0),
    coalesce(sum(presentation_amount) FILTER (WHERE level1 = 'KEWAJIBAN' AND level2 = 'HUTANG JANGKA PANJANG'), 0),
    coalesce(sum(presentation_amount) FILTER (WHERE level1 = 'MODAL'), 0),
    -- JSON lists
    coalesce(jsonb_agg(
      jsonb_build_object('id', id, 'code', code, 'name', name, 'level2', level2, 'level3', level3, 'amount', presentation_amount)
    ) FILTER (WHERE level1 = 'AKTIVA' AND level2 = 'AKTIVA LANCAR' AND (debit <> 0 OR credit <> 0)), '[]'::jsonb),
    coalesce(jsonb_agg(
      jsonb_build_object('id', id, 'code', code, 'name', name, 'level2', level2, 'level3', level3, 'amount', presentation_amount, 'isContra', report_sign = 'negative')
    ) FILTER (WHERE level1 = 'AKTIVA' AND level2 = 'AKTIVA TETAP' AND (debit <> 0 OR credit <> 0)), '[]'::jsonb),
    coalesce(jsonb_agg(
      jsonb_build_object('id', id, 'code', code, 'name', name, 'level2', level2, 'level3', level3, 'amount', presentation_amount)
    ) FILTER (WHERE level1 = 'AKTIVA' AND level2 NOT IN ('AKTIVA LANCAR', 'AKTIVA TETAP') AND (debit <> 0 OR credit <> 0)), '[]'::jsonb),
    coalesce(jsonb_agg(
      jsonb_build_object('id', id, 'code', code, 'name', name, 'level2', level2, 'level3', level3, 'amount', presentation_amount)
    ) FILTER (WHERE level1 = 'KEWAJIBAN' AND level2 = 'HUTANG JANGKA PENDEK' AND (debit <> 0 OR credit <> 0)), '[]'::jsonb),
    coalesce(jsonb_agg(
      jsonb_build_object('id', id, 'code', code, 'name', name, 'level2', level2, 'level3', level3, 'amount', presentation_amount)
    ) FILTER (WHERE level1 = 'KEWAJIBAN' AND level2 = 'HUTANG JANGKA PANJANG' AND (debit <> 0 OR credit <> 0)), '[]'::jsonb),
    coalesce(jsonb_agg(
      jsonb_build_object('id', id, 'code', code, 'name', name, 'level2', level2, 'level3', level3, 'amount', presentation_amount, 'isContra', report_sign = 'negative')
    ) FILTER (WHERE level1 = 'MODAL' AND (debit <> 0 OR credit <> 0)), '[]'::jsonb)
  INTO
    v_total_current_assets,
    v_total_fixed_assets,
    v_total_other_assets,
    v_total_current_liabilities,
    v_total_long_term_liabilities,
    v_total_gl_equity,
    v_current_asset_items,
    v_fixed_asset_items,
    v_other_asset_items,
    v_current_liability_items,
    v_long_term_liability_items,
    v_equity_items
  FROM balance_lines;

  v_total_assets := v_total_current_assets + v_total_fixed_assets + v_total_other_assets;
  v_total_liabilities := v_total_current_liabilities + v_total_long_term_liabilities;
  v_total_equity := v_total_gl_equity + v_prior_year_earnings + v_current_year_earnings;
  v_total_liabilities_and_equity := v_total_liabilities + v_total_equity;
  v_difference := v_total_assets - v_total_liabilities_and_equity;

  RETURN jsonb_build_object(
    'companyId', p_company_id,
    'asOfDate', v_date_to,
    'totalCurrentAssets', v_total_current_assets,
    'totalFixedAssets', v_total_fixed_assets,
    'totalOtherAssets', v_total_other_assets,
    'totalAssets', v_total_assets,
    'totalCurrentLiabilities', v_total_current_liabilities,
    'totalLongTermLiabilities', v_total_long_term_liabilities,
    'totalLiabilities', v_total_liabilities,
    'totalGlEquity', v_total_gl_equity,
    'priorYearUnclosedEarnings', v_prior_year_earnings,
    'currentYearEarnings', v_current_year_earnings,
    'totalEquity', v_total_equity,
    'totalLiabilitiesAndEquity', v_total_liabilities_and_equity,
    'difference', v_difference,
    'isBalanced', (v_difference = 0),
    'sections', jsonb_build_object(
      'currentAssets', v_current_asset_items,
      'fixedAssets', v_fixed_asset_items,
      'otherAssets', v_other_asset_items,
      'currentLiabilities', v_current_liability_items,
      'longTermLiabilities', v_long_term_liability_items,
      'equity', v_equity_items
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_cash_flow_statement(p_company_id uuid, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_date_from date;
  v_date_to date;
  v_company_exists boolean;
  v_opening_cash numeric := 0;
  v_closing_cash numeric := 0;
  v_customer_receipts numeric := 0;
  v_supplier_payments numeric := 0;
  v_payroll_and_operating numeric := 0;
  v_other_operating numeric := 0;
  v_net_operating numeric := 0;
  v_asset_purchases numeric := 0;
  v_asset_disposals numeric := 0;
  v_other_investing numeric := 0;
  v_net_investing numeric := 0;
  v_owner_contributions numeric := 0;
  v_owner_drawings numeric := 0;
  v_debt_financing numeric := 0;
  v_other_financing numeric := 0;
  v_net_financing numeric := 0;
  v_net_cash_change numeric := 0;
  v_gl_cash_balance numeric := 0;
  v_reconciliation_difference numeric := 0;
  v_items jsonb;
BEGIN
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  PERFORM tenant_private.assert_mis_company_access(p_company_id, NULL);
  -- Validasi Perusahaan
  SELECT EXISTS (SELECT 1 FROM public.company WHERE id = p_company_id) INTO v_company_exists;
  IF NOT v_company_exists THEN
    RAISE EXCEPTION 'Perusahaan dengan ID % tidak ditemukan.', p_company_id;
  END IF;

  v_date_to := coalesce(p_date_to, (now() AT TIME ZONE 'Asia/Jakarta')::date);
  v_date_from := coalesce(p_date_from, (date_trunc('month', v_date_to))::date);

  -- 1. Saldo Awal Kas & Bank (sebelum v_date_from)
  SELECT coalesce(sum(amount), 0)
  INTO v_opening_cash
  FROM public.cash_movement
  WHERE company_id = p_company_id
    AND transaction_date < v_date_from;

  -- 2. Saldo Akhir Kas & Bank (sampai v_date_to)
  SELECT coalesce(sum(amount), 0)
  INTO v_closing_cash
  FROM public.cash_movement
  WHERE company_id = p_company_id
    AND transaction_date <= v_date_to;

  -- 3. Klasifikasi Mutasi Kas Periode Ini (Metode Langsung)
  WITH classified_movements AS (
    SELECT
      cm.id,
      cm.transaction_date,
      cm.amount,
      cm.movement_type,
      cm.notes,
      bd.document_kind,
      bd.document_number,
      CASE
        -- Investigasi Pembelian Aset Tetap (CapEx)
        WHEN bd.document_kind = 'asset_purchase' THEN 'investing'
        WHEN bd.document_kind = 'asset_disposal' THEN 'investing'
        WHEN bd.document_kind = 'purchase_payment' AND EXISTS (
          SELECT 1 FROM public.business_document parent
          WHERE parent.id = bd.source_document_id AND parent.document_kind = 'asset_purchase'
        ) THEN 'investing'
        -- Pendanaan
        WHEN cm.notes ILIKE '%modal%' OR cm.notes ILIKE '%setoran%' THEN 'financing'
        WHEN cm.notes ILIKE '%prive%' OR cm.notes ILIKE '%tarik%' THEN 'financing'
        WHEN cm.notes ILIKE '%pinjaman%' OR cm.notes ILIKE '%hutang bank%' THEN 'financing'
        -- Operasional Default
        ELSE 'operating'
      END AS activity,
      CASE
        -- Group Detail
        WHEN bd.document_kind IN ('sale', 'sales_receipt') THEN 'customer_receipts'
        WHEN bd.document_kind IN ('purchase_material', 'purchase_supplies', 'purchase_payment') AND NOT EXISTS (
          SELECT 1 FROM public.business_document parent
          WHERE parent.id = bd.source_document_id AND parent.document_kind = 'asset_purchase'
        ) THEN 'supplier_payments'
        WHEN bd.document_kind IN ('wage_payment', 'operating_expense') THEN 'payroll_and_operating_expenses'
        WHEN bd.document_kind = 'asset_purchase' OR (bd.document_kind = 'purchase_payment' AND EXISTS (
          SELECT 1 FROM public.business_document parent
          WHERE parent.id = bd.source_document_id AND parent.document_kind = 'asset_purchase'
        )) THEN 'asset_purchases'
        WHEN bd.document_kind = 'asset_disposal' THEN 'asset_disposals'
        WHEN cm.notes ILIKE '%modal%' OR cm.notes ILIKE '%setoran%' THEN 'owner_contributions'
        WHEN cm.notes ILIKE '%prive%' OR cm.notes ILIKE '%tarik%' THEN 'owner_drawings'
        WHEN cm.notes ILIKE '%pinjaman%' THEN 'debt_financing'
        ELSE 'other'
      END AS flow_group
    FROM public.cash_movement cm
    LEFT JOIN public.business_document bd ON bd.id = cm.source_document_id AND bd.company_id = cm.company_id
    WHERE cm.company_id = p_company_id
      AND cm.transaction_date >= v_date_from
      AND cm.transaction_date <= v_date_to
      -- Exclude internal transfer
      AND cm.movement_type <> 'cash_transfer'
      AND coalesce(bd.document_kind, '') <> 'cash_transfer'
  )
  SELECT
    coalesce(sum(amount) FILTER (WHERE activity = 'operating' AND flow_group = 'customer_receipts'), 0),
    coalesce(sum(amount) FILTER (WHERE activity = 'operating' AND flow_group = 'supplier_payments'), 0),
    coalesce(sum(amount) FILTER (WHERE activity = 'operating' AND flow_group = 'payroll_and_operating_expenses'), 0),
    coalesce(sum(amount) FILTER (WHERE activity = 'operating' AND flow_group = 'other'), 0),
    coalesce(sum(amount) FILTER (WHERE activity = 'investing' AND flow_group = 'asset_purchases'), 0),
    coalesce(sum(amount) FILTER (WHERE activity = 'investing' AND flow_group = 'asset_disposals'), 0),
    coalesce(sum(amount) FILTER (WHERE activity = 'investing' AND flow_group = 'other'), 0),
    coalesce(sum(amount) FILTER (WHERE activity = 'financing' AND flow_group = 'owner_contributions'), 0),
    coalesce(sum(amount) FILTER (WHERE activity = 'financing' AND flow_group = 'owner_drawings'), 0),
    coalesce(sum(amount) FILTER (WHERE activity = 'financing' AND flow_group = 'debt_financing'), 0),
    coalesce(sum(amount) FILTER (WHERE activity = 'financing' AND flow_group = 'other'), 0),
    coalesce(jsonb_agg(
      jsonb_build_object(
        'id', id,
        'date', transaction_date,
        'amount', amount,
        'activity', activity,
        'group', flow_group,
        'documentKind', document_kind,
        'documentNumber', document_number,
        'notes', notes
      ) ORDER BY transaction_date DESC
    ), '[]'::jsonb)
  INTO
    v_customer_receipts,
    v_supplier_payments,
    v_payroll_and_operating,
    v_other_operating,
    v_asset_purchases,
    v_asset_disposals,
    v_other_investing,
    v_owner_contributions,
    v_owner_drawings,
    v_debt_financing,
    v_other_financing,
    v_items
  FROM classified_movements;

  v_net_operating := v_customer_receipts + v_supplier_payments + v_payroll_and_operating + v_other_operating;
  v_net_investing := v_asset_purchases + v_asset_disposals + v_other_investing;
  v_net_financing := v_owner_contributions + v_owner_drawings + v_debt_financing + v_other_financing;
  v_net_cash_change := v_net_operating + v_net_investing + v_net_financing;

  -- 4. Rekonsiliasi Kas: Saldo Kas Movement vs GL Akun Kas/Bank
  SELECT coalesce(sum(jl.debit - jl.credit), 0)
  INTO v_gl_cash_balance
  FROM public.journal_line jl
  JOIN public.journal_entry je ON je.id = jl.journal_entry_id AND je.company_id = jl.company_id
  JOIN public.ledger_account la ON la.id = jl.account_id AND la.company_id = jl.company_id
  WHERE je.company_id = p_company_id
    AND je.status = 'posted'
    AND je.transaction_date <= v_date_to
    AND la.level3 = 'KAS DAN BANK';

  v_reconciliation_difference := v_closing_cash - v_gl_cash_balance;

  RETURN jsonb_build_object(
    'companyId', p_company_id,
    'dateFrom', v_date_from,
    'dateTo', v_date_to,
    'openingCashBalance', v_opening_cash,
    'closingCashBalance', v_closing_cash,
    'netCashChange', v_net_cash_change,
    'operatingActivities', jsonb_build_object(
      'customerReceipts', v_customer_receipts,
      'supplierPayments', v_supplier_payments,
      'payrollAndOperating', v_payroll_and_operating,
      'otherOperating', v_other_operating,
      'netOperatingCashFlow', v_net_operating
    ),
    'investingActivities', jsonb_build_object(
      'assetPurchases', v_asset_purchases,
      'assetDisposals', v_asset_disposals,
      'otherInvesting', v_other_investing,
      'netInvestingCashFlow', v_net_investing
    ),
    'financingActivities', jsonb_build_object(
      'ownerContributions', v_owner_contributions,
      'ownerDrawings', v_owner_drawings,
      'debtFinancing', v_debt_financing,
      'otherFinancing', v_other_financing,
      'netFinancingCashFlow', v_net_financing
    ),
    'reconciliation', jsonb_build_object(
      'cashMovementBalance', v_closing_cash,
      'glCashBalance', v_gl_cash_balance,
      'difference', v_reconciliation_difference,
      'isMatched', (v_reconciliation_difference = 0)
    ),
    'items', v_items
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_companies_with_stats()
 RETURNS TABLE(id uuid, code text, name text, address text, phone text, email text, logo_storage_key text, is_active boolean, code_locked boolean, version integer, created_at timestamp with time zone, updated_at timestamp with time zone, assigned_users_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid;
BEGIN
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  PERFORM tenant_private.assert_mis_actor();
  v_user_id := (SELECT auth.uid());
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Akses ditolak: Pengguna belum terautentikasi.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.code,
    c.name,
    c.address,
    c.phone,
    c.email,
    c.logo_storage_key,
    c.is_active,
    c.code_locked,
    c.version,
    c.created_at,
    c.updated_at,
    COALESCE(count(uca.user_id) FILTER (WHERE uca.is_active = true), 0)::bigint AS assigned_users_count
  FROM public.company c
  LEFT JOIN public.user_company_assignment uca ON uca.company_id = c.id
  WHERE c.id IN (SELECT public.get_user_company_ids(v_user_id))
     OR public.is_company_owner(c.id, v_user_id)
  GROUP BY c.id
  ORDER BY c.name ASC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_company_users_with_profiles(p_company_id uuid)
 RETURNS TABLE(company_id uuid, user_id uuid, email text, full_name text, username text, roles text[], is_active boolean, version integer, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  PERFORM tenant_private.assert_mis_company_access(p_company_id, NULL);
  -- Validasi otorisasi: pengguna yang memanggil harus anggota company aktif atau owner
  -- Menggunakan alias uca_check untuk menghindari ambiguitas dengan kolom output RETURNS TABLE
  IF NOT EXISTS (
    SELECT 1 FROM public.user_company_assignment uca_check
    WHERE uca_check.company_id = p_company_id
      AND uca_check.user_id = (SELECT auth.uid())
      AND uca_check.is_active = true
  ) THEN
    RAISE EXCEPTION 'Akses ditolak: Anda bukan anggota aktif dari perusahaan ini.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    uca.company_id,
    uca.user_id,
    au.email::text,
    COALESCE(
      au.raw_user_meta_data->>'full_name',
      au.raw_user_meta_data->>'name',
      au.raw_user_meta_data->>'username',
      split_part(au.email, '@', 1)
    )::text AS full_name,
    COALESCE(
      au.raw_user_meta_data->>'username',
      split_part(au.email, '@', 1)
    )::text AS username,
    uca.roles,
    uca.is_active,
    uca.version,
    uca.created_at,
    uca.updated_at
  FROM public.user_company_assignment uca
  JOIN auth.users au ON uca.user_id = au.id
  WHERE uca.company_id = p_company_id
  ORDER BY uca.created_at ASC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_depreciation_preview(p_company_id uuid, p_period_month text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  PERFORM tenant_private.assert_mis_company_access(p_company_id, NULL);
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
$function$;

CREATE OR REPLACE FUNCTION public.get_general_ledger_entries(p_company_id uuid, p_account_id uuid, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_date_from date;
  v_date_to date;
  v_account RECORD;
  v_opening_debit numeric := 0;
  v_opening_credit numeric := 0;
  v_opening_balance numeric := 0;
  v_total_period_debit numeric := 0;
  v_total_period_credit numeric := 0;
  v_ending_balance numeric := 0;
  v_total_count integer := 0;
  v_entries jsonb;
BEGIN
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  PERFORM tenant_private.assert_mis_company_access(p_company_id, NULL);
  -- Validasi Akun
  SELECT * INTO v_account
  FROM public.ledger_account
  WHERE company_id = p_company_id AND id = p_account_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Akun dengan ID % tidak ditemukan pada perusahaan ini.', p_account_id;
  END IF;

  v_date_to := coalesce(p_date_to, (now() AT TIME ZONE 'Asia/Jakarta')::date);
  v_date_from := coalesce(p_date_from, (date_trunc('month', v_date_to))::date);

  -- 1. Saldo Awal (sebelum v_date_from)
  SELECT
    coalesce(sum(jl.debit), 0),
    coalesce(sum(jl.credit), 0)
  INTO v_opening_debit, v_opening_credit
  FROM public.journal_line jl
  JOIN public.journal_entry je ON je.id = jl.journal_entry_id AND je.company_id = jl.company_id
  WHERE jl.company_id = p_company_id
    AND jl.account_id = p_account_id
    AND je.status = 'posted'
    AND je.transaction_date < v_date_from;

  IF v_account.normal_balance = 'credit' THEN
    v_opening_balance := v_opening_credit - v_opening_debit;
  ELSE
    v_opening_balance := v_opening_debit - v_opening_credit;
  END IF;

  -- 2. Total Mutasi Periode Ini
  SELECT
    coalesce(sum(jl.debit), 0),
    coalesce(sum(jl.credit), 0),
    count(jl.id)
  INTO v_total_period_debit, v_total_period_credit, v_total_count
  FROM public.journal_line jl
  JOIN public.journal_entry je ON je.id = jl.journal_entry_id AND je.company_id = jl.company_id
  WHERE jl.company_id = p_company_id
    AND jl.account_id = p_account_id
    AND je.status = 'posted'
    AND je.transaction_date >= v_date_from
    AND je.transaction_date <= v_date_to;

  IF v_account.normal_balance = 'credit' THEN
    v_ending_balance := v_opening_balance + v_total_period_credit - v_total_period_debit;
  ELSE
    v_ending_balance := v_opening_balance + v_total_period_debit - v_total_period_credit;
  END IF;

  -- 3. Baris Transaksi dengan Running Balance
  WITH all_lines AS (
    SELECT
      jl.id,
      je.id AS journal_entry_id,
      je.entry_number,
      je.transaction_date,
      je.memo,
      coalesce(jl.description, je.description) AS description,
      jl.debit,
      jl.credit,
      bd.document_number,
      bd.document_kind,
      sum(
        CASE WHEN v_account.normal_balance = 'debit' THEN jl.debit - jl.credit ELSE jl.credit - jl.debit END
      ) OVER (
        ORDER BY je.transaction_date ASC, je.posted_at ASC, je.id ASC, jl.line_number ASC
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS running_movement
    FROM public.journal_line jl
    JOIN public.journal_entry je ON je.id = jl.journal_entry_id AND je.company_id = jl.company_id
    LEFT JOIN public.business_document bd ON bd.id = je.source_document_id AND bd.company_id = je.company_id
    WHERE jl.company_id = p_company_id
      AND jl.account_id = p_account_id
      AND je.status = 'posted'
      AND je.transaction_date >= v_date_from
      AND je.transaction_date <= v_date_to
    ORDER BY je.transaction_date ASC, je.posted_at ASC, je.id ASC, jl.line_number ASC
  )
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', id,
      'journalEntryId', journal_entry_id,
      'entryNumber', entry_number,
      'transactionDate', transaction_date,
      'documentNumber', document_number,
      'documentKind', document_kind,
      'memo', memo,
      'description', description,
      'debit', debit,
      'credit', credit,
      'runningBalance', v_opening_balance + running_movement
    )
  ), '[]'::jsonb)
  INTO v_entries
  FROM (
    SELECT * FROM all_lines
    LIMIT p_limit OFFSET p_offset
  ) paged;

  RETURN jsonb_build_object(
    'account', jsonb_build_object(
      'id', v_account.id,
      'code', v_account.code,
      'name', v_account.name,
      'level1', v_account.level1,
      'level2', v_account.level2,
      'level3', v_account.level3,
      'accountType', v_account.account_type,
      'normalBalance', v_account.normal_balance,
      'reportSign', v_account.report_sign
    ),
    'dateFrom', v_date_from,
    'dateTo', v_date_to,
    'openingBalance', v_opening_balance,
    'totalDebit', v_total_period_debit,
    'totalCredit', v_total_period_credit,
    'endingBalance', v_ending_balance,
    'totalCount', v_total_count,
    'limit', p_limit,
    'offset', p_offset,
    'entries', v_entries
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_hpp_manufacturing_summary(p_company_id uuid, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_date_from date;
  v_date_to date;
  v_company_exists boolean;
  v_direct_material_cost numeric := 0;
  v_direct_labor_cost numeric := 0;
  v_labor_cutting numeric := 0;
  v_labor_printing numeric := 0;
  v_labor_sewing numeric := 0;
  v_labor_packing numeric := 0;
  v_labor_head_fee numeric := 0;
  v_supplies_cost numeric := 0;
  v_depreciation_cost numeric := 0;
  v_other_overhead numeric := 0;
  v_factory_overhead numeric := 0;
  v_total_manufacturing_cost numeric := 0;
  v_total_actual_cogs numeric := 0;
  v_gl_cogs numeric := 0;
  v_cogs_difference numeric := 0;
  v_materials_breakdown jsonb;
  v_products_breakdown jsonb;
BEGIN
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  PERFORM tenant_private.assert_mis_company_access(p_company_id, NULL);
  -- Validasi Perusahaan
  SELECT EXISTS (SELECT 1 FROM public.company WHERE id = p_company_id) INTO v_company_exists;
  IF NOT v_company_exists THEN
    RAISE EXCEPTION 'Perusahaan dengan ID % tidak ditemukan.', p_company_id;
  END IF;

  v_date_to := coalesce(p_date_to, (now() AT TIME ZONE 'Asia/Jakarta')::date);
  v_date_from := coalesce(p_date_from, (date_trunc('month', v_date_to))::date);

  -- 1. Biaya Bahan Baku Langsung (Direct Materials)
  -- Pemakaian roll kain dan material dari pemotongan (inventory_movement bahan baku yang berkurang)
  WITH material_usage AS (
    SELECT
      im.item_id,
      mr.name AS item_name,
      abs(sum(im.quantity)) AS qty_used,
      abs(sum(im.total_cost)) AS cost_used
    FROM public.inventory_movement im
    JOIN public.master_record mr ON mr.id = im.item_id AND mr.company_id = im.company_id
    WHERE im.company_id = p_company_id
      AND im.inventory_state = 'material'
      AND im.quantity < 0
      AND im.business_date >= v_date_from
      AND im.business_date <= v_date_to
    GROUP BY im.item_id, mr.name
  )
  SELECT
    coalesce(sum(cost_used), 0),
    coalesce(jsonb_agg(
      jsonb_build_object(
        'itemId', item_id,
        'itemName', item_name,
        'quantityUsed', qty_used,
        'totalCost', cost_used
      )
    ), '[]'::jsonb)
  INTO v_direct_material_cost, v_materials_breakdown
  FROM material_usage;

  v_direct_material_cost := coalesce(v_direct_material_cost, 0);

  -- 2. Biaya Tenaga Kerja Langsung (SPK 4 Tahap dari wage_liability)
  SELECT
    coalesce(sum(gross_amount), 0),
    coalesce(sum(gross_amount) FILTER (WHERE service_kind = 'cutting'), 0),
    coalesce(sum(gross_amount) FILTER (WHERE service_kind = 'printing'), 0),
    coalesce(sum(gross_amount) FILTER (WHERE service_kind = 'sewing'), 0),
    coalesce(sum(gross_amount) FILTER (WHERE service_kind = 'packing'), 0),
    coalesce(sum(gross_amount) FILTER (WHERE service_kind = 'head_fee'), 0)
  INTO
    v_direct_labor_cost,
    v_labor_cutting,
    v_labor_printing,
    v_labor_sewing,
    v_labor_packing,
    v_labor_head_fee
  FROM public.wage_liability
  WHERE company_id = p_company_id
    AND (posted_at AT TIME ZONE 'Asia/Jakarta')::date >= v_date_from
    AND (posted_at AT TIME ZONE 'Asia/Jakarta')::date <= v_date_to;

  -- 3. Biaya Overhead Pabrik (BOP)
  -- a. Perlengkapan produksi terpakai
  SELECT coalesce(sum(abs(total_cost)), 0)
  INTO v_supplies_cost
  FROM public.inventory_movement
  WHERE company_id = p_company_id
    AND inventory_state = 'production_supplies'
    AND quantity < 0
    AND business_date >= v_date_from
    AND business_date <= v_date_to;

  -- b. Penyusutan mesin pabrik / peralatan
  SELECT coalesce(sum(de.amount), 0)
  INTO v_depreciation_cost
  FROM public.depreciation_entry de
  WHERE de.company_id = p_company_id
    AND (de.posted_at AT TIME ZONE 'Asia/Jakarta')::date >= v_date_from
    AND (de.posted_at AT TIME ZONE 'Asia/Jakarta')::date <= v_date_to;

  -- c. Biaya overhead operasional pabrik dari jurnal (akun level3: Biaya Aksesoris/BOP)
  SELECT coalesce(sum(jl.debit - jl.credit), 0)
  INTO v_other_overhead
  FROM public.journal_line jl
  JOIN public.journal_entry je ON je.id = jl.journal_entry_id AND je.company_id = jl.company_id
  JOIN public.ledger_account la ON la.id = jl.account_id AND la.company_id = jl.company_id
  WHERE je.company_id = p_company_id
    AND je.status = 'posted'
    AND je.transaction_date >= v_date_from
    AND je.transaction_date <= v_date_to
    AND (la.code = '6-2.1.03' OR la.name ILIKE '%overhead%');

  v_factory_overhead := v_supplies_cost + v_depreciation_cost + v_other_overhead;
  v_total_manufacturing_cost := v_direct_material_cost + v_direct_labor_cost + v_factory_overhead;

  -- 4. HPP per SKU Barang Jadi (Analisis Aktual vs Standar BOM)
  WITH product_movements AS (
    SELECT
      mr.id AS product_id,
      mr.sku,
      mr.name AS product_name,
      coalesce(sum(im.quantity) FILTER (WHERE im.inventory_state = 'packed_finished_goods' AND im.quantity > 0), 0) AS qty_produced,
      coalesce(sum(abs(im.quantity)) FILTER (WHERE im.inventory_state = 'packed_finished_goods' AND im.quantity < 0), 0) AS qty_sold,
      coalesce(sum(im.total_cost) FILTER (WHERE im.inventory_state = 'packed_finished_goods' AND im.quantity > 0), 0) AS total_production_cost,
      coalesce(sum(abs(im.total_cost)) FILTER (WHERE im.inventory_state = 'packed_finished_goods' AND im.quantity < 0), 0) AS total_sold_cogs
    FROM public.master_record mr
    LEFT JOIN public.inventory_movement im ON im.item_id = mr.id AND im.company_id = mr.company_id
      AND im.business_date >= v_date_from
      AND im.business_date <= v_date_to
    WHERE mr.company_id = p_company_id
      AND mr.record_kind = 'product'
    GROUP BY mr.id, mr.sku, mr.name
  ),
  product_hpp AS (
    SELECT
      pm.product_id,
      pm.sku,
      pm.product_name,
      pm.qty_produced,
      pm.qty_sold,
      pm.total_production_cost,
      pm.total_sold_cogs,
      CASE WHEN pm.qty_produced > 0 THEN round(pm.total_production_cost / pm.qty_produced, 2) ELSE 0 END AS actual_hpp_per_unit,
      -- Estimasi BOM standar dari master_record bom jika ada
      coalesce((
        SELECT (b.data->>'standardCost')::numeric
        FROM public.master_record b
        WHERE b.company_id = p_company_id AND b.record_kind = 'bom' AND (b.data->>'productId') = pm.product_id::text
        LIMIT 1
      ), 0) AS bom_standard_hpp
    FROM product_movements pm
    WHERE pm.qty_produced > 0 OR pm.qty_sold > 0
  )
  SELECT
    coalesce(sum(total_sold_cogs), 0),
    coalesce(jsonb_agg(
      jsonb_build_object(
        'productId', product_id,
        'sku', sku,
        'name', product_name,
        'quantityProduced', qty_produced,
        'quantitySold', qty_sold,
        'totalProductionCost', total_production_cost,
        'totalSoldCogs', total_sold_cogs,
        'actualHppPerUnit', actual_hpp_per_unit,
        'bomStandardHpp', bom_standard_hpp,
        'variance', actual_hpp_per_unit - bom_standard_hpp,
        'variancePercent', CASE WHEN bom_standard_hpp > 0 THEN round(((actual_hpp_per_unit - bom_standard_hpp) / bom_standard_hpp) * 100, 2) ELSE 0 END
      ) ORDER BY sku ASC
    ), '[]'::jsonb)
  INTO v_total_actual_cogs, v_products_breakdown
  FROM product_hpp;

  -- 5. Perbandingan terhadap COGS Buku Besar (GL)
  SELECT coalesce(sum(jl.debit - jl.credit), 0)
  INTO v_gl_cogs
  FROM public.journal_line jl
  JOIN public.journal_entry je ON je.id = jl.journal_entry_id AND je.company_id = jl.company_id
  JOIN public.ledger_account la ON la.id = jl.account_id AND la.company_id = jl.company_id
  WHERE je.company_id = p_company_id
    AND je.status = 'posted'
    AND je.transaction_date >= v_date_from
    AND je.transaction_date <= v_date_to
    AND la.level1 = 'HARGA POKOK PENJUALAN';

  v_cogs_difference := v_total_actual_cogs - v_gl_cogs;

  RETURN jsonb_build_object(
    'companyId', p_company_id,
    'dateFrom', v_date_from,
    'dateTo', v_date_to,
    'directMaterialCost', v_direct_material_cost,
    'directLaborCost', v_direct_labor_cost,
    'laborBreakdown', jsonb_build_object(
      'cutting', v_labor_cutting,
      'printing', v_labor_printing,
      'sewing', v_labor_sewing,
      'packing', v_labor_packing,
      'headFee', v_labor_head_fee
    ),
    'factoryOverhead', v_factory_overhead,
    'overheadBreakdown', jsonb_build_object(
      'supplies', v_supplies_cost,
      'depreciation', v_depreciation_cost,
      'other', v_other_overhead
    ),
    'totalManufacturingCost', v_total_manufacturing_cost,
    'cogsReconciliation', jsonb_build_object(
      'actualCogs', v_total_actual_cogs,
      'glCogs', v_gl_cogs,
      'difference', v_cogs_difference,
      'isMatched', (v_cogs_difference = 0)
    ),
    'materialsBreakdown', v_materials_breakdown,
    'productsBreakdown', v_products_breakdown
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_inventory_summary(p_company_id uuid)
 RETURNS TABLE(item_id uuid, item_name text, item_kind text, unit_code text, inventory_state text, total_in numeric, total_out numeric, current_stock numeric, moving_avg_cost bigint, total_valuation bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
BEGIN
  PERFORM tenant_private.assert_mis_company_access(p_company_id, NULL);
  RETURN QUERY
SELECT 
    m.id AS item_id,
    m.name AS item_name,
    m.record_kind AS item_kind,
    coalesce(m.data->>'unitCode', m.data->>'stockUnitCode', '-') AS unit_code,
    coalesce(im.inventory_state, 'material') AS inventory_state,
    coalesce(sum(CASE WHEN im.quantity > 0 THEN im.quantity ELSE 0 END), 0) AS total_in,
    coalesce(abs(sum(CASE WHEN im.quantity < 0 THEN im.quantity ELSE 0 END)), 0) AS total_out,
    coalesce(sum(im.quantity), 0) AS current_stock,
    CASE 
      WHEN coalesce(sum(CASE WHEN im.quantity > 0 THEN im.quantity ELSE 0 END), 0) > 0 
      THEN round(sum(CASE WHEN im.quantity > 0 THEN im.total_cost ELSE 0 END) / sum(CASE WHEN im.quantity > 0 THEN im.quantity ELSE 0 END))::bigint
      ELSE 0::bigint
    END AS moving_avg_cost,
    CASE
      WHEN coalesce(sum(im.quantity), 0) > 0
      THEN (
        coalesce(sum(im.quantity), 0) * 
        CASE 
          WHEN coalesce(sum(CASE WHEN im.quantity > 0 THEN im.quantity ELSE 0 END), 0) > 0 
          THEN round(sum(CASE WHEN im.quantity > 0 THEN im.total_cost ELSE 0 END) / sum(CASE WHEN im.quantity > 0 THEN im.quantity ELSE 0 END))
          ELSE 0 
        END
      )::bigint
      ELSE 0::bigint
    END AS total_valuation
  FROM public.master_record m
  LEFT JOIN public.inventory_movement im ON im.item_id = m.id AND im.company_id = m.company_id
  WHERE m.company_id = p_company_id 
    AND m.record_kind IN ('material', 'production_supply')
    AND m.is_active = true
  GROUP BY m.id, m.name, m.record_kind, m.data, im.inventory_state
  ORDER BY m.name ASC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_production_progress_summary(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  PERFORM tenant_private.assert_mis_company_access(p_company_id, NULL);
  WITH pp_data AS (
    SELECT 
      bd.id as pp_id,
      bd.document_number,
      bd.transaction_date as target_date,
      bd.status as document_status,
      coalesce((bd.data->>'code_locked')::boolean, false) as code_locked,
      coalesce(bd.data->>'notes', '') as notes,
      coalesce((bd.data->>'total_target_pcs')::numeric, (
        SELECT coalesce(sum(quantity), 0)
        FROM public.business_document_line bdl
        WHERE bdl.document_id = bd.id AND bdl.is_current = true
      )) as target_pcs,
      (
        SELECT coalesce(sum(quantity), 0)
        FROM public.inventory_movement im
        WHERE im.source_document_id IN (
          SELECT act.id FROM public.business_document act
          WHERE act.document_kind = 'cutting_output' AND act.source_document_id IN (
            SELECT pwo.document_id FROM public.production_work_order pwo WHERE pwo.production_order_id = bd.id AND pwo.stage = 'cutting'
          )
        ) AND im.inventory_state = 'cut_components'
      ) as actual_cutting_pcs,
      (
        SELECT coalesce(sum(bsr.success_quantity), 0)
        FROM public.production_bundle_stage_result bsr
        WHERE bsr.production_order_id = bd.id AND bsr.stage = 'printing'
      ) as actual_printing_pcs,
      (
        SELECT coalesce(sum(bsr.success_quantity), 0)
        FROM public.production_bundle_stage_result bsr
        WHERE bsr.production_order_id = bd.id AND bsr.stage = 'sewing'
      ) as actual_sewing_pcs,
      (
        SELECT coalesce(sum(bsr.success_quantity), 0)
        FROM public.production_bundle_stage_result bsr
        WHERE bsr.production_order_id = bd.id AND bsr.stage = 'packing'
      ) as actual_packing_pcs,
      (
        SELECT count(*)
        FROM public.production_bundle pb
        WHERE pb.production_order_id = bd.id AND pb.work_condition <> 'completed'
      ) as active_bundle_count,
      (
        SELECT count(*)
        FROM public.production_repair_case prc
        WHERE prc.production_order_id = bd.id AND prc.business_status <> 'completed'
      ) as active_repair_count
    FROM public.business_document bd
    WHERE bd.company_id = p_company_id AND bd.document_kind = 'production_order'
    ORDER BY bd.transaction_date DESC, bd.created_at DESC
  )
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', pp_id,
      'documentNumber', document_number,
      'targetDate', target_date,
      'status', document_status,
      'codeLocked', code_locked,
      'notes', notes,
      'targetPcs', target_pcs,
      'actualCuttingPcs', actual_cutting_pcs,
      'actualPrintingPcs', actual_printing_pcs,
      'actualSewingPcs', actual_sewing_pcs,
      'actualPackingPcs', actual_packing_pcs,
      'activeBundleCount', active_bundle_count,
      'activeRepairCount', active_repair_count,
      'completionPercentage', CASE 
        WHEN target_pcs > 0 THEN round((actual_packing_pcs / target_pcs) * 100, 1)
        ELSE 0 
      END
    )
  ), '[]'::jsonb) INTO v_result
  FROM pp_data;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_profit_loss(p_company_id uuid, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_date_from date;
  v_date_to date;
  v_company_exists boolean;
  v_gross_sales numeric := 0;
  v_sales_deductions numeric := 0;
  v_net_revenue numeric := 0;
  v_total_cogs numeric := 0;
  v_gross_profit numeric := 0;
  v_total_operating_expenses numeric := 0;
  v_operating_profit numeric := 0;
  v_total_other_income numeric := 0;
  v_total_other_expenses numeric := 0;
  v_net_income numeric := 0;
  v_sales_items jsonb;
  v_deduction_items jsonb;
  v_cogs_items jsonb;
  v_expense_items jsonb;
  v_other_income_items jsonb;
  v_other_expense_items jsonb;
BEGIN
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  PERFORM tenant_private.assert_mis_company_access(p_company_id, NULL);
  -- Validasi Perusahaan
  SELECT EXISTS (SELECT 1 FROM public.company WHERE id = p_company_id) INTO v_company_exists;
  IF NOT v_company_exists THEN
    RAISE EXCEPTION 'Perusahaan dengan ID % tidak ditemukan.', p_company_id;
  END IF;

  v_date_to := coalesce(p_date_to, (now() AT TIME ZONE 'Asia/Jakarta')::date);
  v_date_from := coalesce(p_date_from, (date_trunc('month', v_date_to))::date);

  WITH pnl_lines AS (
    SELECT
      la.id,
      la.code,
      la.name,
      la.level1,
      la.level2,
      la.level3,
      la.account_type,
      la.normal_balance,
      la.report_sign,
      coalesce(sum(jl.debit), 0) AS debit,
      coalesce(sum(jl.credit), 0) AS credit,
      CASE
        WHEN la.level1 IN ('PENDAPATAN', 'PENDAPATAN LAIN') THEN
          CASE
            WHEN la.report_sign = 'negative' THEN - (coalesce(sum(jl.debit), 0) - coalesce(sum(jl.credit), 0))
            ELSE (coalesce(sum(jl.credit), 0) - coalesce(sum(jl.debit), 0))
          END
        ELSE -- Expense (HPP, BIAYA, BIAYA LAINNYA)
          CASE
            WHEN la.report_sign = 'negative' THEN - (coalesce(sum(jl.debit), 0) - coalesce(sum(jl.credit), 0))
            ELSE (coalesce(sum(jl.debit), 0) - coalesce(sum(jl.credit), 0))
          END
      END AS presentation_amount
    FROM public.ledger_account la
    LEFT JOIN (
      SELECT jl.account_id, jl.company_id, jl.debit, jl.credit
      FROM public.journal_line jl
      JOIN public.journal_entry je ON je.id = jl.journal_entry_id AND je.company_id = jl.company_id
      WHERE je.status = 'posted'
        AND je.transaction_date >= v_date_from
        AND je.transaction_date <= v_date_to
    ) jl ON jl.account_id = la.id AND jl.company_id = la.company_id
    WHERE la.company_id = p_company_id
      AND la.account_type IN ('revenue', 'expense')
    GROUP BY la.id, la.code, la.name, la.level1, la.level2, la.level3, la.account_type, la.normal_balance, la.report_sign
  )
  SELECT
    coalesce(sum(presentation_amount) FILTER (WHERE level1 = 'PENDAPATAN' AND level3 = 'PENJUALAN'), 0),
    coalesce(sum(presentation_amount) FILTER (WHERE level1 = 'PENDAPATAN' AND level3 = 'POTONGAN PENJUALAN'), 0),
    coalesce(sum(presentation_amount) FILTER (WHERE level1 = 'HARGA POKOK PENJUALAN'), 0),
    coalesce(sum(presentation_amount) FILTER (WHERE level1 = 'BIAYA'), 0),
    coalesce(sum(presentation_amount) FILTER (WHERE level1 = 'PENDAPATAN LAIN'), 0),
    coalesce(sum(presentation_amount) FILTER (WHERE level1 = 'BIAYA LAINNYA'), 0),
    -- JSON items aggregations
    coalesce(jsonb_agg(
      jsonb_build_object('id', id, 'code', code, 'name', name, 'level2', level2, 'level3', level3, 'amount', presentation_amount)
    ) FILTER (WHERE level1 = 'PENDAPATAN' AND level3 = 'PENJUALAN' AND (debit <> 0 OR credit <> 0)), '[]'::jsonb),
    coalesce(jsonb_agg(
      jsonb_build_object('id', id, 'code', code, 'name', name, 'level2', level2, 'level3', level3, 'amount', presentation_amount)
    ) FILTER (WHERE level1 = 'PENDAPATAN' AND level3 = 'POTONGAN PENJUALAN' AND (debit <> 0 OR credit <> 0)), '[]'::jsonb),
    coalesce(jsonb_agg(
      jsonb_build_object('id', id, 'code', code, 'name', name, 'level2', level2, 'level3', level3, 'amount', presentation_amount)
    ) FILTER (WHERE level1 = 'HARGA POKOK PENJUALAN' AND (debit <> 0 OR credit <> 0)), '[]'::jsonb),
    coalesce(jsonb_agg(
      jsonb_build_object('id', id, 'code', code, 'name', name, 'level2', level2, 'level3', level3, 'amount', presentation_amount)
    ) FILTER (WHERE level1 = 'BIAYA' AND (debit <> 0 OR credit <> 0)), '[]'::jsonb),
    coalesce(jsonb_agg(
      jsonb_build_object('id', id, 'code', code, 'name', name, 'level2', level2, 'level3', level3, 'amount', presentation_amount)
    ) FILTER (WHERE level1 = 'PENDAPATAN LAIN' AND (debit <> 0 OR credit <> 0)), '[]'::jsonb),
    coalesce(jsonb_agg(
      jsonb_build_object('id', id, 'code', code, 'name', name, 'level2', level2, 'level3', level3, 'amount', presentation_amount)
    ) FILTER (WHERE level1 = 'BIAYA LAINNYA' AND (debit <> 0 OR credit <> 0)), '[]'::jsonb)
  INTO
    v_gross_sales,
    v_sales_deductions,
    v_total_cogs,
    v_total_operating_expenses,
    v_total_other_income,
    v_total_other_expenses,
    v_sales_items,
    v_deduction_items,
    v_cogs_items,
    v_expense_items,
    v_other_income_items,
    v_other_expense_items
  FROM pnl_lines;

  v_net_revenue := v_gross_sales + v_sales_deductions; -- deduction bernilai negatif
  v_gross_profit := v_net_revenue - v_total_cogs;
  v_operating_profit := v_gross_profit - v_total_operating_expenses;
  v_net_income := v_operating_profit + v_total_other_income - v_total_other_expenses;

  RETURN jsonb_build_object(
    'companyId', p_company_id,
    'dateFrom', v_date_from,
    'dateTo', v_date_to,
    'grossSales', v_gross_sales,
    'salesDeductions', v_sales_deductions,
    'netRevenue', v_net_revenue,
    'totalCogs', v_total_cogs,
    'grossProfit', v_gross_profit,
    'totalOperatingExpenses', v_total_operating_expenses,
    'operatingProfit', v_operating_profit,
    'totalOtherIncome', v_total_other_income,
    'totalOtherExpenses', v_total_other_expenses,
    'netIncome', v_net_income,
    'grossProfitMargin', CASE WHEN v_net_revenue <> 0 THEN round((v_gross_profit / v_net_revenue)::numeric * 100, 2) ELSE 0 END,
    'netProfitMargin', CASE WHEN v_net_revenue <> 0 THEN round((v_net_income / v_net_revenue)::numeric * 100, 2) ELSE 0 END,
    'sections', jsonb_build_object(
      'sales', v_sales_items,
      'salesDeductions', v_deduction_items,
      'cogs', v_cogs_items,
      'operatingExpenses', v_expense_items,
      'otherIncome', v_other_income_items,
      'otherExpenses', v_other_expense_items
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_public_active_companies()
 RETURNS TABLE(id uuid, code text, name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
BEGIN
  PERFORM tenant_private.assert_mis_actor();
  RETURN QUERY
SELECT c.id, c.code, c.name FROM public.company c
  WHERE c.is_active AND tenant_private.has_workspace_access('mis')
    AND c.id IN (SELECT public.get_user_company_ids((SELECT auth.uid())))
  ORDER BY c.name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_sales_fulfillment_summary(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_summary jsonb;
BEGIN
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  PERFORM tenant_private.assert_mis_company_access(p_company_id, NULL);
  WITH po_details AS (
    SELECT
      po.id,
      po.document_number as po_number,
      po.transaction_date as order_date,
      po.counterparty_id as customer_id,
      c.name as customer_name,
      po.total_amount,
      coalesce(po.data->>'targetDeliveryDate', null) as target_delivery_date,
      coalesce(po.data->>'poStatus', 'open') as po_status,
      coalesce(po.data->>'deliveryStatus', 'unshipped') as delivery_status,
      coalesce(sum(pol.quantity), 0) as total_ordered_qty,
      coalesce((
        SELECT sum(bdl.quantity)
        FROM public.business_document_line bdl
        JOIN public.business_document bd ON bdl.document_id = bd.id
        WHERE bd.source_document_id = po.id
          AND bd.status = 'posted'
          AND bdl.is_current = true
      ), 0) as total_delivered_qty,
      coalesce((
        SELECT jsonb_agg(
          jsonb_build_object(
            'invoiceId', bd.id,
            'invoiceNumber', bd.document_number,
            'invoiceDate', bd.transaction_date,
            'totalAmount', bd.total_amount,
            'paidAmount', bd.paid_amount,
            'status', bd.status
          )
        )
        FROM public.business_document bd
        WHERE bd.source_document_id = po.id
          AND bd.status = 'posted'
      ), '[]'::jsonb) as invoice_history,
      coalesce((
        SELECT jsonb_agg(
          jsonb_build_object(
            'lineId', pol.id,
            'itemId', pol.item_id,
            'productName', p.name,
            'sku', p.sku,
            'orderedQty', pol.quantity,
            'unitPrice', pol.unit_price,
            'unitCode', pol.unit_code,
            'deliveredQty', coalesce((
              SELECT sum(bdl.quantity)
              FROM public.business_document_line bdl
              JOIN public.business_document bd ON bdl.document_id = bd.id
              WHERE bd.source_document_id = po.id
                AND bd.status = 'posted'
                AND bdl.item_id = pol.item_id
                AND bdl.is_current = true
            ), 0),
            'remainingQty', pol.quantity - coalesce((
              SELECT sum(bdl.quantity)
              FROM public.business_document_line bdl
              JOIN public.business_document bd ON bdl.document_id = bd.id
              WHERE bd.source_document_id = po.id
                AND bd.status = 'posted'
                AND bdl.item_id = pol.item_id
                AND bdl.is_current = true
            ), 0)
          )
        )
        FROM public.business_document_line pol
        JOIN public.master_record p ON pol.item_id = p.id
        WHERE pol.document_id = po.id AND pol.is_current = true
      ), '[]'::jsonb) as lines
    FROM public.business_document po
    JOIN public.master_record c ON po.counterparty_id = c.id
    LEFT JOIN public.business_document_line pol ON pol.document_id = po.id AND pol.is_current = true
    WHERE po.company_id = p_company_id
      AND po.document_kind = 'customer_po'
      AND po.status <> 'void'
    GROUP BY po.id, po.document_number, po.transaction_date, po.counterparty_id, c.name, po.total_amount, po.data
    ORDER BY po.transaction_date DESC, po.document_number DESC
  )
  SELECT jsonb_build_object(
    'totalOrders', coalesce(count(*), 0),
    'totalOrderedQty', coalesce(sum(total_ordered_qty), 0),
    'totalDeliveredQty', coalesce(sum(total_delivered_qty), 0),
    'totalRemainingQty', coalesce(sum(total_ordered_qty - total_delivered_qty), 0),
    'totalOrderAmount', coalesce(sum(total_amount), 0),
    'items', coalesce(jsonb_agg(
      jsonb_build_object(
        'id', id,
        'poNumber', po_number,
        'orderDate', order_date,
        'customerId', customer_id,
        'customerName', customer_name,
        'targetDeliveryDate', target_delivery_date,
        'poStatus', po_status,
        'deliveryStatus', CASE
          WHEN total_delivered_qty >= total_ordered_qty AND total_ordered_qty > 0 THEN 'full_delivery'
          WHEN total_delivered_qty > 0 THEN 'partial_delivery'
          ELSE 'unshipped'
        END,
        'totalOrderedQty', total_ordered_qty,
        'totalDeliveredQty', total_delivered_qty,
        'remainingQty', greatest(0, total_ordered_qty - total_delivered_qty),
        'totalAmount', total_amount,
        'fulfillmentRate', CASE
          WHEN total_ordered_qty > 0 THEN round((total_delivered_qty / total_ordered_qty) * 100, 1)
          ELSE 0
        END,
        'lines', lines,
        'invoiceHistory', invoice_history
      )
    ), '[]'::jsonb)
  ) INTO v_summary
  FROM po_details;

  RETURN coalesce(v_summary, jsonb_build_object(
    'totalOrders', 0,
    'totalOrderedQty', 0,
    'totalDeliveredQty', 0,
    'totalRemainingQty', 0,
    'totalOrderAmount', 0,
    'items', '[]'::jsonb
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_trial_balance(p_company_id uuid, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_date_from date;
  v_date_to date;
  v_company_exists boolean;
  v_accounts jsonb;
  v_summary jsonb;
  v_total_opening_debit numeric := 0;
  v_total_opening_credit numeric := 0;
  v_total_period_debit numeric := 0;
  v_total_period_credit numeric := 0;
  v_total_closing_debit numeric := 0;
  v_total_closing_credit numeric := 0;
BEGIN
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  PERFORM tenant_private.assert_mis_company_access(p_company_id, NULL);
  -- Validasi Perusahaan
  SELECT EXISTS (SELECT 1 FROM public.company WHERE id = p_company_id) INTO v_company_exists;
  IF NOT v_company_exists THEN
    RAISE EXCEPTION 'Perusahaan dengan ID % tidak ditemukan.', p_company_id;
  END IF;

  v_date_to := coalesce(p_date_to, (now() AT TIME ZONE 'Asia/Jakarta')::date);
  v_date_from := coalesce(p_date_from, (date_trunc('month', v_date_to))::date);

  WITH account_movements AS (
    SELECT
      la.id,
      la.code,
      la.name,
      la.level1,
      la.level2,
      la.level3,
      la.account_type,
      la.normal_balance,
      la.report_sign,
      coalesce(sum(jl.debit) FILTER (WHERE je.transaction_date < v_date_from), 0) AS opening_raw_debit,
      coalesce(sum(jl.credit) FILTER (WHERE je.transaction_date < v_date_from), 0) AS opening_raw_credit,
      coalesce(sum(jl.debit) FILTER (WHERE je.transaction_date >= v_date_from AND je.transaction_date <= v_date_to), 0) AS period_raw_debit,
      coalesce(sum(jl.credit) FILTER (WHERE je.transaction_date >= v_date_from AND je.transaction_date <= v_date_to), 0) AS period_raw_credit,
      coalesce(sum(jl.debit) FILTER (WHERE je.transaction_date <= v_date_to), 0) AS closing_raw_debit,
      coalesce(sum(jl.credit) FILTER (WHERE je.transaction_date <= v_date_to), 0) AS closing_raw_credit
    FROM public.ledger_account la
    LEFT JOIN public.journal_line jl ON jl.account_id = la.id AND jl.company_id = la.company_id
    LEFT JOIN public.journal_entry je ON je.id = jl.journal_entry_id AND je.company_id = jl.company_id AND je.status = 'posted'
    WHERE la.company_id = p_company_id
    GROUP BY la.id, la.code, la.name, la.level1, la.level2, la.level3, la.account_type, la.normal_balance, la.report_sign
  ),
  calculated AS (
    SELECT
      id,
      code,
      name,
      level1,
      level2,
      level3,
      account_type,
      normal_balance,
      report_sign,
      opening_raw_debit,
      opening_raw_credit,
      (opening_raw_debit - opening_raw_credit) AS opening_balance,
      GREATEST(opening_raw_debit - opening_raw_credit, 0) AS trial_opening_debit,
      GREATEST(opening_raw_credit - opening_raw_debit, 0) AS trial_opening_credit,
      period_raw_debit AS trial_movement_debit,
      period_raw_credit AS trial_movement_credit,
      (period_raw_debit - period_raw_credit) AS period_movement,
      closing_raw_debit,
      closing_raw_credit,
      (closing_raw_debit - closing_raw_credit) AS closing_balance,
      GREATEST(closing_raw_debit - closing_raw_credit, 0) AS trial_closing_debit,
      GREATEST(closing_raw_credit - closing_raw_debit, 0) AS trial_closing_credit
    FROM account_movements
  )
  SELECT
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'code', code,
        'name', name,
        'level1', level1,
        'level2', level2,
        'level3', level3,
        'accountType', account_type,
        'normalBalance', normal_balance,
        'reportSign', report_sign,
        'openingDebit', trial_opening_debit,
        'openingCredit', trial_opening_credit,
        'periodDebit', trial_movement_debit,
        'periodCredit', trial_movement_credit,
        'closingDebit', trial_closing_debit,
        'closingCredit', trial_closing_credit,
        'openingBalance', opening_balance,
        'periodMovement', period_movement,
        'closingBalance', closing_balance
      ) ORDER BY code ASC
    ),
    coalesce(sum(trial_opening_debit), 0),
    coalesce(sum(trial_opening_credit), 0),
    coalesce(sum(trial_movement_debit), 0),
    coalesce(sum(trial_movement_credit), 0),
    coalesce(sum(trial_closing_debit), 0),
    coalesce(sum(trial_closing_credit), 0)
  INTO
    v_accounts,
    v_total_opening_debit,
    v_total_opening_credit,
    v_total_period_debit,
    v_total_period_credit,
    v_total_closing_debit,
    v_total_closing_credit
  FROM calculated;

  v_summary := jsonb_build_object(
    'totalOpeningDebit', v_total_opening_debit,
    'totalOpeningCredit', v_total_opening_credit,
    'totalPeriodDebit', v_total_period_debit,
    'totalPeriodCredit', v_total_period_credit,
    'totalClosingDebit', v_total_closing_debit,
    'totalClosingCredit', v_total_closing_credit,
    'difference', abs(v_total_closing_debit - v_total_closing_credit),
    'isBalanced', (v_total_closing_debit = v_total_closing_credit AND v_total_period_debit = v_total_period_credit)
  );

  RETURN jsonb_build_object(
    'companyId', p_company_id,
    'dateFrom', v_date_from,
    'dateTo', v_date_to,
    'isBalanced', (v_total_closing_debit = v_total_closing_credit AND v_total_period_debit = v_total_period_credit),
    'difference', abs(v_total_closing_debit - v_total_closing_credit),
    'summary', v_summary,
    'accounts', coalesce(v_accounts, '[]'::jsonb)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_user_company_ids(p_user_id uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT a.company_id FROM public.user_company_assignment a
  WHERE a.user_id = p_user_id AND a.is_active
    AND (tenant_private.is_platform_admin() OR (
      p_user_id = (SELECT auth.uid()) AND tenant_private.has_workspace_access('mis')
    )) AND tenant_private.development_company_allowed(a.company_id);
$function$;

CREATE OR REPLACE FUNCTION public.is_company_owner(p_company_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT (tenant_private.is_platform_admin() OR p_user_id = (SELECT auth.uid()))
    AND tenant_private.has_mis_company_access(p_company_id)
    AND EXISTS (SELECT 1 FROM public.user_company_assignment a
      WHERE a.company_id=p_company_id AND a.user_id=p_user_id
        AND a.is_active AND 'owner'=ANY(a.roles));
$function$;

CREATE OR REPLACE FUNCTION public.list_available_system_users()
 RETURNS TABLE(user_id uuid, email text, full_name text, username text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  PERFORM tenant_private.assert_mis_actor();
  IF NOT tenant_private.has_workspace_access('mis') OR NOT EXISTS (
    SELECT 1 FROM public.user_company_assignment uca
    WHERE uca.user_id = (SELECT auth.uid()) AND 'owner' = ANY(uca.roles) AND uca.is_active
  ) THEN
    RAISE EXCEPTION 'Akses ditolak: Hanya Owner MIS yang dapat melihat daftar pengguna.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT au.id, au.email::text,
    COALESCE(au.raw_user_meta_data->>'full_name', au.raw_user_meta_data->>'name',
      au.raw_user_meta_data->>'username', split_part(au.email, '@', 1))::text,
    COALESCE(au.raw_user_meta_data->>'username', split_part(au.email, '@', 1))::text
  FROM auth.users au WHERE tenant_private.can_inspect_mis_user(au.id) ORDER BY au.email;
END;
$function$;

CREATE OR REPLACE FUNCTION public.post_asset_disposal(p_company_id uuid, p_asset_id uuid, p_disposal_date date, p_proceeds bigint, p_cash_account_id uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  p_user_id := tenant_private.assert_mis_company_access(p_company_id, p_user_id);
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
$function$;

CREATE OR REPLACE FUNCTION public.post_asset_purchase(p_company_id uuid, p_document_id uuid, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  p_user_id := tenant_private.assert_mis_company_access(p_company_id, p_user_id);
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
$function$;

CREATE OR REPLACE FUNCTION public.post_cash_transfer(p_company_id uuid, p_source_cash_id uuid, p_destination_cash_id uuid, p_amount bigint, p_transfer_date date DEFAULT CURRENT_DATE, p_notes text DEFAULT NULL::text, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  p_user_id := tenant_private.assert_mis_company_access(p_company_id, p_user_id);
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
$function$;

CREATE OR REPLACE FUNCTION public.post_manual_journal(p_company_id uuid, p_transaction_date date, p_description text, p_lines jsonb, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  p_user_id := tenant_private.assert_mis_company_access(p_company_id, p_user_id);
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
$function$;

CREATE OR REPLACE FUNCTION public.post_monthly_depreciation(p_company_id uuid, p_period_month text, p_asset_ids jsonb, p_notes text DEFAULT NULL::text, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  p_user_id := tenant_private.assert_mis_company_access(p_company_id, p_user_id);
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
$function$;

CREATE OR REPLACE FUNCTION public.post_opening_balance(p_company_id uuid, p_balance_date date, p_notes text DEFAULT NULL::text, p_lines jsonb DEFAULT '[]'::jsonb, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  p_user_id := tenant_private.assert_mis_company_access(p_company_id, p_user_id);
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
$function$;

CREATE OR REPLACE FUNCTION public.post_operating_expense(p_company_id uuid, p_funding_method text, p_cash_account_id uuid DEFAULT NULL::uuid, p_supplier_id uuid DEFAULT NULL::uuid, p_expense_date date DEFAULT CURRENT_DATE, p_notes text DEFAULT NULL::text, p_lines jsonb DEFAULT '[]'::jsonb, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  p_user_id := tenant_private.assert_mis_company_access(p_company_id, p_user_id);
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
$function$;

CREATE OR REPLACE FUNCTION public.post_prepaid_amortization(p_company_id uuid, p_prepaid_id uuid, p_period_month text, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  p_user_id := tenant_private.assert_mis_company_access(p_company_id, p_user_id);
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
$function$;

CREATE OR REPLACE FUNCTION public.post_purchase_document(p_document_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_doc RECORD;
  v_line RECORD;
  v_counterparty RECORD;
  v_period_id uuid;
  v_seq_key text;
  v_prefix text;
  v_seq_number bigint;
  v_doc_number text;
  v_total_amount bigint := 0;
  v_funding_method text;
  v_cash_account_id uuid;
  v_cash_account RECORD;
  v_journal_id uuid;
  v_journal_seq_key text;
  v_journal_seq_num bigint;
  v_journal_number text;
  v_inventory_account_id uuid;
  v_ap_account_id uuid;
  v_cash_ledger_account_id uuid;
  v_operating_expense_id uuid;
  v_base_qty numeric(18, 4);
  v_unit_cost bigint;
  v_unit_idx integer;
  v_phys_code text;
  v_journal_line_num integer := 1;
BEGIN
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  p_user_id := tenant_private.assert_mis_company_access((SELECT d.company_id FROM public.business_document d WHERE d.id=p_document_id), p_user_id);
  -- 1. Validasi Keberadaan Dokumen & Lock baris
  SELECT * INTO v_doc
  FROM public.business_document
  WHERE id = p_document_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dokumen pembelian dengan ID % tidak ditemukan.', p_document_id;
  END IF;

  IF v_doc.status <> 'draft' THEN
    RAISE EXCEPTION 'Hanya dokumen berstatus draft yang dapat diposting. Status saat ini: %', v_doc.status;
  END IF;

  IF v_doc.document_kind NOT IN ('purchase_material', 'purchase_supplies', 'purchase_non_production') THEN
    RAISE EXCEPTION 'Jenis dokumen % tidak didukung oleh fungsi post_purchase_document.', v_doc.document_kind;
  END IF;

  -- 2. Validasi Pemasok (Counterparty)
  IF v_doc.counterparty_id IS NULL THEN
    RAISE EXCEPTION 'Pemasok wajib dipilih sebelum memposting dokumen pembelian.';
  END IF;

  SELECT * INTO v_counterparty
  FROM public.master_record
  WHERE id = v_doc.counterparty_id AND company_id = v_doc.company_id AND record_kind = 'supplier' AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pemasok tidak ditemukan atau tidak aktif.';
  END IF;

  -- 3. Validasi Baris Dokumen (Minimal 1 baris aktif)
  IF NOT EXISTS (
    SELECT 1 FROM public.business_document_line
    WHERE document_id = v_doc.id AND is_current = true
  ) THEN
    RAISE EXCEPTION 'Dokumen pembelian wajib memiliki minimal satu baris item.';
  END IF;

  -- 4. Validasi Periode Akuntansi
  SELECT id INTO v_period_id
  FROM public.accounting_period
  WHERE company_id = v_doc.company_id
    AND v_doc.transaction_date >= start_date
    AND v_doc.transaction_date <= end_date
    AND status = 'open';

  IF v_period_id IS NULL THEN
    RAISE EXCEPTION 'Tanggal transaksi % tidak berada di dalam periode akuntansi yang terbuka.', v_doc.transaction_date;
  END IF;

  -- 5. Hitung Ulang Total Nilai dari Baris
  SELECT coalesce(sum(total_amount), 0) INTO v_total_amount
  FROM public.business_document_line
  WHERE document_id = v_doc.id AND is_current = true;

  IF v_total_amount <= 0 THEN
    RAISE EXCEPTION 'Total nilai pembelian harus lebih dari nol (saat ini: %).', v_total_amount;
  END IF;

  UPDATE public.business_document
  SET total_amount = v_total_amount,
      updated_at = now()
  WHERE id = v_doc.id;

  -- 6. Penomoran Dokumen Atomik (Sequence Perusahaan & Tanggal)
  IF v_doc.document_kind = 'purchase_material' THEN
    v_prefix := 'BL-' || to_char(v_doc.transaction_date, 'YYMMDD') || '-';
  ELSIF v_doc.document_kind = 'purchase_supplies' THEN
    v_prefix := 'BP-' || to_char(v_doc.transaction_date, 'YYMMDD') || '-';
  ELSE
    v_prefix := 'BN-' || to_char(v_doc.transaction_date, 'YYMMDD') || '-';
  END IF;

  v_seq_key := v_doc.document_kind || '-' || to_char(v_doc.transaction_date, 'YYMMDD');

  INSERT INTO public.document_sequence (
    company_id, sequence_key, prefix, padding, current_number, current_value, updated_at
  ) VALUES (
    v_doc.company_id, v_seq_key, v_prefix, 3, 1, 1, now()
  )
  ON CONFLICT (company_id, sequence_key)
  DO UPDATE SET
    current_number = public.document_sequence.current_number + 1,
    current_value = public.document_sequence.current_value + 1,
    updated_at = now()
  RETURNING current_number INTO v_seq_number;

  v_doc_number := v_prefix || lpad(v_seq_number::text, 3, '0');

  -- 7. Efek Inventaris Perpetual & Unit Fisik (Roll)
  FOR v_line IN
    SELECT * FROM public.business_document_line
    WHERE document_id = v_doc.id AND is_current = true
    ORDER BY line_number ASC
  LOOP
    IF v_line.quantity <= 0 OR v_line.unit_price < 0 THEN
      RAISE EXCEPTION 'Baris item nomor % memiliki kuantitas atau harga tidak valid.', v_line.line_number;
    END IF;

    v_base_qty := v_line.quantity * coalesce(nullif(v_line.conversion_factor, 0), 1);
    v_unit_cost := CASE WHEN v_base_qty > 0 THEN round(v_line.total_amount / v_base_qty) ELSE 0 END;

    IF v_doc.document_kind = 'purchase_material' THEN
      IF v_line.item_id IS NULL THEN
        RAISE EXCEPTION 'Material wajib dipilih pada baris %.', v_line.line_number;
      END IF;

      -- Catat mutasi persediaan bahan baku
      INSERT INTO public.inventory_movement (
        company_id, item_id, inventory_state, movement_type, lot_code,
        quantity, unit_cost, total_cost, transaction_date, business_date,
        source_document_id, source_line_id, receipt_snapshot, posted_at, created_at
      ) VALUES (
        v_doc.company_id, v_line.item_id, 'material', 'purchase_receipt', v_line.data->>'lotCode',
        v_base_qty, v_unit_cost, v_line.total_amount, v_doc.transaction_date, v_doc.transaction_date,
        v_doc.id, v_line.id,
        jsonb_build_object('purchaseNumber', v_doc_number, 'supplierId', v_doc.counterparty_id, 'supplierName', v_counterparty.name),
        now(), now()
      );

      -- Efek Roll / Unit Fisik jika integer packaging quantity
      IF v_line.conversion_factor > 0 AND (v_line.quantity = floor(v_line.quantity)) AND v_line.quantity > 0 THEN
        FOR v_unit_idx IN 1..v_line.quantity::integer LOOP
          v_phys_code := v_doc_number || '-L' || v_line.line_number || '-' || lpad(v_unit_idx::text, 3, '0');
          INSERT INTO public.production_material_unit (
            company_id, material_id, source_document_id, source_line_id,
            receipt_cycle, physical_code,
            packaging_unit_code,
            stock_unit_code,
            initial_base_quantity,
            status, created_at
          ) VALUES (
            v_doc.company_id, v_line.item_id, v_doc.id, v_line.id,
            1, v_phys_code,
            coalesce(v_line.data->>'packagingUnitCode', v_line.unit_code, 'roll'),
            coalesce(v_line.data->>'stockUnitCode', v_line.unit_code, 'm'),
            v_line.conversion_factor,
            'available', now()
          );
        END LOOP;
      END IF;

    ELSIF v_doc.document_kind = 'purchase_supplies' THEN
      IF v_line.item_id IS NULL THEN
        RAISE EXCEPTION 'Item perlengkapan wajib dipilih pada baris %.', v_line.line_number;
      END IF;

      -- Catat mutasi persediaan perlengkapan produksi
      INSERT INTO public.inventory_movement (
        company_id, item_id, inventory_state, movement_type, lot_code,
        quantity, unit_cost, total_cost, transaction_date, business_date,
        source_document_id, source_line_id, receipt_snapshot, posted_at, created_at
      ) VALUES (
        v_doc.company_id, v_line.item_id, 'production_supplies', 'purchase_receipt', v_line.data->>'lotCode',
        v_base_qty, v_unit_cost, v_line.total_amount, v_doc.transaction_date, v_doc.transaction_date,
        v_doc.id, v_line.id,
        jsonb_build_object('purchaseNumber', v_doc_number, 'supplierId', v_doc.counterparty_id, 'supplierName', v_counterparty.name),
        now(), now()
      );
    END IF;
  END LOOP;

  -- 8. Efek Keuangan: Pendanaan Hutang (Payable) vs Kas/Bank (Cash)
  v_funding_method := coalesce(v_doc.data->>'fundingMethod', 'payable');

  IF v_funding_method = 'payable' THEN
    -- Entri Subledger Hutang Pemasok (AP)
    INSERT INTO public.subledger_entry (
      company_id, subledger_kind, subledger_type, counterparty_id,
      source_document_id, transaction_date, amount, credit_amount,
      remaining_balance, status, posted_at, created_at
    ) VALUES (
      v_doc.company_id, 'supplier_payable', 'supplier_payable', v_doc.counterparty_id,
      v_doc.id, v_doc.transaction_date, v_total_amount, v_total_amount,
      v_total_amount, 'open', now(), now()
    );

    UPDATE public.business_document
    SET paid_amount = 0
    WHERE id = v_doc.id;

  ELSIF v_funding_method = 'cash' THEN
    v_cash_account_id := (v_doc.data->>'cashAccountId')::uuid;
    IF v_cash_account_id IS NULL THEN
      RAISE EXCEPTION 'Akun Kas/Bank wajib dipilih untuk pembelian dengan metode tunai.';
    END IF;

    SELECT * INTO v_cash_account
    FROM public.master_record
    WHERE id = v_cash_account_id AND company_id = v_doc.company_id AND record_kind = 'cash_account' AND is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Akun Kas/Bank dengan ID % tidak ditemukan atau tidak aktif.', v_cash_account_id;
    END IF;

    -- Catat pengeluaran kas (cash_movement)
    INSERT INTO public.cash_movement (
      company_id, cash_account_id, movement_type, transaction_date,
      amount, source_document_id, notes, posted_at, created_at
    ) VALUES (
      v_doc.company_id, v_cash_account_id, 'expense', v_doc.transaction_date,
      v_total_amount, v_doc.id, 'Pembayaran tunai pembelian ' || v_doc_number, now(), now()
    );

    UPDATE public.business_document
    SET paid_amount = v_total_amount
    WHERE id = v_doc.id;
  ELSE
    RAISE EXCEPTION 'Metode pembayaran % tidak valid.', v_funding_method;
  END IF;

  -- 9. Efek Jurnal Umum Berimbang (General Journal Entry & Lines)
  -- Ambil pemetaan COA
  SELECT account_id INTO v_inventory_account_id
  FROM public.accounting_mapping
  WHERE company_id = v_doc.company_id AND mapping_key = 'material_inventory';

  SELECT account_id INTO v_ap_account_id
  FROM public.accounting_mapping
  WHERE company_id = v_doc.company_id AND mapping_key = 'supplier_payable';

  SELECT account_id INTO v_operating_expense_id
  FROM public.accounting_mapping
  WHERE company_id = v_doc.company_id AND mapping_key = 'operating_expense';

  IF v_funding_method = 'cash' THEN
    v_cash_ledger_account_id := v_cash_account.ledger_account_id;
    IF v_cash_ledger_account_id IS NULL THEN
      SELECT account_id INTO v_cash_ledger_account_id
      FROM public.accounting_mapping
      WHERE company_id = v_doc.company_id AND mapping_key = 'cash';
    END IF;
  END IF;

  -- Nomor Jurnal Berurutan JU-YYMMDD-###
  v_journal_seq_key := 'journal-' || to_char(v_doc.transaction_date, 'YYMMDD');
  INSERT INTO public.document_sequence (
    company_id, sequence_key, prefix, padding, current_number, current_value, updated_at
  ) VALUES (
    v_doc.company_id, v_journal_seq_key, 'JU-' || to_char(v_doc.transaction_date, 'YYMMDD') || '-', 3, 1, 1, now()
  )
  ON CONFLICT (company_id, sequence_key)
  DO UPDATE SET
    current_number = public.document_sequence.current_number + 1,
    current_value = public.document_sequence.current_value + 1,
    updated_at = now()
  RETURNING current_number INTO v_journal_seq_num;

  v_journal_number := 'JU-' || to_char(v_doc.transaction_date, 'YYMMDD') || '-' || lpad(v_journal_seq_num::text, 3, '0');

  INSERT INTO public.journal_entry (
    company_id, entry_number, period_id, source_document_id,
    transaction_date, entry_type, memo, description, status, posted_at, created_at
  ) VALUES (
    v_doc.company_id, v_journal_number, v_period_id, v_doc.id,
    v_doc.transaction_date, 'purchase', 'Pembelian ' || v_doc_number,
    'Jurnal transaksi pembelian ' || v_doc_number, 'posted', now(), now()
  ) RETURNING id INTO v_journal_id;

  -- Baris Jurnal Sisi Debit
  IF v_doc.document_kind = 'purchase_material' THEN
    INSERT INTO public.journal_line (
      company_id, journal_entry_id, line_number, account_id,
      debit_amount, credit_amount, debit, credit, description
    ) VALUES (
      v_doc.company_id, v_journal_id, v_journal_line_num, coalesce(v_inventory_account_id, '3e2d382e-0ab8-4274-bdbb-0aa9c764e6a5'::uuid),
      v_total_amount, 0, v_total_amount, 0, 'Persediaan Bahan Baku (' || v_doc_number || ')'
    );
    v_journal_line_num := v_journal_line_num + 1;

  ELSIF v_doc.document_kind = 'purchase_supplies' THEN
    INSERT INTO public.journal_line (
      company_id, journal_entry_id, line_number, account_id,
      debit_amount, credit_amount, debit, credit, description
    ) VALUES (
      v_doc.company_id, v_journal_id, v_journal_line_num, coalesce(v_inventory_account_id, '3e2d382e-0ab8-4274-bdbb-0aa9c764e6a5'::uuid),
      v_total_amount, 0, v_total_amount, 0, 'Persediaan Perlengkapan Pabrik (' || v_doc_number || ')'
    );
    v_journal_line_num := v_journal_line_num + 1;

  ELSE -- purchase_non_production
    FOR v_line IN
      SELECT * FROM public.business_document_line
      WHERE document_id = v_doc.id AND is_current = true
      ORDER BY line_number ASC
    LOOP
      INSERT INTO public.journal_line (
        company_id, journal_entry_id, line_number, account_id,
        debit_amount, credit_amount, debit, credit, description
      ) VALUES (
        v_doc.company_id, v_journal_id, v_journal_line_num, coalesce(v_line.account_id, v_operating_expense_id, 'abb4441c-b8bc-45ae-ad85-876c8dec614f'::uuid),
        v_line.total_amount, 0, v_line.total_amount, 0, coalesce(nullif(v_line.description, ''), 'Beban Non-Produksi')
      );
      v_journal_line_num := v_journal_line_num + 1;
    END LOOP;
  END IF;

  -- Baris Jurnal Sisi Kredit
  IF v_funding_method = 'payable' THEN
    INSERT INTO public.journal_line (
      company_id, journal_entry_id, line_number, account_id,
      debit_amount, credit_amount, debit, credit, description,
      subledger_type, subledger_id
    ) VALUES (
      v_doc.company_id, v_journal_id, v_journal_line_num, coalesce(v_ap_account_id, 'a7a9dd3f-18e8-464a-b470-f51cf8e14fea'::uuid),
      0, v_total_amount, 0, v_total_amount, 'Hutang Usaha Pemasok ' || v_counterparty.name,
      'supplier_payable', v_doc.counterparty_id
    );
  ELSE
    INSERT INTO public.journal_line (
      company_id, journal_entry_id, line_number, account_id,
      debit_amount, credit_amount, debit, credit, description
    ) VALUES (
      v_doc.company_id, v_journal_id, v_journal_line_num, coalesce(v_cash_ledger_account_id, 'e747323d-b929-4012-bc34-944245f6e9a4'::uuid),
      0, v_total_amount, 0, v_total_amount, 'Kas/Bank Pembelian ' || v_doc_number
    );
  END IF;

  -- 10. Update Status Dokumen Menjadi Posted
  UPDATE public.business_document
  SET status = 'posted',
      document_number = v_doc_number,
      posted_at = now(),
      posted_by_user_id = p_user_id::text,
      updated_at = now()
  WHERE id = v_doc.id;

  -- 11. Pencatatan Jejak Audit (Audit Log)
  INSERT INTO public.audit_log (
    company_id, user_id, actor_user_id, action, target_type, target_id, details, created_at
  ) VALUES (
    v_doc.company_id, p_user_id::text, p_user_id::text, 'document.post', 'business_document', v_doc.id::text,
    jsonb_build_object(
      'documentNumber', v_doc_number,
      'documentKind', v_doc.document_kind,
      'totalAmount', v_total_amount,
      'fundingMethod', v_funding_method
    ),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'documentId', v_doc.id,
    'documentNumber', v_doc_number,
    'status', 'posted',
    'totalAmount', v_total_amount
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.post_purchase_payment(p_purchase_id uuid, p_cash_account_id uuid, p_amount bigint, p_date date, p_notes text, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_purchase RECORD;
  v_subledger RECORD;
  v_cash_account RECORD;
  v_period_id uuid;
  v_payment_seq_key text;
  v_payment_seq_num bigint;
  v_payment_number text;
  v_payment_doc_id uuid;
  v_new_remaining_balance bigint;
  v_ap_account_id uuid;
  v_cash_ledger_account_id uuid;
  v_journal_seq_key text;
  v_journal_seq_num bigint;
  v_journal_number text;
  v_journal_id uuid;
BEGIN
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  p_user_id := tenant_private.assert_mis_company_access((SELECT d.company_id FROM public.business_document d WHERE d.id=p_purchase_id), p_user_id);
  -- 1. Validasi Dokumen Pembelian
  SELECT * INTO v_purchase
  FROM public.business_document
  WHERE id = p_purchase_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dokumen pembelian dengan ID % tidak ditemukan.', p_purchase_id;
  END IF;

  IF v_purchase.status <> 'posted' THEN
    RAISE EXCEPTION 'Pembayaran hanya dapat dilakukan untuk pembelian berstatus posted.';
  END IF;

  -- 2. Validasi Subledger Hutang Pemasok (AP)
  SELECT * INTO v_subledger
  FROM public.subledger_entry
  WHERE source_document_id = v_purchase.id
    AND subledger_kind = 'supplier_payable'
    AND status = 'open'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tidak ada sisa hutang terbuka untuk dokumen pembelian %.', v_purchase.document_number;
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Jumlah pembayaran harus lebih dari 0.';
  END IF;

  IF p_amount > v_subledger.remaining_balance THEN
    RAISE EXCEPTION 'Jumlah pembayaran (Rp %) melebihi sisa hutang (Rp %).', p_amount, v_subledger.remaining_balance;
  END IF;

  -- 3. Validasi Akun Kas/Bank
  SELECT * INTO v_cash_account
  FROM public.master_record
  WHERE id = p_cash_account_id AND company_id = v_purchase.company_id AND record_kind = 'cash_account' AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Akun Kas/Bank dengan ID % tidak valid atau tidak aktif.', p_cash_account_id;
  END IF;

  -- 4. Validasi Periode Akuntansi
  SELECT id INTO v_period_id
  FROM public.accounting_period
  WHERE company_id = v_purchase.company_id
    AND p_date >= start_date
    AND p_date <= end_date
    AND status = 'open';

  IF v_period_id IS NULL THEN
    RAISE EXCEPTION 'Tanggal pembayaran % berada di luar periode akuntansi yang terbuka.', p_date;
  END IF;

  -- 5. Penomoran Dokumen Pembayaran Kas Keluar KK-YYMMDD-###
  v_payment_seq_key := 'payment_kk-' || to_char(p_date, 'YYMMDD');
  INSERT INTO public.document_sequence (
    company_id, sequence_key, prefix, padding, current_number, current_value, updated_at
  ) VALUES (
    v_purchase.company_id, v_payment_seq_key, 'KK-' || to_char(p_date, 'YYMMDD') || '-', 3, 1, 1, now()
  )
  ON CONFLICT (company_id, sequence_key)
  DO UPDATE SET
    current_number = public.document_sequence.current_number + 1,
    current_value = public.document_sequence.current_value + 1,
    updated_at = now()
  RETURNING current_number INTO v_payment_seq_num;

  v_payment_number := 'KK-' || to_char(p_date, 'YYMMDD') || '-' || lpad(v_payment_seq_num::text, 3, '0');

  -- 6. Update Sisa Hutang pada Subledger AP dan Dokumen Pembelian
  v_new_remaining_balance := v_subledger.remaining_balance - p_amount;

  UPDATE public.subledger_entry
  SET remaining_balance = v_new_remaining_balance,
      debit_amount = debit_amount + p_amount,
      status = CASE WHEN v_new_remaining_balance = 0 THEN 'closed' ELSE 'open' END
  WHERE id = v_subledger.id;

  UPDATE public.business_document
  SET paid_amount = paid_amount + p_amount,
      updated_at = now()
  WHERE id = v_purchase.id;

  -- 7. Catat Dokumen Transaksi Pembayaran
  INSERT INTO public.business_document (
    company_id, document_kind, document_number, status, transaction_date,
    counterparty_id, source_document_id, total_amount, paid_amount,
    data, posted_at, posted_by_user_id, created_at, updated_at
  ) VALUES (
    v_purchase.company_id, 'purchase_payment', v_payment_number, 'posted', p_date,
    v_purchase.counterparty_id, v_purchase.id, p_amount, p_amount,
    jsonb_build_object(
      'cashAccountId', p_cash_account_id,
      'cashAccountName', v_cash_account.name,
      'purchaseDocumentNumber', v_purchase.document_number,
      'notes', p_notes
    ),
    now(), p_user_id::text, now(), now()
  ) RETURNING id INTO v_payment_doc_id;

  -- 8. Catat Pengeluaran Kas (cash_movement)
  INSERT INTO public.cash_movement (
    company_id, cash_account_id, movement_type, transaction_date,
    amount, source_document_id, reference_document_id, notes, posted_at, created_at
  ) VALUES (
    v_purchase.company_id, p_cash_account_id, 'expense', p_date,
    p_amount, v_payment_doc_id, v_purchase.id,
    coalesce(p_notes, 'Pembayaran hutang pembelian ' || v_purchase.document_number),
    now(), now()
  );

  -- 9. Jurnal Pembayaran Hutang: Debit Hutang Usaha, Kredit Kas/Bank
  SELECT account_id INTO v_ap_account_id
  FROM public.accounting_mapping
  WHERE company_id = v_purchase.company_id AND mapping_key = 'supplier_payable';

  v_cash_ledger_account_id := v_cash_account.ledger_account_id;
  IF v_cash_ledger_account_id IS NULL THEN
    SELECT account_id INTO v_cash_ledger_account_id
    FROM public.accounting_mapping
    WHERE company_id = v_purchase.company_id AND mapping_key = 'cash';
  END IF;

  v_journal_seq_key := 'journal-' || to_char(p_date, 'YYMMDD');
  INSERT INTO public.document_sequence (
    company_id, sequence_key, prefix, padding, current_number, current_value, updated_at
  ) VALUES (
    v_purchase.company_id, v_journal_seq_key, 'JU-' || to_char(p_date, 'YYMMDD') || '-', 3, 1, 1, now()
  )
  ON CONFLICT (company_id, sequence_key)
  DO UPDATE SET
    current_number = public.document_sequence.current_number + 1,
    current_value = public.document_sequence.current_value + 1,
    updated_at = now()
  RETURNING current_number INTO v_journal_seq_num;

  v_journal_number := 'JU-' || to_char(p_date, 'YYMMDD') || '-' || lpad(v_journal_seq_num::text, 3, '0');

  INSERT INTO public.journal_entry (
    company_id, entry_number, period_id, source_document_id,
    transaction_date, entry_type, memo, description, status, posted_at, created_at
  ) VALUES (
    v_purchase.company_id, v_journal_number, v_period_id, v_payment_doc_id,
    p_date, 'payment', 'Pembayaran Hutang ' || v_payment_number,
    'Jurnal pembayaran hutang pembelian ' || v_purchase.document_number, 'posted', now(), now()
  ) RETURNING id INTO v_journal_id;

  -- Debit: Hutang Usaha
  INSERT INTO public.journal_line (
    company_id, journal_entry_id, line_number, account_id,
    debit_amount, credit_amount, debit, credit, description,
    subledger_type, subledger_id
  ) VALUES (
    v_purchase.company_id, v_journal_id, 1, coalesce(v_ap_account_id, 'a7a9dd3f-18e8-464a-b470-f51cf8e14fea'::uuid),
    p_amount, 0, p_amount, 0, 'Pembayaran hutang ' || v_purchase.document_number,
    'supplier_payable', v_purchase.counterparty_id
  );

  -- Kredit: Kas/Bank
  INSERT INTO public.journal_line (
    company_id, journal_entry_id, line_number, account_id,
    debit_amount, credit_amount, debit, credit, description
  ) VALUES (
    v_purchase.company_id, v_journal_id, 2, coalesce(v_cash_ledger_account_id, 'e747323d-b929-4012-bc34-944245f6e9a4'::uuid),
    0, p_amount, 0, p_amount, 'Pengeluaran kas/bank ' || v_cash_account.name
  );

  -- 10. Jejak Audit
  INSERT INTO public.audit_log (
    company_id, user_id, actor_user_id, action, target_type, target_id, details, created_at
  ) VALUES (
    v_purchase.company_id, p_user_id::text, p_user_id::text, 'payment.create', 'business_document', v_payment_doc_id::text,
    jsonb_build_object(
      'paymentNumber', v_payment_number,
      'purchaseDocumentNumber', v_purchase.document_number,
      'amount', p_amount,
      'remainingBalance', v_new_remaining_balance
    ),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'paymentId', v_payment_doc_id,
    'paymentNumber', v_payment_number,
    'purchaseId', v_purchase.id,
    'purchaseNumber', v_purchase.document_number,
    'paidAmount', p_amount,
    'remainingBalance', v_new_remaining_balance
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.post_sales_invoice(p_document_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_doc RECORD;
  v_customer RECORD;
  v_po RECORD;
  v_line RECORD;
  v_period_id uuid;
  v_seq_key text;
  v_prefix text;
  v_seq_num bigint;
  v_doc_number text;
  v_total_amount bigint := 0;
  v_funding_method text;
  v_cash_account_id uuid;
  v_cash_account RECORD;
  v_cash_ledger_id uuid;
  v_ar_account_id uuid;
  v_revenue_account_id uuid;
  v_cogs_account_id uuid;
  v_finished_goods_account_id uuid;
  v_journal_id uuid;
  v_journal_seq_key text;
  v_journal_seq_num bigint;
  v_journal_number text;
  v_journal_line_num integer := 1;
  v_current_stock numeric(18, 4);
  v_current_stock_cost bigint;
  v_unit_cogs bigint;
  v_line_cogs bigint;
  v_total_cogs bigint := 0;
  v_po_total_qty numeric(18, 4) := 0;
  v_posted_total_qty numeric(18, 4) := 0;
  v_delivery_status text := 'unshipped';
  v_subledger_id uuid;
BEGIN
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  p_user_id := tenant_private.assert_mis_company_access((SELECT d.company_id FROM public.business_document d WHERE d.id=p_document_id), p_user_id);
  -- 1. Validasi & Lock Dokumen Faktur
  SELECT * INTO v_doc
  FROM public.business_document
  WHERE id = p_document_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Faktur penjualan dengan ID % tidak ditemukan.', p_document_id;
  END IF;

  IF v_doc.status <> 'draft' THEN
    RAISE EXCEPTION 'Hanya faktur berstatus draft yang dapat diposting. Status saat ini: %', v_doc.status;
  END IF;

  IF v_doc.document_kind NOT IN ('sales_invoice', 'sale') THEN
    RAISE EXCEPTION 'Jenis dokumen % tidak didukung untuk posting penjualan.', v_doc.document_kind;
  END IF;

  -- 2. Validasi Pelanggan Aktif
  SELECT * INTO v_customer
  FROM public.master_record
  WHERE id = v_doc.counterparty_id
    AND company_id = v_doc.company_id
    AND record_kind = 'customer'
    AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pelanggan faktur tidak ditemukan atau tidak aktif.';
  END IF;

  -- 3. Validasi Periode Akuntansi Terbuka
  SELECT id INTO v_period_id
  FROM public.accounting_period
  WHERE company_id = v_doc.company_id
    AND v_doc.transaction_date >= start_date
    AND v_doc.transaction_date <= end_date
    AND status = 'open';

  IF v_period_id IS NULL THEN
    RAISE EXCEPTION 'Tanggal transaksi % tidak berada di dalam periode akuntansi yang terbuka.', v_doc.transaction_date;
  END IF;

  -- 4. Validasi Baris Dokumen Minimal 1
  IF NOT EXISTS (
    SELECT 1 FROM public.business_document_line
    WHERE document_id = v_doc.id AND is_current = true
  ) THEN
    RAISE EXCEPTION 'Faktur penjualan wajib memiliki minimal satu baris produk.';
  END IF;

  -- 5. Jika bersumber dari PO, Lock PO & Validasi Ulang Sisa Kuantitas
  IF v_doc.source_document_id IS NOT NULL THEN
    SELECT * INTO v_po
    FROM public.business_document
    WHERE id = v_doc.source_document_id
    FOR UPDATE;

    FOR v_line IN
      SELECT * FROM public.business_document_line
      WHERE document_id = v_doc.id AND is_current = true
    LOOP
      DECLARE
        v_po_line_qty numeric(18, 4);
        v_prev_posted_qty numeric(18, 4);
        v_remaining_qty numeric(18, 4);
      BEGIN
        SELECT coalesce(sum(quantity), 0) INTO v_po_line_qty
        FROM public.business_document_line
        WHERE document_id = v_doc.source_document_id
          AND item_id = v_line.item_id
          AND is_current = true;

        SELECT coalesce(sum(bdl.quantity), 0) INTO v_prev_posted_qty
        FROM public.business_document_line bdl
        JOIN public.business_document bd ON bdl.document_id = bd.id
        WHERE bd.source_document_id = v_doc.source_document_id
          AND bd.status = 'posted'
          AND bd.id <> v_doc.id
          AND bdl.item_id = v_line.item_id
          AND bdl.is_current = true;

        v_remaining_qty := v_po_line_qty - v_prev_posted_qty;
        IF v_line.quantity > v_remaining_qty THEN
          RAISE EXCEPTION 'Kuantitas kirim produk (baris %) sebesar % melebihi sisa pesanan PO (%).',
            v_line.line_number, v_line.quantity, v_remaining_qty;
        END IF;
      END;
    END LOOP;
  END IF;

  -- 6. Hitung Total Nilai Faktur
  SELECT coalesce(sum(total_amount), 0) INTO v_total_amount
  FROM public.business_document_line
  WHERE document_id = v_doc.id AND is_current = true;

  IF v_total_amount <= 0 THEN
    RAISE EXCEPTION 'Total nilai faktur harus lebih besar dari nol.';
  END IF;

  -- 7. Penomoran Resmi Faktur Atomik: INV-YYYYMM-XXXX
  v_seq_key := 'INV-' || to_char(v_doc.transaction_date, 'YYYYMM');
  v_prefix := 'INV-' || to_char(v_doc.transaction_date, 'YYYYMM') || '-';

  INSERT INTO public.document_sequence (
    company_id, sequence_key, prefix, padding, current_number, current_value, updated_at
  ) VALUES (
    v_doc.company_id, v_seq_key, v_prefix, 4, 1, 1, now()
  )
  ON CONFLICT (company_id, sequence_key)
  DO UPDATE SET
    current_number = public.document_sequence.current_number + 1,
    current_value = public.document_sequence.current_value + 1,
    updated_at = now()
  RETURNING current_number INTO v_seq_num;

  v_doc_number := v_prefix || lpad(v_seq_num::text, 4, '0');

  -- 8. Efek Pengurangan Inventaris Barang Jadi (packed_finished_goods) & HPP (Moving Avg)
  FOR v_line IN
    SELECT * FROM public.business_document_line
    WHERE document_id = v_doc.id AND is_current = true
    ORDER BY line_number ASC
  LOOP
    -- Hitung saldo kuantitas dan total cost berjalan dari persediaan barang jadi
    SELECT coalesce(sum(quantity), 0), coalesce(sum(total_cost), 0)
    INTO v_current_stock, v_current_stock_cost
    FROM public.inventory_movement
    WHERE company_id = v_doc.company_id
      AND item_id = v_line.item_id
      AND inventory_state = 'packed_finished_goods';

    IF v_current_stock > 0 THEN
      v_unit_cogs := round(v_current_stock_cost / v_current_stock);
    ELSE
      v_unit_cogs := coalesce((v_line.data->>'fallbackUnitCost')::bigint, 0);
    END IF;

    v_line_cogs := round(v_line.quantity * v_unit_cogs);
    v_total_cogs := v_total_cogs + v_line_cogs;

    -- Catat mutasi barang jadi keluar (sales_issue)
    INSERT INTO public.inventory_movement (
      company_id, item_id, inventory_state, movement_type,
      quantity, unit_cost, total_cost,
      transaction_date, business_date,
      source_document_id, source_line_id,
      receipt_snapshot, posted_at, created_at
    ) VALUES (
      v_doc.company_id, v_line.item_id, 'packed_finished_goods', 'sales_issue',
      -v_line.quantity, v_unit_cogs, -v_line_cogs,
      v_doc.transaction_date, v_doc.transaction_date,
      v_doc.id, v_line.id,
      jsonb_build_object(
        'invoiceNumber', v_doc_number,
        'customerId', v_doc.counterparty_id,
        'customerName', v_customer.name
      ),
      now(), now()
    );
  END LOOP;

  -- 9. Efek Keuangan: Piutang Usaha (Receivable) vs Kas/Bank (Cash)
  v_funding_method := coalesce(v_doc.data->>'fundingMethod', 'receivable');

  IF v_funding_method = 'receivable' THEN
    v_subledger_id := gen_random_uuid();
    INSERT INTO public.subledger_entry (
      id, company_id, subledger_kind, subledger_type, counterparty_id,
      source_document_id, transaction_date, amount, debit_amount, credit_amount,
      remaining_balance, status, posted_at, created_at
    ) VALUES (
      v_subledger_id, v_doc.company_id, 'receivable', 'customer_receivable', v_doc.counterparty_id,
      v_doc.id, v_doc.transaction_date, v_total_amount, v_total_amount, 0,
      v_total_amount, 'open', now(), now()
    );

    UPDATE public.business_document
    SET paid_amount = 0
    WHERE id = v_doc.id;

  ELSIF v_funding_method = 'cash' THEN
    v_cash_account_id := (v_doc.data->>'cashAccountId')::uuid;
    IF v_cash_account_id IS NULL THEN
      RAISE EXCEPTION 'Akun Kas/Bank wajib dipilih untuk penjualan dengan metode tunai.';
    END IF;

    SELECT * INTO v_cash_account
    FROM public.master_record
    WHERE id = v_cash_account_id
      AND company_id = v_doc.company_id
      AND record_kind = 'cash_account'
      AND is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Akun Kas/Bank tidak ditemukan atau tidak aktif.';
    END IF;

    INSERT INTO public.cash_movement (
      company_id, cash_account_id, movement_type, transaction_date,
      amount, source_document_id, notes, posted_at, created_at
    ) VALUES (
      v_doc.company_id, v_cash_account_id, 'revenue', v_doc.transaction_date,
      v_total_amount, v_doc.id, 'Penerimaan penjualan tunai ' || v_doc_number, now(), now()
    );

    UPDATE public.business_document
    SET paid_amount = v_total_amount
    WHERE id = v_doc.id;
  ELSE
    RAISE EXCEPTION 'Metode pendanaan % tidak valid.', v_funding_method;
  END IF;

  -- 10. Efek Jurnal Umum Berpasangan Seimbang
  SELECT account_id INTO v_ar_account_id
  FROM public.accounting_mapping
  WHERE company_id = v_doc.company_id AND mapping_key = 'receivable';

  SELECT account_id INTO v_revenue_account_id
  FROM public.accounting_mapping
  WHERE company_id = v_doc.company_id AND mapping_key = 'sales_revenue';

  SELECT account_id INTO v_cogs_account_id
  FROM public.accounting_mapping
  WHERE company_id = v_doc.company_id AND mapping_key = 'cogs';

  SELECT account_id INTO v_finished_goods_account_id
  FROM public.accounting_mapping
  WHERE company_id = v_doc.company_id AND mapping_key = 'finished_goods';

  IF v_funding_method = 'cash' THEN
    v_cash_ledger_id := v_cash_account.ledger_account_id;
    IF v_cash_ledger_id IS NULL THEN
      SELECT account_id INTO v_cash_ledger_id
      FROM public.accounting_mapping
      WHERE company_id = v_doc.company_id AND mapping_key = 'cash';
    END IF;
  END IF;

  IF v_revenue_account_id IS NULL THEN
    RAISE EXCEPTION 'Pemetaan akun Pendapatan Penjualan (sales_revenue) belum dikonfigurasi.';
  END IF;

  IF v_funding_method = 'receivable' AND v_ar_account_id IS NULL THEN
    RAISE EXCEPTION 'Pemetaan akun Piutang Usaha (receivable) belum dikonfigurasi.';
  END IF;

  -- Buat Header Jurnal
  v_journal_seq_key := 'journal-' || to_char(v_doc.transaction_date, 'YYMMDD');
  v_prefix := 'JU-' || to_char(v_doc.transaction_date, 'YYMMDD') || '-';

  INSERT INTO public.document_sequence (
    company_id, sequence_key, prefix, padding, current_number, current_value, updated_at
  ) VALUES (
    v_doc.company_id, v_journal_seq_key, v_prefix, 3, 1, 1, now()
  )
  ON CONFLICT (company_id, sequence_key)
  DO UPDATE SET
    current_number = public.document_sequence.current_number + 1,
    current_value = public.document_sequence.current_value + 1,
    updated_at = now()
  RETURNING current_number INTO v_journal_seq_num;

  v_journal_number := v_prefix || lpad(v_journal_seq_num::text, 3, '0');
  v_journal_id := gen_random_uuid();

  INSERT INTO public.journal_entry (
    id, company_id, entry_number, period_id, source_document_id,
    transaction_date, entry_type, memo, description, status,
    posted_at, created_at
  ) VALUES (
    v_journal_id, v_doc.company_id, v_journal_number, v_period_id, v_doc.id,
    v_doc.transaction_date, 'sales', 'Faktur Penjualan ' || v_doc_number,
    'Faktur Penjualan ' || v_doc_number || ' - ' || v_customer.name,
    'posted', now(), now()
  );

  -- Line 1: Debit Piutang Usaha atau Kas/Bank
  INSERT INTO public.journal_line (
    company_id, journal_entry_id, line_number, account_id,
    debit_amount, credit_amount, debit, credit, description
  ) VALUES (
    v_doc.company_id, v_journal_id, v_journal_line_num,
    CASE WHEN v_funding_method = 'cash' THEN v_cash_ledger_id ELSE v_ar_account_id END,
    v_total_amount, 0, v_total_amount, 0,
    CASE WHEN v_funding_method = 'cash' THEN 'Penerimaan Penjualan Tunai' ELSE 'Piutang Penjualan' END
  );
  v_journal_line_num := v_journal_line_num + 1;

  -- Line 2: Kredit Pendapatan Penjualan
  INSERT INTO public.journal_line (
    company_id, journal_entry_id, line_number, account_id,
    debit_amount, credit_amount, debit, credit, description
  ) VALUES (
    v_doc.company_id, v_journal_id, v_journal_line_num, v_revenue_account_id,
    0, v_total_amount, 0, v_total_amount, 'Pendapatan Penjualan ' || v_doc_number
  );
  v_journal_line_num := v_journal_line_num + 1;

  -- Line 3 & 4: Jurnal HPP (Jika ada HPP > 0)
  IF v_total_cogs > 0 AND v_cogs_account_id IS NOT NULL AND v_finished_goods_account_id IS NOT NULL THEN
    INSERT INTO public.journal_line (
      company_id, journal_entry_id, line_number, account_id,
      debit_amount, credit_amount, debit, credit, description
    ) VALUES (
      v_doc.company_id, v_journal_id, v_journal_line_num, v_cogs_account_id,
      v_total_cogs, 0, v_total_cogs, 0, 'Beban Pokok Penjualan ' || v_doc_number
    );
    v_journal_line_num := v_journal_line_num + 1;

    INSERT INTO public.journal_line (
      company_id, journal_entry_id, line_number, account_id,
      debit_amount, credit_amount, debit, credit, description
    ) VALUES (
      v_doc.company_id, v_journal_id, v_journal_line_num, v_finished_goods_account_id,
      0, v_total_cogs, 0, v_total_cogs, 'Persediaan Barang Jadi ' || v_doc_number
    );
  END IF;

  -- 11. Pembaruan Pemenuhan (Fulfillment Status) pada PO Acuan
  IF v_doc.source_document_id IS NOT NULL THEN
    SELECT coalesce(sum(quantity), 0) INTO v_po_total_qty
    FROM public.business_document_line
    WHERE document_id = v_doc.source_document_id AND is_current = true;

    -- Hitung akumulasi kuantitas seluruh faktur posted untuk PO ini (termasuk faktur ini)
    SELECT coalesce(sum(bdl.quantity), 0) + (
      SELECT coalesce(sum(quantity), 0)
      FROM public.business_document_line
      WHERE document_id = v_doc.id AND is_current = true
    ) INTO v_posted_total_qty
    FROM public.business_document_line bdl
    JOIN public.business_document bd ON bdl.document_id = bd.id
    WHERE bd.source_document_id = v_doc.source_document_id
      AND bd.status = 'posted'
      AND bd.id <> v_doc.id
      AND bdl.is_current = true;

    IF v_posted_total_qty >= v_po_total_qty AND v_po_total_qty > 0 THEN
      v_delivery_status := 'full_delivery';
      UPDATE public.business_document
      SET data = jsonb_set(
            jsonb_set(data, '{deliveryStatus}', '"full_delivery"'),
            '{poStatus}', '"completed"'
          ),
          updated_at = now()
      WHERE id = v_doc.source_document_id;
    ELSIF v_posted_total_qty > 0 THEN
      v_delivery_status := 'partial_delivery';
      UPDATE public.business_document
      SET data = jsonb_set(data, '{deliveryStatus}', '"partial_delivery"'),
          updated_at = now()
      WHERE id = v_doc.source_document_id;
    END IF;
  END IF;

  -- 12. Finalisasi Status Faktur Menjadi Posted
  UPDATE public.business_document
  SET status = 'posted',
      document_number = v_doc_number,
      total_amount = v_total_amount,
      posted_at = now(),
      posted_by_user_id = p_user_id::text,
      updated_at = now()
  WHERE id = v_doc.id;

  -- 13. Audit Log
  INSERT INTO public.audit_log (
    company_id, user_id, actor_user_id, action,
    target_type, target_id, details, created_at
  ) VALUES (
    v_doc.company_id, p_user_id::text, p_user_id::text, 'sales.invoice.post',
    'business_document', v_doc.id::text,
    jsonb_build_object(
      'invoiceNumber', v_doc_number,
      'customerId', v_doc.counterparty_id,
      'totalAmount', v_total_amount,
      'cogsTotal', v_total_cogs,
      'fundingMethod', v_funding_method,
      'journalNumber', v_journal_number,
      'poId', v_doc.source_document_id,
      'deliveryStatus', v_delivery_status
    ),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'id', v_doc.id,
    'documentNumber', v_doc_number,
    'totalAmount', v_total_amount,
    'cogsTotal', v_total_cogs,
    'journalNumber', v_journal_number,
    'deliveryStatus', v_delivery_status
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.post_sales_receipt(p_invoice_id uuid, p_cash_account_id uuid, p_amount bigint, p_receipt_date date DEFAULT CURRENT_DATE, p_notes text DEFAULT NULL::text, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_doc RECORD;
  v_cash_account RECORD;
  v_period_id uuid;
  v_outstanding bigint;
  v_receipt_id uuid := gen_random_uuid();
  v_prefix text;
  v_seq_key text;
  v_seq_num bigint;
  v_km_number text;
  v_subledger RECORD;
  v_new_balance bigint;
  v_receipt_date date := coalesce(p_receipt_date, current_date);
  v_cash_ledger_id uuid;
  v_ar_account_id uuid;
  v_journal_id uuid;
  v_journal_seq_key text;
  v_journal_seq_num bigint;
  v_journal_number text;
BEGIN
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  p_user_id := tenant_private.assert_mis_company_access((SELECT d.company_id FROM public.business_document d WHERE d.id=p_invoice_id), p_user_id);
  -- 1. Validasi Nilai Pembayaran
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Jumlah pembayaran harus lebih besar dari nol.';
  END IF;

  -- 2. Validasi & Lock Dokumen Faktur
  SELECT * INTO v_doc
  FROM public.business_document
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Faktur penjualan tidak ditemukan.';
  END IF;

  IF v_doc.status <> 'posted' THEN
    RAISE EXCEPTION 'Pembayaran hanya dapat dilakukan untuk faktur yang berstatus posted.';
  END IF;

  v_outstanding := v_doc.total_amount - v_doc.paid_amount;
  IF v_outstanding <= 0 THEN
    RAISE EXCEPTION 'Faktur penjualan % sudah lunas.', v_doc.document_number;
  END IF;

  IF p_amount > v_outstanding THEN
    RAISE EXCEPTION 'Jumlah pembayaran (Rp %) melebihi sisa piutang faktur (Rp %).', p_amount, v_outstanding;
  END IF;

  -- 3. Validasi Akun Kas/Bank Penerima
  IF p_cash_account_id IS NULL THEN
    RAISE EXCEPTION 'Akun Kas/Bank penerima wajib dipilih.';
  END IF;

  SELECT * INTO v_cash_account
  FROM public.master_record
  WHERE id = p_cash_account_id
    AND company_id = v_doc.company_id
    AND record_kind = 'cash_account'
    AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Akun Kas/Bank penerima tidak ditemukan atau tidak aktif.';
  END IF;

  -- 4. Validasi Periode Akuntansi Terbuka
  SELECT id INTO v_period_id
  FROM public.accounting_period
  WHERE company_id = v_doc.company_id
    AND v_receipt_date >= start_date
    AND v_receipt_date <= end_date
    AND status = 'open';

  IF v_period_id IS NULL THEN
    RAISE EXCEPTION 'Tanggal penerimaan % tidak berada di dalam periode akuntansi yang terbuka.', v_receipt_date;
  END IF;

  -- 5. Penomoran Bukti Kas Masuk Otomatis: KM-YYMMDD-###
  v_prefix := 'KM-' || to_char(v_receipt_date, 'YYMMDD') || '-';
  v_seq_key := 'sales_receipt-' || to_char(v_receipt_date, 'YYMMDD');

  INSERT INTO public.document_sequence (
    company_id, sequence_key, prefix, padding, current_number, current_value, updated_at
  ) VALUES (
    v_doc.company_id, v_seq_key, v_prefix, 3, 1, 1, now()
  )
  ON CONFLICT (company_id, sequence_key)
  DO UPDATE SET
    current_number = public.document_sequence.current_number + 1,
    current_value = public.document_sequence.current_value + 1,
    updated_at = now()
  RETURNING current_number INTO v_seq_num;

  v_km_number := v_prefix || lpad(v_seq_num::text, 3, '0');

  -- 6. Buat Dokumen Penerimaan Piutang (sales_receipt)
  INSERT INTO public.business_document (
    id, company_id, document_kind, document_number, status,
    transaction_date, counterparty_id, source_document_id, total_amount, paid_amount,
    data, posted_at, posted_by_user_id, created_by_user_id, created_at, updated_at
  ) VALUES (
    v_receipt_id, v_doc.company_id, 'sales_receipt', v_km_number, 'posted',
    v_receipt_date, v_doc.counterparty_id, v_doc.id, p_amount, p_amount,
    jsonb_build_object(
      'cashAccountId', p_cash_account_id,
      'cashAccountName', v_cash_account.name,
      'invoiceNumber', v_doc.document_number,
      'notes', coalesce(p_notes, '')
    ),
    now(), p_user_id::text, p_user_id::text, now(), now()
  );

  -- 7. Update Sisa Piutang pada Subledger
  SELECT * INTO v_subledger
  FROM public.subledger_entry
  WHERE source_document_id = v_doc.id
    AND subledger_kind = 'receivable'
    AND status = 'open'
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    v_new_balance := v_subledger.remaining_balance - p_amount;
    UPDATE public.subledger_entry
    SET remaining_balance = v_new_balance,
        status = CASE WHEN v_new_balance <= 0 THEN 'closed' ELSE 'open' END
    WHERE id = v_subledger.id;
  END IF;

  -- 8. Update Akumulasi Terbayar pada Faktur
  UPDATE public.business_document
  SET paid_amount = paid_amount + p_amount,
      updated_at = now()
  WHERE id = v_doc.id;

  -- 9. Catat Mutasi Kas Masuk (cash_movement)
  INSERT INTO public.cash_movement (
    company_id, cash_account_id, movement_type, transaction_date,
    amount, source_document_id, reference_document_id, notes, posted_at, created_at
  ) VALUES (
    v_doc.company_id, p_cash_account_id, 'receipt', v_receipt_date,
    p_amount, v_receipt_id, v_doc.id,
    coalesce(p_notes, 'Penerimaan piutang faktur ' || coalesce(v_doc.document_number, '')),
    now(), now()
  );

  -- 10. Jurnal Umum Kas Masuk (Debit Kas, Kredit Piutang Usaha)
  SELECT account_id INTO v_ar_account_id
  FROM public.accounting_mapping
  WHERE company_id = v_doc.company_id AND mapping_key = 'receivable';

  v_cash_ledger_id := v_cash_account.ledger_account_id;
  IF v_cash_ledger_id IS NULL THEN
    SELECT account_id INTO v_cash_ledger_id
    FROM public.accounting_mapping
    WHERE company_id = v_doc.company_id AND mapping_key = 'cash';
  END IF;

  IF v_cash_ledger_id IS NOT NULL AND v_ar_account_id IS NOT NULL THEN
    v_journal_seq_key := 'journal-' || to_char(v_receipt_date, 'YYMMDD');
    v_prefix := 'JU-' || to_char(v_receipt_date, 'YYMMDD') || '-';

    INSERT INTO public.document_sequence (
      company_id, sequence_key, prefix, padding, current_number, current_value, updated_at
    ) VALUES (
      v_doc.company_id, v_journal_seq_key, v_prefix, 3, 1, 1, now()
    )
    ON CONFLICT (company_id, sequence_key)
    DO UPDATE SET
      current_number = public.document_sequence.current_number + 1,
      current_value = public.document_sequence.current_value + 1,
      updated_at = now()
    RETURNING current_number INTO v_journal_seq_num;

    v_journal_number := v_prefix || lpad(v_journal_seq_num::text, 3, '0');
    v_journal_id := gen_random_uuid();

    INSERT INTO public.journal_entry (
      id, company_id, entry_number, period_id, source_document_id,
      transaction_date, entry_type, memo, description, status,
      posted_at, created_at
    ) VALUES (
      v_journal_id, v_doc.company_id, v_journal_number, v_period_id, v_receipt_id,
      v_receipt_date, 'cash_receipt', 'Penerimaan Piutang ' || v_km_number,
      'Pelunasan/Penerimaan piutang faktur ' || coalesce(v_doc.document_number, ''),
      'posted', now(), now()
    );

    -- Debit Kas/Bank
    INSERT INTO public.journal_line (
      company_id, journal_entry_id, line_number, account_id,
      debit_amount, credit_amount, debit, credit, description
    ) VALUES (
      v_doc.company_id, v_journal_id, 1, v_cash_ledger_id,
      p_amount, 0, p_amount, 0, 'Penerimaan Kas/Bank ' || v_km_number
    );

    -- Kredit Piutang Usaha
    INSERT INTO public.journal_line (
      company_id, journal_entry_id, line_number, account_id,
      debit_amount, credit_amount, debit, credit, description
    ) VALUES (
      v_doc.company_id, v_journal_id, 2, v_ar_account_id,
      0, p_amount, 0, p_amount, 'Penerimaan Piutang Faktur ' || coalesce(v_doc.document_number, '')
    );
  END IF;

  -- 11. Audit Log
  INSERT INTO public.audit_log (
    company_id, user_id, actor_user_id, action,
    target_type, target_id, details, created_at
  ) VALUES (
    v_doc.company_id, p_user_id::text, p_user_id::text, 'sales.receipt.create',
    'business_document', v_receipt_id::text,
    jsonb_build_object(
      'receiptNumber', v_km_number,
      'invoiceId', v_doc.id,
      'invoiceNumber', v_doc.document_number,
      'amount', p_amount,
      'cashAccountId', p_cash_account_id,
      'remainingBalance', v_outstanding - p_amount
    ),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'receiptId', v_receipt_id,
    'receiptNumber', v_km_number,
    'invoiceNumber', v_doc.document_number,
    'paidAmount', p_amount,
    'remainingBalance', v_outstanding - p_amount
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.post_wage_payment(p_company_id uuid, p_employee_id uuid, p_cash_account_id uuid, p_payment_date date DEFAULT CURRENT_DATE, p_liability_ids jsonb DEFAULT '[]'::jsonb, p_notes text DEFAULT NULL::text, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  p_user_id := tenant_private.assert_mis_company_access(p_company_id, p_user_id);
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
$function$;

CREATE OR REPLACE FUNCTION public.reopen_accounting_period(p_company_id uuid, p_period_month text, p_reason text, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_period RECORD;
BEGIN
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  p_user_id := tenant_private.assert_mis_company_access(p_company_id, p_user_id);
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
$function$;

CREATE OR REPLACE FUNCTION public.reverse_manual_journal(p_company_id uuid, p_journal_id uuid, p_reason text, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  p_user_id := tenant_private.assert_mis_company_access(p_company_id, p_user_id);
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
$function$;

CREATE OR REPLACE FUNCTION public.save_accounting_mappings(p_company_id uuid, p_mappings jsonb, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_item jsonb;
  v_key text;
  v_account_id uuid;
  v_account RECORD;
  v_expected_type text;
  v_count integer := 0;
BEGIN
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  p_user_id := tenant_private.assert_mis_company_access(p_company_id, p_user_id);
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
$function$;

CREATE OR REPLACE FUNCTION public.save_report_account_mappings(p_company_id uuid, p_mappings jsonb, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_item jsonb;
  v_account_id uuid;
  v_mgmt_post text;
  v_cf_act text;
  v_cf_grp text;
  v_account RECORD;
  v_count integer := 0;
BEGIN
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  p_user_id := tenant_private.assert_mis_company_access(p_company_id, p_user_id);
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
$function$;

CREATE OR REPLACE FUNCTION public.sync_production_operator_profiles(p_company_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_count integer := 0;
  v_rec RECORD;
  v_emp_id uuid;
  v_role text;
  v_user_roles text[];
  v_all_roles text[] := ARRAY['operator_potong', 'operator_sablon', 'operator_jahit', 'operator_packing'];
BEGIN
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  PERFORM tenant_private.assert_mis_company_access(p_company_id, NULL);
  FOR v_rec IN 
    SELECT uca.user_id, uca.roles, u.email, coalesce(u.raw_user_meta_data->>'name', split_part(u.email, '@', 1)) as name, uca.is_active
    FROM public.user_company_assignment uca
    JOIN auth.users u ON u.id = uca.user_id
    WHERE uca.company_id = p_company_id AND uca.is_active = true
  LOOP
    -- Cari atau buat master_record employee
    SELECT id INTO v_emp_id
    FROM public.master_record
    WHERE company_id = p_company_id AND record_kind = 'employee' AND data->>'userId' = v_rec.user_id::text
    LIMIT 1;

    IF v_emp_id IS NULL THEN
      INSERT INTO public.master_record (
        company_id, record_kind, name, data, is_active, version
      ) VALUES (
        p_company_id, 'employee', v_rec.name, jsonb_build_object('userId', v_rec.user_id::text, 'email', v_rec.email), true, 1
      ) RETURNING id INTO v_emp_id;
    END IF;

    -- Tentukan role operator yang relevan untuk user ini
    -- Jika user memiliki role owner / kepala_konveksi / admin / operator, daftarkan profil operasional
    v_user_roles := v_rec.roles;
    IF 'owner' = ANY(v_user_roles) OR 'kepala_konveksi' = ANY(v_user_roles) OR 'operator' = ANY(v_user_roles) THEN
      v_user_roles := array_cat(v_user_roles, v_all_roles);
    END IF;

    FOREACH v_role IN ARRAY v_all_roles LOOP
      IF v_role = ANY(v_user_roles) THEN
        INSERT INTO public.production_operator_profile (
          company_id, employee_id, user_id, operator_role, is_active
        ) VALUES (
          p_company_id, v_emp_id, v_rec.user_id, v_role, true
        )
        ON CONFLICT (company_id, employee_id, operator_role)
        DO UPDATE SET is_active = true, updated_at = now();

        v_count := v_count + 1;
      END IF;
    END LOOP;
  END LOOP;

  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_asset_parameters(p_company_id uuid, p_asset_id uuid, p_category_id uuid DEFAULT NULL::uuid, p_depreciation_method text DEFAULT NULL::text, p_useful_life_months integer DEFAULT NULL::integer, p_residual_value bigint DEFAULT NULL::bigint, p_depreciation_start_date date DEFAULT NULL::date, p_location text DEFAULT NULL::text, p_custodian text DEFAULT NULL::text, p_serial_number text DEFAULT NULL::text, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_asset RECORD;
  v_category RECORD;
BEGIN
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  p_user_id := tenant_private.assert_mis_company_access(p_company_id, p_user_id);
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
$function$;

CREATE OR REPLACE FUNCTION public.update_company_details(p_company_id uuid, p_name text, p_code text DEFAULT NULL::text, p_address text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_is_active boolean DEFAULT NULL::boolean, p_expected_version integer DEFAULT NULL::integer)
 RETURNS company
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid;
  v_existing public.company;
  v_updated public.company;
  v_cleaned_code text;
  v_cleaned_name text;
BEGIN
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  PERFORM tenant_private.assert_mis_company_access(p_company_id, NULL);
  v_user_id := (SELECT auth.uid());
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Akses ditolak: Pengguna belum terautentikasi.' USING ERRCODE = '42501';
  END IF;

  -- Validasi kewenangan: Pengguna harus owner pada perusahaan ini
  IF NOT public.is_company_owner(p_company_id, v_user_id) THEN
    RAISE EXCEPTION 'Akses ditolak: Hanya Owner dari perusahaan ini yang dapat mengubah data profil perusahaan.' USING ERRCODE = '42501';
  END IF;

  -- Ambil data terkini
  SELECT * INTO v_existing
  FROM public.company
  WHERE id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Perusahaan dengan ID % tidak ditemukan.', p_company_id USING ERRCODE = 'P0002';
  END IF;

  -- Cek optimistic versioning jika dikirimkan
  IF p_expected_version IS NOT NULL AND v_existing.version != p_expected_version THEN
    RAISE EXCEPTION 'Data perusahaan telah diperbarui oleh pengguna lain. Silakan segarkan halaman.' USING ERRCODE = '40001';
  END IF;

  -- Validasi nama perusahaan
  v_cleaned_name := trim(p_name);
  IF v_cleaned_name IS NULL OR v_cleaned_name = '' THEN
    RAISE EXCEPTION 'Nama perusahaan wajib diisi.' USING ERRCODE = '22023';
  END IF;

  -- Validasi kode perusahaan (jika diubah)
  IF p_code IS NOT NULL THEN
    v_cleaned_code := upper(trim(p_code));
    IF v_cleaned_code != v_existing.code THEN
      IF v_existing.code_locked THEN
        RAISE EXCEPTION 'Kode perusahaan telah dikunci dan tidak dapat diubah demi integritas dokumen transaksi.' USING ERRCODE = '22023';
      END IF;

      IF NOT (v_cleaned_code ~ '^[A-Z0-9_-]+$') THEN
        RAISE EXCEPTION 'Kode perusahaan hanya boleh berupa huruf kapital, angka, garis bawah, atau tanda hubung tanpa spasi.' USING ERRCODE = '22023';
      END IF;

      IF length(v_cleaned_code) < 2 OR length(v_cleaned_code) > 20 THEN
        RAISE EXCEPTION 'Kode perusahaan harus terdiri dari 2 hingga 20 karakter.' USING ERRCODE = '22023';
      END IF;

      IF EXISTS (SELECT 1 FROM public.company WHERE code = v_cleaned_code AND id != p_company_id) THEN
        RAISE EXCEPTION 'Kode perusahaan "%" sudah digunakan oleh entitas lain.', v_cleaned_code USING ERRCODE = '23505';
      END IF;
    END IF;
  ELSE
    v_cleaned_code := v_existing.code;
  END IF;

  IF EXISTS (SELECT 1 FROM public.company WHERE name = v_cleaned_name AND id != p_company_id) THEN
    RAISE EXCEPTION 'Nama perusahaan "%" sudah digunakan oleh entitas lain.', v_cleaned_name USING ERRCODE = '23505';
  END IF;

  -- Lakukan pembaruan
  UPDATE public.company
  SET
    code = v_cleaned_code,
    name = v_cleaned_name,
    address = NULLIF(trim(p_address), ''),
    phone = NULLIF(trim(p_phone), ''),
    email = NULLIF(trim(p_email), ''),
    is_active = COALESCE(p_is_active, v_existing.is_active),
    version = v_existing.version + 1,
    updated_at = now()
  WHERE id = p_company_id
  RETURNING * INTO v_updated;

  -- Catat audit log
  INSERT INTO public.audit_log (
    company_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    result,
    details,
    before,
    after
  )
  VALUES (
    p_company_id,
    v_user_id,
    'company.update',
    'company',
    p_company_id::text,
    'success',
    jsonb_build_object(
      'name', v_updated.name,
      'code', v_updated.code,
      'address', v_updated.address,
      'phone', v_updated.phone,
      'email', v_updated.email,
      'is_active', v_updated.is_active
    ),
    to_jsonb(v_existing),
    to_jsonb(v_updated)
  );

  RETURN v_updated;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_ledger_account_status(p_company_id uuid, p_account_id uuid, p_is_active boolean, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_account RECORD;
BEGIN
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  p_user_id := tenant_private.assert_mis_company_access(p_company_id, p_user_id);
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
$function$;

CREATE OR REPLACE FUNCTION public.void_operating_expense(p_company_id uuid, p_document_id uuid, p_reason text, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  p_user_id := tenant_private.assert_mis_company_access(p_company_id, p_user_id);
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
$function$;

CREATE OR REPLACE FUNCTION public.void_purchase_document(p_document_id uuid, p_user_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_doc RECORD;
  v_orig_journal RECORD;
  v_orig_line RECORD;
  v_rev_journal_id uuid;
  v_rev_journal_seq_num bigint;
  v_rev_journal_seq_key text;
  v_rev_journal_number text;
  v_movement RECORD;
  v_rev_line_num integer := 1;
BEGIN
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  p_user_id := tenant_private.assert_mis_company_access((SELECT d.company_id FROM public.business_document d WHERE d.id=p_document_id), p_user_id);
  -- 1. Validasi Keberadaan Dokumen
  SELECT * INTO v_doc
  FROM public.business_document
  WHERE id = p_document_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dokumen pembelian dengan ID % tidak ditemukan.', p_document_id;
  END IF;

  IF v_doc.status <> 'posted' THEN
    RAISE EXCEPTION 'Hanya dokumen berstatus posted yang dapat dibatalkan (void). Status saat ini: %', v_doc.status;
  END IF;

  -- 2. Validasi Pembayaran Terkait
  IF v_doc.paid_amount > 0 OR EXISTS (
    SELECT 1 FROM public.business_document
    WHERE source_document_id = v_doc.id AND document_kind = 'purchase_payment' AND status = 'posted'
  ) THEN
    RAISE EXCEPTION 'Dokumen pembelian % telah memiliki pembayaran. Batalkan transaksi pembayaran terlebih dahulu.', v_doc.document_number;
  END IF;

  -- 3. Validasi Konsumsi Unit Fisik Roll
  IF EXISTS (
    SELECT 1 FROM public.production_material_unit
    WHERE source_document_id = v_doc.id AND status = 'consumed'
  ) THEN
    RAISE EXCEPTION 'Material pada pembelian % telah digunakan dalam pemotongan produksi dan tidak dapat dibatalkan.', v_doc.document_number;
  END IF;

  -- 4. Reversal Unit Fisik Roll
  UPDATE public.production_material_unit
  SET status = 'reversed'
  WHERE source_document_id = v_doc.id;

  -- 5. Reversal Mutasi Inventaris
  FOR v_movement IN
    SELECT * FROM public.inventory_movement
    WHERE source_document_id = v_doc.id AND reversal_of_id IS NULL
  LOOP
    INSERT INTO public.inventory_movement (
      company_id, item_id, inventory_state, movement_type, lot_code,
      quantity, unit_cost, total_cost, transaction_date, business_date,
      source_document_id, source_line_id, reversal_of_id, receipt_snapshot, notes, posted_at, created_at
    ) VALUES (
      v_doc.company_id, v_movement.item_id, v_movement.inventory_state, 'reversal', v_movement.lot_code,
      -v_movement.quantity, v_movement.unit_cost, -v_movement.total_cost, current_date, current_date,
      v_doc.id, v_movement.source_line_id, v_movement.id, v_movement.receipt_snapshot,
      'Reversal pembatalan ' || v_doc.document_number, now(), now()
    );
  END LOOP;

  -- 6. Batalkan Subledger Hutang Pemasok
  UPDATE public.subledger_entry
  SET status = 'cancelled',
      remaining_balance = 0
  WHERE source_document_id = v_doc.id;

  -- 7. Batalkan Pengeluaran Kas (jika tunai)
  IF (v_doc.data->>'fundingMethod') = 'cash' THEN
    INSERT INTO public.cash_movement (
      company_id, cash_account_id, movement_type, transaction_date,
      amount, source_document_id, notes, posted_at, created_at
    )
    SELECT company_id, cash_account_id, 'receipt', current_date,
           amount, source_document_id, 'Reversal tunai pembatalan ' || v_doc.document_number, now(), now()
    FROM public.cash_movement
    WHERE source_document_id = v_doc.id AND movement_type = 'expense';
  END IF;

  -- 8. Buat Jurnal Reversal Berimbang
  SELECT * INTO v_orig_journal
  FROM public.journal_entry
  WHERE source_document_id = v_doc.id AND reversal_of_id IS NULL
  ORDER BY created_at DESC LIMIT 1;

  IF v_orig_journal.id IS NOT NULL THEN
    v_rev_journal_seq_key := 'journal-' || to_char(current_date, 'YYMMDD');
    INSERT INTO public.document_sequence (
      company_id, sequence_key, prefix, padding, current_number, current_value, updated_at
    ) VALUES (
      v_doc.company_id, v_rev_journal_seq_key, 'JU-' || to_char(current_date, 'YYMMDD') || '-', 3, 1, 1, now()
    )
    ON CONFLICT (company_id, sequence_key)
    DO UPDATE SET
      current_number = public.document_sequence.current_number + 1,
      current_value = public.document_sequence.current_value + 1,
      updated_at = now()
    RETURNING current_number INTO v_rev_journal_seq_num;

    v_rev_journal_number := 'JU-' || to_char(current_date, 'YYMMDD') || '-' || lpad(v_rev_journal_seq_num::text, 3, '0');

    INSERT INTO public.journal_entry (
      company_id, entry_number, period_id, source_document_id, reversal_of_id,
      transaction_date, entry_type, memo, description, status, posted_at, created_at
    ) VALUES (
      v_doc.company_id, v_rev_journal_number, v_orig_journal.period_id, v_doc.id, v_orig_journal.id,
      current_date, 'reversal', 'Pembalik ' || v_doc.document_number,
      'Jurnal pembalik pembatalan pembelian ' || v_doc.document_number, 'posted', now(), now()
    ) RETURNING id INTO v_rev_journal_id;

    -- Balik seluruh baris jurnal (Debit jadi Kredit, Kredit jadi Debit)
    FOR v_orig_line IN
      SELECT * FROM public.journal_line WHERE journal_entry_id = v_orig_journal.id ORDER BY line_number ASC
    LOOP
      INSERT INTO public.journal_line (
        company_id, journal_entry_id, line_number, account_id,
        debit_amount, credit_amount, debit, credit, description, subledger_type, subledger_id
      ) VALUES (
        v_doc.company_id, v_rev_journal_id, v_rev_line_num, v_orig_line.account_id,
        v_orig_line.credit_amount, v_orig_line.debit_amount,
        v_orig_line.credit, v_orig_line.debit,
        'Pembalik: ' || coalesce(v_orig_line.description, ''),
        v_orig_line.subledger_type, v_orig_line.subledger_id
      );
      v_rev_line_num := v_rev_line_num + 1;
    END LOOP;
  END IF;

  -- 9. Update Dokumen Menjadi Void
  UPDATE public.business_document
  SET status = 'void',
      void_reason = p_reason,
      voided_at = now(),
      voided_by_user_id = p_user_id::text,
      updated_at = now()
  WHERE id = v_doc.id;

  -- 10. Catat Audit Log
  INSERT INTO public.audit_log (
    company_id, user_id, actor_user_id, action, target_type, target_id, details, created_at
  ) VALUES (
    v_doc.company_id, p_user_id::text, p_user_id::text, 'document.void', 'business_document', v_doc.id::text,
    jsonb_build_object(
      'documentNumber', v_doc.document_number,
      'reason', p_reason
    ),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'documentId', v_doc.id,
    'documentNumber', v_doc.document_number,
    'status', 'void'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.void_sales_invoice(p_document_id uuid, p_user_id uuid, p_reason text DEFAULT 'Pembatalan faktur penjualan'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_doc RECORD;
  v_im RECORD;
  v_se RECORD;
  v_cm RECORD;
  v_je RECORD;
  v_jl RECORD;
  v_rev_journal_id uuid;
  v_rev_journal_seq_num bigint;
  v_rev_journal_prefix text;
  v_rev_journal_seq_key text;
  v_rev_journal_number text;
  v_po_total_qty numeric(18, 4);
  v_remaining_posted_qty numeric(18, 4);
BEGIN
  -- Otorisasi MIS sebelum membaca atau mengubah object bisnis.
  p_user_id := tenant_private.assert_mis_company_access((SELECT d.company_id FROM public.business_document d WHERE d.id=p_document_id), p_user_id);
  -- 1. Validasi & Lock Dokumen Faktur
  SELECT * INTO v_doc
  FROM public.business_document
  WHERE id = p_document_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Faktur penjualan dengan ID % tidak ditemukan.', p_document_id;
  END IF;

  IF v_doc.status <> 'posted' THEN
    RAISE EXCEPTION 'Hanya faktur berstatus posted yang dapat dibatalkan. Status saat ini: %', v_doc.status;
  END IF;

  -- 2. Validasi Tidak Ada Penerimaan Pembayaran (sales_receipt) yang Posted
  IF EXISTS (
    SELECT 1 FROM public.business_document
    WHERE source_document_id = v_doc.id
      AND document_kind = 'sales_receipt'
      AND status = 'posted'
  ) THEN
    RAISE EXCEPTION 'Faktur penjualan % tidak dapat dibatalkan karena memiliki bukti penerimaan pembayaran yang aktif. Batalkan penerimaan pembayaran terlebih dahulu.', v_doc.document_number;
  END IF;

  -- 3. Balikkan Mutasi Inventaris Barang Jadi (Kembalikan stok)
  FOR v_im IN
    SELECT * FROM public.inventory_movement
    WHERE source_document_id = v_doc.id AND reversal_of_id IS NULL
  LOOP
    INSERT INTO public.inventory_movement (
      company_id, item_id, inventory_state, movement_type,
      quantity, unit_cost, total_cost,
      transaction_date, business_date,
      source_document_id, reversal_of_id,
      notes, posted_at, created_at
    ) VALUES (
      v_im.company_id, v_im.item_id, v_im.inventory_state, 'sales_return',
      -v_im.quantity, v_im.unit_cost, -v_im.total_cost,
      current_date, current_date,
      v_doc.id, v_im.id,
      'Pembalik pembatalan faktur ' || coalesce(v_doc.document_number, ''),
      now(), now()
    );
  END LOOP;

  -- 4. Balikkan Entri Piutang pada Subledger
  FOR v_se IN
    SELECT * FROM public.subledger_entry
    WHERE source_document_id = v_doc.id AND reversal_of_id IS NULL
  LOOP
    UPDATE public.subledger_entry
    SET status = 'void'
    WHERE id = v_se.id;

    INSERT INTO public.subledger_entry (
      company_id, subledger_kind, subledger_type, counterparty_id,
      source_document_id, transaction_date, amount, debit_amount, credit_amount,
      remaining_balance, status, reversal_of_id, posted_at, created_at
    ) VALUES (
      v_se.company_id, v_se.subledger_kind, v_se.subledger_type, v_se.counterparty_id,
      v_doc.id, current_date, -v_se.amount, 0, v_se.debit_amount,
      0, 'closed', v_se.id, now(), now()
    );
  END LOOP;

  -- 5. Balikkan Mutasi Kas jika Penjualan Tunai
  FOR v_cm IN
    SELECT * FROM public.cash_movement
    WHERE source_document_id = v_doc.id AND reversal_of_id IS NULL
  LOOP
    INSERT INTO public.cash_movement (
      company_id, cash_account_id, movement_type, transaction_date,
      amount, source_document_id, paired_movement_id, reversal_of_id,
      notes, posted_at, created_at
    ) VALUES (
      v_cm.company_id, v_cm.cash_account_id, 'reversal', current_date,
      -v_cm.amount, v_doc.id, NULL, v_cm.id,
      'Pembalik faktur ' || coalesce(v_doc.document_number, ''), now(), now()
    );
  END LOOP;

  -- 6. Jurnal Pembalik (Reversal Journal Entry)
  FOR v_je IN
    SELECT * FROM public.journal_entry
    WHERE source_document_id = v_doc.id AND reversal_of_id IS NULL
  LOOP
    v_rev_journal_seq_key := 'journal-' || to_char(current_date, 'YYMMDD');
    v_rev_journal_prefix := 'JU-' || to_char(current_date, 'YYMMDD') || '-';

    INSERT INTO public.document_sequence (
      company_id, sequence_key, prefix, padding, current_number, current_value, updated_at
    ) VALUES (
      v_je.company_id, v_rev_journal_seq_key, v_rev_journal_prefix, 3, 1, 1, now()
    )
    ON CONFLICT (company_id, sequence_key)
    DO UPDATE SET
      current_number = public.document_sequence.current_number + 1,
      current_value = public.document_sequence.current_value + 1,
      updated_at = now()
    RETURNING current_number INTO v_rev_journal_seq_num;

    v_rev_journal_number := v_rev_journal_prefix || lpad(v_rev_journal_seq_num::text, 3, '0');
    v_rev_journal_id := gen_random_uuid();

    INSERT INTO public.journal_entry (
      id, company_id, entry_number, period_id, source_document_id,
      transaction_date, entry_type, memo, description, status,
      reversal_of_id, posted_at, created_at
    ) VALUES (
      v_rev_journal_id, v_je.company_id, v_rev_journal_number, v_je.period_id, v_doc.id,
      current_date, 'reversal', 'Pembalik Faktur Penjualan ' || coalesce(v_doc.document_number, ''),
      'Reversal of ' || v_je.entry_number || ': ' || coalesce(p_reason, 'Pembatalan faktur'),
      'posted', v_je.id, now(), now()
    );

    -- Balikkan baris jurnal: Debit -> Kredit, Kredit -> Debit
    FOR v_jl IN
      SELECT * FROM public.journal_line
      WHERE journal_entry_id = v_je.id
    LOOP
      INSERT INTO public.journal_line (
        company_id, journal_entry_id, line_number, account_id,
        debit_amount, credit_amount, debit, credit, description
      ) VALUES (
        v_jl.company_id, v_rev_journal_id, v_jl.line_number, v_jl.account_id,
        v_jl.credit_amount, v_jl.debit_amount, v_jl.credit, v_jl.debit,
        'Pembalik: ' || coalesce(v_jl.description, '')
      );
    END LOOP;
  END LOOP;

  -- 7. Sesuaikan Kembali Status Fulfillment pada PO Acuan (Jika Ada)
  IF v_doc.source_document_id IS NOT NULL THEN
    SELECT coalesce(sum(quantity), 0) INTO v_po_total_qty
    FROM public.business_document_line
    WHERE document_id = v_doc.source_document_id AND is_current = true;

    SELECT coalesce(sum(bdl.quantity), 0) INTO v_remaining_posted_qty
    FROM public.business_document_line bdl
    JOIN public.business_document bd ON bdl.document_id = bd.id
    WHERE bd.source_document_id = v_doc.source_document_id
      AND bd.status = 'posted'
      AND bd.id <> v_doc.id
      AND bdl.is_current = true;

    IF v_remaining_posted_qty = 0 THEN
      UPDATE public.business_document
      SET data = jsonb_set(
            jsonb_set(data, '{deliveryStatus}', '"unshipped"'),
            '{poStatus}', '"open"'
          ),
          updated_at = now()
      WHERE id = v_doc.source_document_id;
    ELSIF v_remaining_posted_qty < v_po_total_qty THEN
      UPDATE public.business_document
      SET data = jsonb_set(
            jsonb_set(data, '{deliveryStatus}', '"partial_delivery"'),
            '{poStatus}', '"open"'
          ),
          updated_at = now()
      WHERE id = v_doc.source_document_id;
    ELSE
      UPDATE public.business_document
      SET data = jsonb_set(
            jsonb_set(data, '{deliveryStatus}', '"full_delivery"'),
            '{poStatus}', '"completed"'
          ),
          updated_at = now()
      WHERE id = v_doc.source_document_id;
    END IF;
  END IF;

  -- 8. Update Dokumen Faktur Menjadi Void
  UPDATE public.business_document
  SET status = 'void',
      voided_at = now(),
      voided_by_user_id = p_user_id::text,
      void_reason = coalesce(p_reason, 'Pembatalan faktur penjualan'),
      updated_at = now()
  WHERE id = v_doc.id;

  -- 9. Audit Log
  INSERT INTO public.audit_log (
    company_id, user_id, actor_user_id, action,
    target_type, target_id, details, created_at
  ) VALUES (
    v_doc.company_id, p_user_id::text, p_user_id::text, 'sales.invoice.void',
    'business_document', v_doc.id::text,
    jsonb_build_object(
      'invoiceNumber', v_doc.document_number,
      'voidReason', coalesce(p_reason, ''),
      'totalAmount', v_doc.total_amount
    ),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'id', v_doc.id,
    'documentNumber', v_doc.document_number,
    'status', 'void'
  );
END;
$function$;

NOTIFY pgrst, 'reload schema';
COMMIT;
