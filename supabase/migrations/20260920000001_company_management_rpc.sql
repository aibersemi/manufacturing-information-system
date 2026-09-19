-- ==============================================================================
-- Migrasi: 20260920000001_company_management_rpc.sql
-- RPC Helper untuk Manajemen Tenant / Perusahaan (Create, Update, Stats)
-- ==============================================================================

-- 1. Helper function untuk membuat perusahaan baru beserta bootstrap master data lengkap secara atomik
CREATE OR REPLACE FUNCTION public.create_company_with_bootstrap(
  p_code text,
  p_name text,
  p_address text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL
)
RETURNS public.company
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_cleaned_code text;
  v_cleaned_name text;
  v_new_company public.company;
BEGIN
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
$$;

GRANT EXECUTE ON FUNCTION public.create_company_with_bootstrap(text, text, text, text, text) TO authenticated;


-- 2. Helper function untuk memperbarui rincian perusahaan dengan pengawasan code_locked & optimistic versioning
CREATE OR REPLACE FUNCTION public.update_company_details(
  p_company_id uuid,
  p_name text,
  p_code text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_is_active boolean DEFAULT NULL,
  p_expected_version int DEFAULT NULL
)
RETURNS public.company
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_existing public.company;
  v_updated public.company;
  v_cleaned_code text;
  v_cleaned_name text;
BEGIN
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
$$;

GRANT EXECUTE ON FUNCTION public.update_company_details(uuid, text, text, text, text, text, boolean, int) TO authenticated;


-- 3. Helper function untuk mengambil daftar seluruh perusahaan beserta statistik pengguna aktif
CREATE OR REPLACE FUNCTION public.get_companies_with_stats()
RETURNS TABLE (
  id uuid,
  code text,
  name text,
  address text,
  phone text,
  email text,
  logo_storage_key text,
  is_active boolean,
  code_locked boolean,
  version integer,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  assigned_users_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
BEGIN
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
$$;

GRANT EXECUTE ON FUNCTION public.get_companies_with_stats() TO authenticated;
