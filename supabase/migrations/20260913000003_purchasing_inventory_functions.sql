-- ==============================================================================
-- Migrasi 000003: Stored Procedure & Logic Purchasing & Inventory Ledger
-- ==============================================================================

-- 1. Pastikan setiap perusahaan memiliki akun kas/bank (cash_account) di master_record
DO $$
DECLARE
  v_company RECORD;
  v_cash_account RECORD;
BEGIN
  FOR v_company IN SELECT id FROM public.company LOOP
    -- Cari akun Kas Kecil atau Kas di ledger_account
    FOR v_cash_account IN 
      SELECT id, name, code FROM public.ledger_account 
      WHERE company_id = v_company.id AND (code LIKE '1-1.1%' OR name ILIKE '%kas%' OR name ILIKE '%bank%')
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.master_record 
        WHERE company_id = v_company.id AND record_kind = 'cash_account' AND ledger_account_id = v_cash_account.id
      ) THEN
        INSERT INTO public.master_record (
          company_id, record_kind, name, ledger_account_id, is_active
        ) VALUES (
          v_company.id, 'cash_account', v_cash_account.name, v_cash_account.id, true
        );
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

-- 2. Fungsi Atomik: Posting Dokumen Pembelian (Material, Supplies, Non-Produksi)
CREATE OR REPLACE FUNCTION public.post_purchase_document(
  p_document_id uuid,
  p_user_id uuid
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
$$;


-- 3. Fungsi Atomik: Pembatalan Dokumen Pembelian (Void Purchase Document)
CREATE OR REPLACE FUNCTION public.void_purchase_document(
  p_document_id uuid,
  p_user_id uuid,
  p_reason text
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
  v_rev_journal_seq_num bigint;
  v_rev_journal_seq_key text;
  v_rev_journal_number text;
  v_movement RECORD;
  v_rev_line_num integer := 1;
BEGIN
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
$$;


-- 4. Fungsi Atomik: Pembayaran Hutang Pembelian (Post Purchase Payment)
CREATE OR REPLACE FUNCTION public.post_purchase_payment(
  p_purchase_id uuid,
  p_cash_account_id uuid,
  p_amount bigint,
  p_date date,
  p_notes text,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;


-- 5. Fungsi Helper: Rekap Saldo Inventaris Perpetual
CREATE OR REPLACE FUNCTION public.get_inventory_summary(p_company_id uuid)
RETURNS TABLE (
  item_id uuid,
  item_name text,
  item_kind text,
  unit_code text,
  inventory_state text,
  total_in numeric(18, 4),
  total_out numeric(18, 4),
  current_stock numeric(18, 4),
  moving_avg_cost bigint,
  total_valuation bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;
