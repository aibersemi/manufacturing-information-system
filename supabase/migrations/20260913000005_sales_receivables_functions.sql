-- ==============================================================================
-- Migrasi 000005: Stored Procedure & Logic Sales & Receivables Ledger
-- ==============================================================================

-- 1. Fungsi Atomik: Membuat Pesanan Penjualan Pelanggan (Customer PO)
CREATE OR REPLACE FUNCTION public.create_customer_po(
  p_company_id uuid,
  p_customer_id uuid,
  p_order_number text DEFAULT NULL,
  p_order_date date DEFAULT current_date,
  p_target_delivery_date date DEFAULT NULL,
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
$$;

-- 2. Fungsi Atomik: Membuat Draf Faktur Penjualan (Sales Invoice Draft)
CREATE OR REPLACE FUNCTION public.create_sales_invoice(
  p_company_id uuid,
  p_customer_id uuid,
  p_po_id uuid DEFAULT NULL,
  p_invoice_date date DEFAULT current_date,
  p_funding_method text DEFAULT 'receivable',
  p_cash_account_id uuid DEFAULT NULL,
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
$$;

-- 3. Fungsi Atomik: Memposting Faktur Penjualan (Post Sales Invoice)
CREATE OR REPLACE FUNCTION public.post_sales_invoice(
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
$$;

-- 4. Fungsi Atomik: Membatalkan Faktur Penjualan (Void Sales Invoice)
CREATE OR REPLACE FUNCTION public.void_sales_invoice(
  p_document_id uuid,
  p_user_id uuid,
  p_reason text DEFAULT 'Pembatalan faktur penjualan'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

-- 5. Fungsi Atomik: Memproses Pembayaran Piutang (Post Sales Receipt)
DROP FUNCTION IF EXISTS public.post_sales_receipt(uuid, uuid, bigint, date, text, uuid);
CREATE OR REPLACE FUNCTION public.post_sales_receipt(
  p_invoice_id uuid,
  p_cash_account_id uuid,
  p_amount bigint,
  p_receipt_date date DEFAULT current_date,
  p_notes text DEFAULT NULL,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

-- 6. Fungsi Analitik: Ringkasan Pemenuhan & Pelacakan Pesanan Penjualan
CREATE OR REPLACE FUNCTION public.get_sales_fulfillment_summary(
  p_company_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_summary jsonb;
BEGIN
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
$$;

-- 7. Grant Hak Eksekusi ke Peran Pengguna
GRANT EXECUTE ON FUNCTION public.create_customer_po(uuid, uuid, text, date, date, text, jsonb, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_sales_invoice(uuid, uuid, uuid, date, text, uuid, text, jsonb, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_sales_invoice(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.void_sales_invoice(uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_sales_receipt(uuid, uuid, bigint, date, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_sales_fulfillment_summary(uuid) TO authenticated, service_role;
