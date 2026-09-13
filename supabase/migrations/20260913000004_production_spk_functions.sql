-- ==============================================================================
-- Migrasi 000004: Stored Procedures & Atomic Functions untuk Produksi & SPK
-- Operasional Pabrik: Perintah Produksi, SPK 4 Tahap, Catat Potong Roll Operator,
-- Catat Sablon Operator, Bundle Tracking, Kasus Perbaikan, & Progress Produksi
-- ==============================================================================

-- 1. Helper: Sinkronisasi Profil Operator Produksi dari User & Employee
CREATE OR REPLACE FUNCTION public.sync_production_operator_profiles(
  p_company_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer := 0;
  v_rec RECORD;
  v_emp_id uuid;
  v_role text;
  v_user_roles text[];
  v_all_roles text[] := ARRAY['operator_potong', 'operator_sablon', 'operator_jahit', 'operator_packing'];
BEGIN
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
$$;

-- 2. Fungsi Atomik: Membuat Perintah Produksi (PP)
CREATE OR REPLACE FUNCTION public.create_production_order(
  p_company_id uuid,
  p_target_date date,
  p_notes text,
  p_lines jsonb,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

-- 3. Fungsi Atomik: Membuat Surat Perintah Kerja (SPK) 4 Tahap
CREATE OR REPLACE FUNCTION public.create_spk(
  p_pp_id uuid,
  p_stage text,
  p_operator_id uuid,
  p_target_pcs integer,
  p_notes text,
  p_bundle_ids jsonb,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

-- 4. Fungsi Atomik: Catat Aktual Pemotongan Roll Kain oleh Operator Potong
CREATE OR REPLACE FUNCTION public.confirm_operator_cutting(
  p_spk_id uuid,
  p_roll_id uuid,
  p_actual_date date,
  p_actual_lines jsonb,
  p_bundles jsonb,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

-- 5. Fungsi Atomik: Catat Hasil Sablon oleh Operator Sablon per Ikatan Komponen
CREATE OR REPLACE FUNCTION public.confirm_operator_printing(
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
  v_wage_amount bigint := 0;
  v_repair_case_id uuid := NULL;
  v_all_completed boolean := false;
BEGIN
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
$$;

-- 6. Fungsi Atomik: Menugaskan Kasus Perbaikan (SPK Repair Assignment)
CREATE OR REPLACE FUNCTION public.assign_repair_spk(
  p_repair_case_id uuid,
  p_operator_id uuid,
  p_wage_mode text,
  p_custom_rate bigint,
  p_notes text,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

-- 7. Fungsi Analitik: Ringkasan Progress & Pelacakan Produksi
CREATE OR REPLACE FUNCTION public.get_production_progress_summary(
  p_company_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
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
$$;
