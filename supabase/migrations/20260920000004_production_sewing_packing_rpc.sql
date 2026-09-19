-- ==============================================================================
-- Migrasi 20260920000004: Stored Procedures & Atomic Functions untuk Operator Jahit & Operator Packing
-- 1. confirm_operator_sewing: Catat hasil jahit operator per bundle, mutasi WIP jahit (sewn_wip) / waste,
--    bentuk repair case jika ada cacat, hitung upah jahit (default Rp 15.000 / pcs), & update status SPK.
-- 2. confirm_operator_packing: Catat hasil packing operator per bundle, mutasi produk jadi (packed_finished_goods),
--    hitung upah packing (default Rp 1.000 / pcs), tandai bundle completed, & update status SPK.
-- ==============================================================================

-- 1. Fungsi Atomik: Catat Hasil Jahit oleh Operator Jahit per Ikatan Komponen
CREATE OR REPLACE FUNCTION public.confirm_operator_sewing(
  p_spk_id uuid,
  p_bundle_id uuid,
  p_success_qty integer,
  p_repair_qty integer,
  p_reject_qty integer,
  p_notes text,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

-- 2. Fungsi Atomik: Catat Hasil Packing oleh Operator Packing per Ikatan Komponen
CREATE OR REPLACE FUNCTION public.confirm_operator_packing(
  p_spk_id uuid,
  p_bundle_id uuid,
  p_success_qty integer,
  p_notes text,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

-- Hak Akses Eksekusi RPC
GRANT EXECUTE ON FUNCTION public.confirm_operator_sewing(uuid, uuid, integer, integer, integer, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_operator_packing(uuid, uuid, integer, text, uuid) TO authenticated, service_role;
