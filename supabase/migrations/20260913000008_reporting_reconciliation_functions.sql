-- ==============================================================================
-- Migrasi 000008: Stored Procedures Financial Reporting, HPP & Reconciliation (Fase 9)
-- ==============================================================================

-- 1. Neraca Saldo Berpasangan (Trial Balance)
CREATE OR REPLACE FUNCTION public.get_trial_balance(
  p_company_id uuid,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

-- 2. Laporan Laba Rugi Komprehensif (Profit & Loss)
CREATE OR REPLACE FUNCTION public.get_profit_loss(
  p_company_id uuid,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

-- 3. Laporan Posisi Keuangan (Balance Sheet)
CREATE OR REPLACE FUNCTION public.get_balance_sheet(
  p_company_id uuid,
  p_date_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

-- 4. Laporan Arus Kas Metode Langsung (Cash Flow Statement - Direct Method)
CREATE OR REPLACE FUNCTION public.get_cash_flow_statement(
  p_company_id uuid,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

-- 5. Buku Besar Akun (General Ledger Entries & Running Balance)
CREATE OR REPLACE FUNCTION public.get_general_ledger_entries(
  p_company_id uuid,
  p_account_id uuid,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

-- 6. Laporan HPP Manufaktur & Analisis Biaya Produksi (HPP Manufacturing Summary)
CREATE OR REPLACE FUNCTION public.get_hpp_manufacturing_summary(
  p_company_id uuid,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

-- 7. Rekonsiliasi Audit Subledger-to-GL (Accounting Reconciliation Summary)
CREATE OR REPLACE FUNCTION public.get_accounting_reconciliation_summary(
  p_company_id uuid,
  p_as_of_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
  -- Validasi Perusahaan
  SELECT EXISTS (SELECT 1 FROM public.company WHERE id = p_company_id) INTO v_company_exists;
  IF NOT v_company_exists THEN
    RAISE EXCEPTION 'Perusahaan dengan ID % tidak ditemukan.', p_company_id;
  END IF;

  v_as_of_date := coalesce(p_as_of_date, (now() AT TIME ZONE 'Asia/Jakarta')::date);

  -- 1. Pos Kas & Bank
  SELECT coalesce(sum(amount), 0)
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
  SELECT coalesce(sum(amount), 0)
  INTO v_ar_subledger
  FROM public.subledger_entry
  WHERE company_id = p_company_id
    AND subledger_kind = 'receivable'
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
  SELECT coalesce(sum(amount), 0)
  INTO v_ap_subledger
  FROM public.subledger_entry
  WHERE company_id = p_company_id
    AND subledger_kind = 'supplier_payable'
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
    AND je.transaction_date <= v_as_of_date
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
$$;
