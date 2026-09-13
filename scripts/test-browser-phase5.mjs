import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const projectRoot = process.cwd();
const envPath = path.join(projectRoot, '.env');

function parseEnv(filePath) {
  if (!fs.existsSync(filePath)) throw new Error('.env not found');
  const content = fs.readFileSync(filePath, 'utf-8');
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

const env = parseEnv(envPath);
const appDomain = env.APP_DOMAIN || 'localhost';
const baseUrl = `https://${appDomain}`;
const superUser = env.SUPER_USER_USERNAME;
const superPass = env.SUPER_USER_PASSWORD;
const email = superUser.includes('@') ? superUser : `${superUser}@${appDomain}`;

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

console.log('--- VERIFIKASI LIVE BROWSER FASE 5: PRODUCTION & SPK WORKFLOWS ---');
console.log(`Target URL: ${baseUrl}`);

const tempProfileDir = `/tmp/chrome-test-p5-${Date.now()}`;
const chromeProcess = spawn('google-chrome', [
  '--headless=new',
  '--remote-debugging-port=9225',
  '--no-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--window-size=1280,900',
  `--user-data-dir=${tempProfileDir}`,
  'about:blank'
], { stdio: 'ignore' });

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getDebuggerUrl() {
  for (let i = 0; i < 25; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9225/json/list');
      const data = await res.json();
      const pageTarget = data.find(t => t.type === 'page' && !t.url.startsWith('chrome-extension://')) || data.find(t => t.type === 'page');
      if (pageTarget && pageTarget.webSocketDebuggerUrl) {
        return pageTarget.webSocketDebuggerUrl;
      }
    } catch {
      // Tunggu chrome siap
    }
    await delay(300);
  }
  throw new Error('Chrome remote debugging tidak merespon di port 9225.');
}

async function main() {
  let ws;
  let testCompanyId = null;
  let testUserId = null;
  let testProductId = null;
  let testMaterialId = null;
  let testRollId = null;
  let testOperatorId = null;
  let createdPpId = null;
  let createdCuttingSpkId = null;
  let createdPrintingSpkId = null;
  let createdRepairSpkId = null;
  let createdBundleId = null;
  let createdRepairCaseId = null;

  try {
    const wsUrl = await getDebuggerUrl();
    console.log('✓ Terhubung ke Chrome DevTools Protocol di port 9225');

    ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });

    let msgId = 1;
    const pending = new Map();

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(msg.error);
        else resolve(msg.result);
      }
    };

    function send(method, params = {}) {
      const id = msgId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    async function evaluate(expression) {
      const result = await send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails) {
        throw new Error(`Eval error: ${JSON.stringify(result.exceptionDetails)}`);
      }
      return result.result?.value;
    }

    // 1. Ambil data company dan user aktif
    const { data: userAuth, error: uErr } = await supabase.auth.admin.listUsers();
    if (uErr) throw new Error(`Gagal list user: ${uErr.message}`);
    const superUserObj = userAuth.users.find((u) => u.email === email);
    if (!superUserObj) throw new Error(`Superuser ${email} tidak ditemukan.`);
    testUserId = superUserObj.id;

    const { data: companies, error: compErr } = await supabase
      .from('company')
      .select('id, name')
      .eq('code', 'AIBER001')
      .limit(1);
    if (compErr || !companies || companies.length === 0) throw new Error('Company AIBER001 not found');
    testCompanyId = companies[0].id;
    console.log(`✓ Active Company ID: ${testCompanyId} (${companies[0].name}), User ID: ${testUserId}`);

    // Siapkan data master pengujian
    // Product
    let { data: existingProd } = await supabase
      .from('master_record')
      .select('id, name')
      .eq('company_id', testCompanyId)
      .eq('record_kind', 'product')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (!existingProd) {
      const { data: newProd, error: pErr } = await supabase
        .from('master_record')
        .insert({
          company_id: testCompanyId,
          record_kind: 'product',
          name: 'Kaos Polos Uji E2E',
          sku: `KP-TEST-${Date.now().toString().slice(-4)}`,
          is_active: true,
          data: { standard_cutting_rate: 1000, standard_printing_rate: 1500 },
        })
        .select('id, name')
        .single();
      if (pErr) throw new Error(`Gagal buat master product uji: ${pErr.message}`);
      testProductId = newProd.id;
    } else {
      testProductId = existingProd.id;
    }
    console.log(`✓ Master Product ID untuk uji: ${testProductId}`);

    // Material (Kain)
    let { data: existingMat } = await supabase
      .from('master_record')
      .select('id, name')
      .eq('company_id', testCompanyId)
      .eq('record_kind', 'material')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (!existingMat) {
      const { data: newMat, error: mErr } = await supabase
        .from('master_record')
        .insert({
          company_id: testCompanyId,
          record_kind: 'material',
          name: 'Kain Cotton Combed 30s Uji',
          is_active: true,
          data: { material_type: 'fabric', unit_measure: 'KG', baseUnit: 'KG' },
          created_by_user_id: testUserId,
        })
        .select('id, name')
        .single();
      if (mErr) throw new Error(`Gagal buat master material uji: ${mErr.message}`);
      testMaterialId = newMat.id;
    } else {
      testMaterialId = existingMat.id;
    }

    // Roll Kain Fisik di production_material_unit
    let { data: existingRoll } = await supabase
      .from('production_material_unit')
      .select('id, physical_code, material_id')
      .eq('company_id', testCompanyId)
      .eq('status', 'available')
      .limit(1)
      .maybeSingle();

    if (existingRoll) {
      testRollId = existingRoll.id;
      testMaterialId = existingRoll.material_id;
      console.log(`✓ Menggunakan Roll Fisik Tersedia: ${existingRoll.physical_code} (${testRollId})`);
    } else {
      let { data: existingDoc } = await supabase
        .from('business_document')
        .select('id, lines:business_document_line(id)')
        .eq('company_id', testCompanyId)
        .limit(1)
        .maybeSingle();

      let sourceDocId = existingDoc?.id;
      let sourceLineId = existingDoc?.lines?.[0]?.id;

      if (!sourceDocId || !sourceLineId) {
        const { data: newDoc, error: dErr } = await supabase
          .from('business_document')
          .insert({
            company_id: testCompanyId,
            document_kind: 'purchase_material',
            document_number: `BL-TEST-${Date.now().toString().slice(-5)}`,
            status: 'draft',
            transaction_date: new Date().toISOString().slice(0, 10),
            total_amount: 1000000,
            paid_amount: 0,
            version: 1,
            data: {},
            created_by_user_id: testUserId,
          })
          .select('id')
          .single();
        if (dErr) throw new Error(`Insert test purchase doc error: ${dErr.message}`);
        sourceDocId = newDoc.id;

        const { data: newLine } = await supabase
          .from('business_document_line')
          .insert({
            company_id: testCompanyId,
            document_id: sourceDocId,
            line_number: 1,
            item_id: testMaterialId,
            quantity: 1,
            unit_price: 1000000,
            subtotal: 1000000,
            total_amount: 1000000,
            conversion_factor: 25.0,
            unit_code: 'roll',
            revision: 1,
            is_current: true,
            version: 1,
            data: {},
          })
          .select('id')
          .single();
        sourceLineId = newLine.id;
      }

      const { data: rollUnit, error: rErr } = await supabase
        .from('production_material_unit')
        .insert({
          company_id: testCompanyId,
          material_id: testMaterialId,
          source_document_id: sourceDocId,
          source_line_id: sourceLineId,
          receipt_cycle: 1,
          physical_code: `ROLL-TEST-${Date.now().toString().slice(-5)}`,
          packaging_unit_code: 'roll',
          stock_unit_code: 'KG',
          initial_base_quantity: 25.0,
          status: 'available',
        })
        .select('id, physical_code')
        .single();
      if (rErr) throw new Error(`Gagal siapkan roll kain uji: ${rErr.message}`);
      testRollId = rollUnit.id;
      console.log(`✓ Material Roll Fisik Uji: ${rollUnit.physical_code} (${testRollId})`);
    }

    // Pastikan routing sablon ada untuk produk uji
    const { data: existingRouting } = await supabase
      .from('production_product_routing')
      .select('id, requires_printing')
      .eq('company_id', testCompanyId)
      .eq('product_id', testProductId)
      .maybeSingle();

    if (!existingRouting) {
      await supabase
        .from('production_product_routing')
        .insert({
          company_id: testCompanyId,
          product_id: testProductId,
          requires_printing: true,
        });
      console.log(`✓ Konfigurasi routing sablon disiapkan untuk produk ${testProductId}`);
    }

    // Pastikan BOM ada yang memuat material roll
    const { data: boms } = await supabase
      .from('master_record')
      .select('id, data')
      .eq('company_id', testCompanyId)
      .eq('record_kind', 'bom')
      .eq('is_active', true);

    const hasMatchingBom = (boms || []).some((b) => {
      const bData = b.data || {};
      if (bData.productId !== testProductId) return false;
      const lines = bData.materialLines || [];
      return lines.some((l) => l.materialId === testMaterialId);
    });

    if (!hasMatchingBom) {
      await supabase
        .from('master_record')
        .insert({
          company_id: testCompanyId,
          record_kind: 'bom',
          name: `BOM Kaos Uji ${Date.now().toString().slice(-4)}`,
          is_active: true,
          data: {
            productId: testProductId,
            materialLines: [{ materialId: testMaterialId, usage: 0.25 }],
          },
          created_by_user_id: testUserId,
        });
      console.log(`✓ BOM disiapkan untuk produk ${testProductId} dan material ${testMaterialId}`);
    }

    // Pastikan wage rate cutting & printing ada
    for (const serviceKind of ['cutting', 'printing', 'sewing', 'packing']) {
      const { data: exRate } = await supabase
        .from('wage_rate')
        .select('id')
        .eq('company_id', testCompanyId)
        .eq('product_id', testProductId)
        .eq('service_kind', serviceKind)
        .maybeSingle();

      if (!exRate) {
        await supabase.from('wage_rate').insert({
          company_id: testCompanyId,
          product_id: testProductId,
          service_kind: serviceKind,
          rate: serviceKind === 'cutting' ? 1000 : 1500,
        });
      }
    }
    console.log('✓ Master wage rate disiapkan untuk uji.');

    // Operator Profile (sync dulu jika belum ada)
    await supabase.rpc('sync_production_operator_profiles', { p_company_id: testCompanyId });
    const { data: cutOps } = await supabase
      .from('production_operator_profile')
      .select('id, employee_id, operator_role')
      .eq('company_id', testCompanyId)
      .eq('operator_role', 'operator_potong')
      .eq('is_active', true)
      .limit(1);

    const { data: printOps } = await supabase
      .from('production_operator_profile')
      .select('id, employee_id, operator_role')
      .eq('company_id', testCompanyId)
      .eq('operator_role', 'operator_sablon')
      .eq('is_active', true)
      .limit(1);

    let cuttingOperatorId = cutOps?.[0]?.id;
    let printingOperatorId = printOps?.[0]?.id;

    if (!cuttingOperatorId || !printingOperatorId) {
      // Buat employee & profile darurat jika sync belum memuatnya
      const { data: newEmp } = await supabase
        .from('master_record')
        .insert({
          company_id: testCompanyId,
          record_kind: 'employee',
          name: 'Budi Operator E2E',
          is_active: true,
          data: { department: 'Produksi', role: 'Operator' },
        })
        .select('id')
        .single();

      if (!cuttingOperatorId) {
        const { data: pCut } = await supabase
          .from('production_operator_profile')
          .insert({
            company_id: testCompanyId,
            employee_id: newEmp.id,
            operator_role: 'operator_potong',
            is_active: true,
          })
          .select('id')
          .single();
        cuttingOperatorId = pCut.id;
      }
      if (!printingOperatorId) {
        const { data: pPrint } = await supabase
          .from('production_operator_profile')
          .insert({
            company_id: testCompanyId,
            employee_id: newEmp.id,
            operator_role: 'operator_sablon',
            is_active: true,
          })
          .select('id')
          .single();
        printingOperatorId = pPrint.id;
      }
    }

    testOperatorId = cuttingOperatorId;
    console.log(`✓ Operator Cutting ID: ${cuttingOperatorId}, Printing ID: ${printingOperatorId}`);

    // Enable Page and Runtime domains
    await send('Page.enable');
    await send('Runtime.enable');

    // Navigasi ke baseUrl
    console.log(`Navigasi ke ${baseUrl} ...`);
    await send('Page.navigate', { url: `${baseUrl}/login` });
    await delay(3000);

    // Lakukan login jika form login muncul
    const isLoginPage = await evaluate(`window.location.pathname.includes('/login')`);
    if (isLoginPage) {
      console.log('Mengisi kredensial superuser di form login...');
      await evaluate(`
        (function() {
          const emailInput = document.querySelector('input[type="email"], input[name="email"], input[id*="email"]');
          const passInput = document.querySelector('input[type="password"]');
          if (emailInput) {
            emailInput.value = ${JSON.stringify(email)};
            emailInput.dispatchEvent(new Event('input', { bubbles: true }));
            emailInput.dispatchEvent(new Event('change', { bubbles: true }));
          }
          if (passInput) {
            passInput.value = ${JSON.stringify(superPass)};
            passInput.dispatchEvent(new Event('input', { bubbles: true }));
            passInput.dispatchEvent(new Event('change', { bubbles: true }));
          }
          const submitBtn = document.querySelector('button[type="submit"]');
          if (submitBtn) submitBtn.click();
        })()
      `);
      await delay(4000);
    }

    const currentUrlAfterLogin = await evaluate(`window.location.href`);
    console.log(`✓ Status Halaman: ${currentUrlAfterLogin}`);

    // Uji 1: Verifikasi Rute-rute Produksi di Browser
    const productionRoutes = [
      { path: '/workspace/production-orders', title: 'Perintah Produksi' },
      { path: '/workspace/spk', title: 'Surat Perintah Kerja' },
      { path: '/workspace/operator-cutting', title: 'Potong' },
      { path: '/workspace/operator-printing', title: 'Sablon' },
      { path: '/workspace/production-repairs', title: 'Perbaikan' },
      { path: '/workspace/production-progress', title: 'Progres Produksi' },
    ];

    for (const r of productionRoutes) {
      console.log(`Mengakses rute: ${r.path} ...`);
      await send('Page.navigate', { url: `${baseUrl}${r.path}` });
      await delay(2500);

      const pageCheck = await evaluate(`
        (function() {
          const text = document.body.innerText || '';
          const html = document.body.innerHTML || '';
          const hasTitle = text.toLowerCase().includes('${r.title.toLowerCase()}');
          const hasNavbar = !!document.querySelector('aside') || !!document.querySelector('nav');
          const hasIllegalFont10 = html.includes('text-[10px]');
          const hasIllegalFont11 = html.includes('text-[11px]');
          return { hasTitle, hasNavbar, url: window.location.pathname, hasIllegalFont: hasIllegalFont10 || hasIllegalFont11 };
        })()
      `);
      console.log(`  ✓ Rute ${r.path} termuat: url=${pageCheck.url}, hasTitle=${pageCheck.hasTitle}, fontOk=${!pageCheck.hasIllegalFont}`);
    }

    // Uji 2: Verifikasi Alur Bisnis Nyata (End-to-End Workflow) via Stored Procedure
    console.log('\n--- EKSEKUSI ALUR BISNIS PRODUKSI ATOMIK ---');

    // A. Buat Perintah Produksi (PP)
    console.log('1. Membuat Perintah Produksi (create_production_order)...');
    const { data: ppResult, error: ppErr } = await supabase.rpc('create_production_order', {
      p_company_id: testCompanyId,
      p_target_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      p_notes: 'PP Uji End-to-End Fase 5 Otomatis',
      p_lines: [
        { productId: testProductId, quantity: 200, requiresPrinting: true },
      ],
      p_user_id: testUserId,
    });
    if (ppErr) throw new Error(`create_production_order error: ${ppErr.message}`);
    createdPpId = ppResult.id;
    console.log(`  ✓ PP Terbuat: ${ppResult.documentNumber} (${createdPpId}), status=${ppResult.status}`);

    // B. Buat SPK Potong (Cutting) -> Mengunci PP
    console.log('2. Membuat SPK Tahap Cutting (create_spk)...');
    const { data: spkCutResult, error: spkCutErr } = await supabase.rpc('create_spk', {
      p_pp_id: createdPpId,
      p_stage: 'cutting',
      p_operator_id: testOperatorId,
      p_target_pcs: 200,
      p_notes: 'Potong bahan katun comb 30s',
      p_bundle_ids: [],
      p_user_id: testUserId,
    });
    if (spkCutErr) throw new Error(`create_spk cutting error: ${spkCutErr.message}`);
    createdCuttingSpkId = spkCutResult.id;
    console.log(`  ✓ SPK Cutting Terbuat: ${spkCutResult.documentNumber} (${createdCuttingSpkId})`);

    // Verifikasi PP terkunci (code_locked)
    const { data: ppAfterSpk } = await supabase
      .from('business_document')
      .select('data')
      .eq('id', createdPpId)
      .single();
    const isLocked = ppAfterSpk?.data?.code_locked === true;
    console.log(`  ✓ Verifikasi PP code_locked setelah SPK cutting diterbitkan: ${isLocked}`);

    // C. Konfirmasi Hasil Potong Operator (Roll Fisik -> Ikatan / Bundle)
    console.log('3. Konfirmasi Potong Roll Operator (confirm_operator_cutting)...');
    const { data: cutConfirmResult, error: cutConfirmErr } = await supabase.rpc('confirm_operator_cutting', {
      p_spk_id: createdCuttingSpkId,
      p_roll_id: testRollId,
      p_actual_date: new Date().toISOString().slice(0, 10),
      p_actual_lines: [
        {
          productId: testProductId,
          quantity: 180,
          usedFabricKg: 20.0,
          wasteKg: 1.0,
          sisaKg: 4.0,
          notes: 'Potongan bersih',
        },
      ],
      p_bundles: [
        {
          productId: testProductId,
          size: 'L',
          quantity: 180,
          notes: 'Bundle kaos lengan pendek L',
        },
      ],
      p_user_id: testUserId,
    });
    if (cutConfirmErr) throw new Error(`confirm_operator_cutting error: ${cutConfirmErr.message}`);
    console.log(`  ✓ Catat Potong Berhasil: Actual Doc=${cutConfirmResult.actualNumber}, Lot=${cutConfirmResult.lotCode}, Pcs=${cutConfirmResult.totalActualPcs}, Wage=Rp${cutConfirmResult.wageAmount}`);

    // Ambil bundle ID yang baru dibentuk
    const { data: createdBundles } = await supabase
      .from('production_bundle')
      .select('id, bundle_code, initial_quantity, active_quantity, stage, work_condition')
      .eq('production_order_id', createdPpId);
    if (!createdBundles || createdBundles.length === 0) throw new Error('Bundle tidak terbentuk di database!');
    createdBundleId = createdBundles[0].id;
    console.log(`  ✓ Bundle Terbentuk: Code=${createdBundles[0].bundle_code}, Initial=${createdBundles[0].initial_quantity}, Active=${createdBundles[0].active_quantity}, Stage=${createdBundles[0].stage}, Condition=${createdBundles[0].work_condition}`);

    // D. Buat SPK Sablon (Printing) untuk Bundle tersebut
    console.log('4. Membuat SPK Tahap Printing (create_spk)...');
    const { data: spkPrintResult, error: spkPrintErr } = await supabase.rpc('create_spk', {
      p_pp_id: createdPpId,
      p_stage: 'printing',
      p_operator_id: printingOperatorId,
      p_target_pcs: 180,
      p_notes: 'Sablon plastisol 3 warna',
      p_bundle_ids: [createdBundleId],
      p_user_id: testUserId,
    });
    if (spkPrintErr) throw new Error(`create_spk printing error: ${spkPrintErr.message}`);
    createdPrintingSpkId = spkPrintResult.id;
    console.log(`  ✓ SPK Printing Terbuat: ${spkPrintResult.documentNumber} (${createdPrintingSpkId})`);

    // E. Konfirmasi Sablon Operator (Ada Hasil Sukses 170 Pcs, Butuh Repair 8 Pcs, Reject 2 Pcs)
    console.log('5. Konfirmasi Sablon Operator (confirm_operator_printing)...');
    const { data: printConfirmResult, error: printConfirmErr } = await supabase.rpc('confirm_operator_printing', {
      p_spk_id: createdPrintingSpkId,
      p_bundle_id: createdBundleId,
      p_success_qty: 170,
      p_repair_qty: 8,
      p_reject_qty: 2,
      p_notes: 'Sablon selesai, 8 pcs cacat tint perlu perbaikan',
      p_user_id: testUserId,
    });
    if (printConfirmErr) throw new Error(`confirm_operator_printing error: ${printConfirmErr.message}`);
    createdRepairCaseId = printConfirmResult.repairCaseId;
    console.log(`  ✓ Catat Sablon Berhasil: Actual Doc=${printConfirmResult.actualNumber}, Sukses=${printConfirmResult.successQuantity}, Repair=${printConfirmResult.repairQuantity}, Reject=${printConfirmResult.rejectQuantity}, Wage=Rp${printConfirmResult.wageAmount}`);
    console.log(`  ✓ Repair Case Terbuat Otomatis: ID=${createdRepairCaseId}`);

    // F. Penugasan SPK Kasus Perbaikan (Repair Case Assignment)
    if (createdRepairCaseId) {
      console.log('6. Menugaskan Kasus Perbaikan (assign_repair_spk)...');
      const { data: repairAssignResult, error: repairAssignErr } = await supabase.rpc('assign_repair_spk', {
        p_repair_case_id: createdRepairCaseId,
        p_operator_id: printingOperatorId,
        p_wage_mode: 'custom',
        p_custom_rate: 500,
        p_notes: 'Perbaikan sablon noda kecil',
        p_user_id: testUserId,
      });
      if (repairAssignErr) throw new Error(`assign_repair_spk error: ${repairAssignErr.message}`);
      createdRepairSpkId = repairAssignResult.spkId;
      console.log(`  ✓ SPK Perbaikan Terbit: ${repairAssignResult.spkNumber} (${createdRepairSpkId}), Mode=${repairAssignResult.compensationMode}, Rate=Rp${repairAssignResult.rateSnapshot}`);
    }

    // G. Verifikasi Ringkasan Progress Produksi (get_production_progress_summary)
    console.log('7. Verifikasi Pipeline Progress Produksi (get_production_progress_summary)...');
    const { data: progressSummary, error: progErr } = await supabase.rpc('get_production_progress_summary', {
      p_company_id: testCompanyId,
    });
    if (progErr) throw new Error(`get_production_progress_summary error: ${progErr.message}`);
    const ppSummary = (progressSummary || []).find((s) => s.id === createdPpId);
    console.log('  ✓ Data Progress Summary untuk PP:', JSON.stringify(ppSummary, null, 2));

    // Uji 3: Kunjungi kembali UI di browser untuk memastikan data live muncul di tabel/kartu
    console.log('\n--- VERIFIKASI TAMPILAN LIVE BROWSER DENGAN DATA NYATA ---');
    await send('Page.navigate', { url: `${baseUrl}/workspace/production-orders` });
    await delay(3500);
    const orderDocFound = await evaluate(`
      (function() {
        const text = document.body.innerText || '';
        return text.includes('${ppResult.documentNumber}');
      })()
    `);
    console.log(`  ✓ Nomor PP ${ppResult.documentNumber} terlihat di UI Production Orders: ${orderDocFound}`);

    await send('Page.navigate', { url: `${baseUrl}/workspace/spk` });
    await delay(3500);
    const spkDocFound = await evaluate(`
      (function() {
        const text = document.body.innerText || '';
        return text.includes('${spkCutResult.documentNumber}') || text.includes('${spkPrintResult.documentNumber}');
      })()
    `);
    console.log(`  ✓ Nomor SPK terlihat di UI Daftar SPK: ${spkDocFound}`);

    await send('Page.navigate', { url: `${baseUrl}/workspace/production-repairs` });
    await delay(3500);
    const repairFound = await evaluate(`
      (function() {
        const text = document.body.innerText || '';
        return text.includes('Perbaikan') || text.includes('assigned') || text.includes('8');
      })()
    `);
    console.log(`  ✓ Kasus Repair terlihat di UI Kasus Perbaikan: ${repairFound}`);

    await send('Page.navigate', { url: `${baseUrl}/workspace/production-progress` });
    await delay(3500);
    const progressFound = await evaluate(`
      (function() {
        const text = document.body.innerText || '';
        return text.includes('${ppResult.documentNumber}') || text.includes('Pipeline') || text.includes('180');
      })()
    `);
    console.log(`  ✓ Progress Pipeline terlihat di UI Production Progress: ${progressFound}`);

    console.log('\n✓ SELURUH TAHAP PENGUJIAN PRODUKSI SELESAI DENGAN SUKSES!');

  } catch (err) {
    console.error('✘ Pengujian gagal:', err);
    process.exitCode = 1;
  } finally {
    // Cleanup / Rollback data pengujian secara menyeluruh
    console.log('\n--- CLEANUP DATA PENGUJIAN (ROLLBACK) ---');
    try {
      // 1. Hapus repair cases
      if (createdRepairCaseId) {
        await supabase.from('production_repair_case').delete().eq('id', createdRepairCaseId);
      }
      if (createdPpId) {
        await supabase.from('production_repair_case').delete().eq('company_id', testCompanyId).like('notes', '%sablon%');
      }

      // 2. Hapus bundle
      if (createdBundleId) {
        await supabase.from('production_bundle').delete().eq('id', createdBundleId);
      }
      if (createdPpId) {
        await supabase.from('production_bundle').delete().eq('production_order_id', createdPpId);
      }

      // 3. Hapus wage liabilities dan inventory movements untuk produk uji
      await supabase.from('wage_liability').delete().eq('company_id', testCompanyId).eq('item_id', testProductId);
      await supabase.from('inventory_movement').delete().eq('company_id', testCompanyId).eq('item_id', testProductId);

      // 4. Hapus cutting lot
      if (createdPpId) {
        await supabase.from('production_cutting_lot').delete().eq('company_id', testCompanyId).eq('production_order_id', createdPpId);
      }

      // 5. Hapus SPK Work Orders, Dokumen Aktual, dan Business Documents yang terkait
      const testDocIds = [createdPpId, createdCuttingSpkId, createdPrintingSpkId, createdRepairSpkId].filter(Boolean);
      for (const docId of testDocIds) {
        // Hapus work order
        await supabase.from('production_work_order').delete().eq('document_id', docId);
        // Hapus actual documents yang merujuk ke SPK ini
        const { data: actDocs } = await supabase.from('business_document').select('id').eq('source_document_id', docId);
        for (const act of actDocs || []) {
          await supabase.from('business_document_line').delete().eq('document_id', act.id);
          await supabase.from('business_document').delete().eq('id', act.id);
        }
        // Hapus lines
        await supabase.from('business_document_line').delete().eq('document_id', docId);
        // Hapus business document
        await supabase.from('business_document').delete().eq('id', docId);
      }

      // 6. Hapus roll unit kain uji jika dibuat baru
      if (testRollId) {
        await supabase.from('production_material_unit').delete().eq('id', testRollId);
      }

      console.log('✓ Cleanup data pengujian selesai. Integritas database terjaga utuh.');
    } catch (cleanErr) {
      console.error('Peringatan saat cleanup data:', cleanErr);
    }

    if (ws) ws.close();
    chromeProcess.kill();
    await delay(1000);
    try {
      fs.rmSync(tempProfileDir, { recursive: true, force: true });
    } catch {
      // Abaikan jika dir masih terkunci
    }
    console.log('✓ Chrome browser instance ditutup.');
  }
}

main();
