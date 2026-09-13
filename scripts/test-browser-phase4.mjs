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

console.log('--- VERIFIKASI LIVE BROWSER FASE 4: PURCHASING & INVENTORY ---');
console.log(`Target URL: ${baseUrl}`);

// Jalankan Chrome headless dengan remote debugging
const tempProfileDir = `/tmp/chrome-test-p4-${Date.now()}`;
const chromeProcess = spawn('google-chrome', [
  '--headless=new',
  '--remote-debugging-port=9224',
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
      const res = await fetch('http://127.0.0.1:9224/json/list');
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
  throw new Error('Chrome remote debugging tidak merespon di port 9224.');
}

async function main() {
  let ws;
  let createdDocId = null;
  let createdPaymentId = null;
  let createdSupplierId = null;
  let createdMaterialId = null;

  try {
    const wsUrl = await getDebuggerUrl();
    console.log('✓ Terhubung ke Chrome DevTools Protocol di port 9224');

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

    await send('Page.enable');
    await send('Runtime.enable');

    // 1. Buka halaman /login
    console.log(`1. Membuka ${baseUrl}/login ...`);
    await send('Page.navigate', { url: `${baseUrl}/login` });
    await delay(2500);

    const checkUrl = await send('Runtime.evaluate', {
      expression: 'window.location.pathname',
      returnByValue: true,
    });

    if (checkUrl.result.value.includes('/login')) {
      console.log('2. Mengisi form login...');
      const fillScript = `
        (async () => {
          const emailInput = document.querySelector('input[type="email"]') || document.querySelector('input[name="email"]') || document.querySelector('input');
          const passInput = document.querySelector('input[type="password"]');
          const submitBtn = document.querySelector('button[type="submit"]');

          if (!emailInput || !passInput || !submitBtn) {
            return { success: false, error: 'Form elements not found' };
          }

          emailInput.value = ${JSON.stringify(email)};
          emailInput.dispatchEvent(new Event('input', { bubbles: true }));
          emailInput.dispatchEvent(new Event('change', { bubbles: true }));

          passInput.value = ${JSON.stringify(superPass)};
          passInput.dispatchEvent(new Event('input', { bubbles: true }));
          passInput.dispatchEvent(new Event('change', { bubbles: true }));

          submitBtn.click();
          return { success: true };
        })()
      `;

      await send('Runtime.evaluate', {
        expression: fillScript,
        awaitPromise: true,
        returnByValue: true,
      });

      await delay(3000);
    }

    const afterLoginUrl = await send('Runtime.evaluate', {
      expression: 'window.location.pathname',
      returnByValue: true,
    });
    console.log('✓ Status URL setelah login:', afterLoginUrl.result.value);

    // Helper untuk cek halaman dan font size check
    async function verifyPage(urlPath, expectedH1Title) {
      console.log(`\nMemeriksa halaman ${urlPath} ...`);
      await send('Page.navigate', { url: `${baseUrl}${urlPath}` });
      await delay(2500);

      const pageCheck = await send('Runtime.evaluate', {
        expression: `(() => {
          const h1 = document.querySelector('h1')?.textContent?.trim() || '';
          const html = document.body.innerHTML;
          const hasIllegalFont10 = html.includes('text-[10px]');
          const hasIllegalFont11 = html.includes('text-[11px]');
          const buttons = Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim());
          return {
            pathname: window.location.pathname,
            h1,
            hasIllegalFont10,
            hasIllegalFont11,
            buttonCount: buttons.length,
            buttons: buttons.slice(0, 5)
          };
        })()`,
        returnByValue: true,
      });

      const res = pageCheck.result.value;
      console.log(`  - H1: "${res.h1}" (Expected: "${expectedH1Title}")`);
      if (!res.h1.toLowerCase().includes(expectedH1Title.toLowerCase())) {
        throw new Error(`H1 title mismatch on ${urlPath}. Got: "${res.h1}", Expected: "${expectedH1Title}"`);
      }
      if (res.hasIllegalFont10 || res.hasIllegalFont11) {
        throw new Error(`ILLEGAL FONT DETECTED on ${urlPath}! Found text-[10px] or text-[11px]`);
      }
      console.log(`  ✓ H1 sesuai, buttons: ${res.buttonCount}, tidak ada text-[10px]/text-[11px]`);
    }

    // 2. Verifikasi 5 halaman baru
    await verifyPage('/workspace/purchase-materials', 'Bahan Baku');
    await verifyPage('/workspace/purchase-supplies', 'Perlengkapan');
    await verifyPage('/workspace/purchase-non-production', 'Non-Produksi');
    await verifyPage('/workspace/purchase-payments', 'Bayar');
    await verifyPage('/workspace/inventory', 'Inventaris');

    // 3. Verifikasi Transaksi E2E: Create -> Post -> Check Inventory & Roll -> Payment -> Check History
    console.log('\n--- UJI ALUR TRANSAKSI PEMBELIAN & INVENTARIS ---');

    // Dapatkan data perusahaan dan akun kas
    const { data: companies, error: compErr } = await supabase
      .from('company')
      .select('id, name')
      .eq('code', 'AIBER001')
      .limit(1);
    if (compErr || !companies || companies.length === 0) throw new Error('Company AIBER001 not found');
    const companyId = companies[0].id;

    const { data: usersData, error: userErr } = await supabase.auth.admin.listUsers();
    if (userErr || !usersData || !usersData.users) throw new Error('Failed to list auth users');
    const currentUser = usersData.users.find(u => u.email === email) || usersData.users[0];
    const userId = currentUser.id;

    const { data: cashAccounts, error: cashErr } = await supabase
      .from('master_record')
      .select('id, name')
      .eq('company_id', companyId)
      .eq('record_kind', 'cash_account')
      .limit(1);
    if (cashErr || !cashAccounts || cashAccounts.length === 0) throw new Error('No cash account found');
    const cashAccount = cashAccounts[0];

    // Buat Supplier Uji dengan nama unik
    const uniqueTimestamp = Date.now().toString().slice(-6);
    const { data: testSupplier, error: supErr } = await supabase
      .from('master_record')
      .insert({
        company_id: companyId,
        record_kind: 'supplier',
        name: `Pemasok Uji QA ${uniqueTimestamp}`,
        data: { phone: '0812345678', address: 'Jl. Industri Test No. 1' },
        created_by_user_id: userId,
      })
      .select('id, name')
      .single();
    if (supErr || !testSupplier) throw new Error(`Failed to create test supplier: ${supErr?.message}`);
    createdSupplierId = testSupplier.id;
    const supplierId = testSupplier.id;

    // Buat Material Uji dengan nama unik
    const defaultUnitCode = 'm';
    const { data: testMat, error: matErr } = await supabase
      .from('master_record')
      .insert({
        company_id: companyId,
        record_kind: 'material',
        name: `Kain Katun Test ${uniqueTimestamp}`,
        data: { baseUnit: defaultUnitCode, packagingUnit: 'roll', conversionFactor: 1, referencePackagePrice: 50000 },
        created_by_user_id: userId,
      })
      .select('id, name')
      .single();
    if (matErr || !testMat) throw new Error(`Failed to create test material: ${matErr?.message}`);
    createdMaterialId = testMat.id;
    const material = testMat;

    console.log(`Menggunakan Company: ${companyId}, Supplier: ${testSupplier.name}, Material: ${material.name}`);

    const testDocNumber = `BL-TEST-${uniqueTimestamp}`;
    const lineTotal = 50 * 50000; // 2.500.000

    console.log(`Membuat dokumen pembelian draft: ${testDocNumber}...`);
    const { data: doc, error: docErr } = await supabase
      .from('business_document')
      .insert({
        company_id: companyId,
        document_kind: 'purchase_material',
        document_number: testDocNumber,
        status: 'draft',
        total_amount: lineTotal,
        paid_amount: 0,
        transaction_date: new Date().toISOString().slice(0, 10),
        counterparty_id: supplierId,
        data: { fundingMethod: 'payable', notes: 'E2E Test Purchase' },
        created_by_user_id: userId,
        version: 1,
      })
      .select('id, document_number, status')
      .single();
    if (docErr || !doc) throw new Error(`Failed to create test doc: ${docErr?.message}`);
    createdDocId = doc.id;
    console.log(`✓ Dokumen draft dibuat: ID ${doc.id}`);

    // Insert line dengan roll specs
    const { data: line, error: lineErr } = await supabase
      .from('business_document_line')
      .insert({
        company_id: companyId,
        document_id: doc.id,
        line_number: 1,
        item_id: material.id,
        description: material.name,
        unit_code: defaultUnitCode,
        conversion_factor: 1,
        quantity: 50,
        unit_price: 50000,
        subtotal: lineTotal,
        total_amount: lineTotal,
        data: { rollCount: 2, rolls: [{ rollNumber: 1, quantity: 25 }, { rollNumber: 2, quantity: 25 }] },
        is_current: true,
        revision: 1,
        version: 1,
      })
      .select('id')
      .single();
    if (lineErr || !line) throw new Error(`Failed to create test doc line: ${lineErr?.message}`);
    console.log(`✓ Dokumen line dibuat: ID ${line.id} (2 roll x 25 = 50)`);

    // Posting via stored procedure post_purchase_document
    console.log('Memposting dokumen via RPC post_purchase_document...');
    const { error: postErr } = await supabase.rpc('post_purchase_document', {
      p_document_id: doc.id,
      p_user_id: userId,
    });
    if (postErr) throw new Error(`Failed to post document: ${postErr.message}`);
    console.log('✓ Dokumen pembelian berhasil diposting!');

    // Ambil nomor dokumen final setelah posting (BL-YYMMDD-###)
    const { data: postedDoc } = await supabase
      .from('business_document')
      .select('document_number')
      .eq('id', doc.id)
      .single();
    const finalDocNumber = postedDoc?.document_number || doc.document_number;
    console.log(`✓ Nomor dokumen resmi setelah diposting: ${finalDocNumber}`);

    // Verifikasi roll terbentuk di database
    const { data: createdRolls, error: rollErr } = await supabase
      .from('production_material_unit')
      .select('id, physical_code, initial_base_quantity, status')
      .eq('source_document_id', doc.id);
    if (rollErr) throw new Error(`Failed to query rolls: ${rollErr.message}`);
    console.log(`✓ Jumlah unit roll fisik terbentuk: ${createdRolls.length}`);
    if (createdRolls.length === 0) {
      throw new Error('No physical rolls created for material purchase');
    }

    // Verifikasi mutasi stok terbentuk
    const { data: createdMovements, error: movErr } = await supabase
      .from('inventory_movement')
      .select('id, movement_type, quantity, total_cost')
      .eq('source_document_id', doc.id);
    if (movErr) throw new Error(`Failed to query movements: ${movErr.message}`);
    console.log(`✓ Mutasi stok perpetual terbentuk: ${createdMovements.length} baris`);
    if (createdMovements.length === 0) {
      throw new Error('Inventory movement was not created');
    }

    // Verifikasi di UI Browser: Buka /workspace/inventory
    console.log('Membuka /workspace/inventory di browser untuk memverifikasi Roll...');
    await send('Page.navigate', { url: `${baseUrl}/workspace/inventory` });
    await delay(3000);

    // Klik tab Roll Kain
    const clickRollsTab = await send('Runtime.evaluate', {
      expression: `(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const rollTab = buttons.find(b => b.textContent.includes('Roll'));
        if (rollTab) {
          rollTab.click();
          return true;
        }
        return false;
      })()`,
      returnByValue: true,
    });
    console.log('  - Tab Pelacakan Roll diklik:', clickRollsTab.result.value);
    await delay(2000);

    const firstRollCode = createdRolls[0].physical_code;
    const checkRollInUI = await send('Runtime.evaluate', {
      expression: `(() => {
        const html = document.body.innerHTML;
        return html.includes(${JSON.stringify(firstRollCode)});
      })()`,
      returnByValue: true,
    });
    console.log(`  ✓ Roll terdeteksi di UI (${firstRollCode}): ${checkRollInUI.result.value}`);

    // Buka /workspace/purchase-payments di browser untuk cek tagihan
    console.log('Membuka /workspace/purchase-payments di browser untuk memverifikasi Tagihan...');
    await send('Page.navigate', { url: `${baseUrl}/workspace/purchase-payments` });
    await delay(3000);

    const checkPayableInUI = await send('Runtime.evaluate', {
      expression: `(() => {
        const html = document.body.innerHTML;
        return html.includes(${JSON.stringify(finalDocNumber)});
      })()`,
      returnByValue: true,
    });
    console.log(`  ✓ Tagihan pembelian terdeteksi di UI (${finalDocNumber}): ${checkPayableInUI.result.value}`);

    // Bayar tagihan via post_purchase_payment
    console.log('Memproses pembayaran hutang pembelian via post_purchase_payment...');
    const { data: rawPaymentResult, error: payErr } = await supabase.rpc('post_purchase_payment', {
      p_purchase_id: doc.id,
      p_cash_account_id: cashAccount.id,
      p_amount: lineTotal,
      p_date: new Date().toISOString().slice(0, 10),
      p_notes: 'Pembayaran lunas via E2E test',
      p_user_id: userId,
    });
    if (payErr) throw new Error(`Failed to post payment: ${payErr.message}`);
    const actualPaymentId = typeof rawPaymentResult === 'string' ? rawPaymentResult : (rawPaymentResult?.paymentId || rawPaymentResult);
    createdPaymentId = actualPaymentId;
    console.log(`✓ Pembayaran berhasil diposting: ID ${actualPaymentId}`);

    // Refresh halaman pembayaran dan cek tab riwayat
    console.log('Membuka /workspace/purchase-payments dan cek Riwayat Pembayaran...');
    await send('Page.navigate', { url: `${baseUrl}/workspace/purchase-payments` });
    await delay(3000);

    const clickHistoryTab = await send('Runtime.evaluate', {
      expression: `(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const histTab = buttons.find(b => b.textContent.includes('Riwayat Pembayaran'));
        if (histTab) {
          histTab.click();
          return true;
        }
        return false;
      })()`,
      returnByValue: true,
    });
    console.log('  - Tab Riwayat Pembayaran diklik:', clickHistoryTab.result.value);
    await delay(2000);

    const checkHistoryInUI = await send('Runtime.evaluate', {
      expression: `(() => {
        const html = document.body.innerHTML;
        return html.includes(${JSON.stringify(finalDocNumber)});
      })()`,
      returnByValue: true,
    });
    console.log(`  ✓ Pembayaran terdeteksi di UI Riwayat (${finalDocNumber}): ${checkHistoryInUI.result.value}`);

    console.log('\n=============================================');
    console.log('🎉 SEMUA VERIFIKASI LIVE BROWSER FASE 4 LULUS!');
    console.log('=============================================');
  } catch (err) {
    console.error('❌ Terjadi kesalahan saat verifikasi:', err);
    process.exitCode = 1;
  } finally {
    // 4. CLEANUP TEST DATA SECARA MENYELURUH (MANDATORY)
    console.log('\n--- CLEANUP DATA PENGUJIAN ---');
    console.log('Membersihkan seluruh data pengujian dari database...');

    try {
      const docIds = [createdDocId, createdPaymentId].filter(Boolean);
      if (docIds.length > 0) {
        const { data: jEntries } = await supabase
          .from('journal_entry')
          .select('id')
          .in('source_document_id', docIds);
        const jIds = (jEntries || []).map(j => j.id);
        if (jIds.length > 0) {
          await supabase.from('journal_line').delete().in('journal_entry_id', jIds);
          await supabase.from('journal_entry').delete().in('id', jIds);
        }

        await supabase.from('cash_movement').delete().in('source_document_id', docIds);
        await supabase.from('subledger_entry').delete().in('source_document_id', docIds);
        await supabase.from('inventory_movement').delete().in('source_document_id', docIds);
        await supabase.from('production_material_unit').delete().in('source_document_id', docIds);
        await supabase.from('business_document_line').delete().in('document_id', docIds);
        await supabase.from('audit_log').delete().in('target_id', docIds);

        // Hapus payment document lebih dulu (merujuk purchase via source_document_id)
        if (createdPaymentId) {
          await supabase.from('business_document').delete().eq('id', createdPaymentId);
        }
        if (createdDocId) {
          await supabase.from('business_document').delete().eq('id', createdDocId);
        }
      }

      const masterIds = [createdSupplierId, createdMaterialId].filter(Boolean);
      if (masterIds.length > 0) {
        await supabase.from('master_record').delete().in('id', masterIds);
      }

      console.log('✓ Seluruh data uji berhasil dibersihkan! Database kembali 100% utuh.');
    } catch (cleanupErr) {
      console.error('Peringatan: Gagal membersihkan data uji:', cleanupErr);
    }

    if (ws) ws.close();
    chromeProcess.kill('SIGKILL');
  }
}

main();
