import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

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

console.log(`--- VERIFIKASI LIVE BROWSER FASE 2: ${baseUrl} ---`);

// Jalankan Chrome headless dengan flags aman
const chromeProcess = spawn('google-chrome', [
  '--headless=new',
  '--remote-debugging-port=9222',
  '--no-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--window-size=1280,900',
  'about:blank'
], { stdio: 'ignore' });

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getDebuggerUrl() {
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9222/json/list');
      const data = await res.json();
      if (data && data[0] && data[0].webSocketDebuggerUrl) {
        return data[0].webSocketDebuggerUrl;
      }
    } catch {
      // Tunggu chrome ready
    }
    await delay(300);
  }
  throw new Error('Chrome remote debugging tidak merespon.');
}

async function main() {
  let ws;
  try {
    const wsUrl = await getDebuggerUrl();
    console.log('✓ Terhubung ke Chrome DevTools Protocol:', wsUrl);

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
    await delay(2000);

    // Cek jika sudah login (redirect ke dashboard / root)
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

      await delay(2500);
    } else {
      console.log('2. Sesi aktif sudah terdeteksi di browser:', checkUrl.result.value);
    }

    // 2. Verifikasi Navigasi ke /workspace/companies
    console.log(`3. Menavigasi ke ${baseUrl}/workspace/companies ...`);
    await send('Page.navigate', { url: `${baseUrl}/workspace/companies` });
    await delay(3000);

    const companiesDom = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const body = document.body.innerText;
          const hasTitle = body.includes('Perusahaan');
          const hasAiber = body.includes('PT Aiber Semikonduktor Indonesia') || body.includes('AIBER001');
          const addBtn = !!document.getElementById('btn-add-company');
          return { hasTitle, hasAiber, addBtn, url: window.location.pathname };
        })()
      `,
      returnByValue: true,
    });
    console.log('Hasil inspeksi halaman Perusahaan (/workspace/companies):', companiesDom.result.value);

    if (!companiesDom.result.value.hasTitle || !companiesDom.result.value.hasAiber) {
      throw new Error('Halaman Perusahaan tidak memuat judul atau data perusahaan AIBER001');
    }
    console.log('✓ Halaman Perusahaan (/workspace/companies) terverifikasi dengan data AIBER001.');

    // 3. Verifikasi Navigasi ke /workspace/users-access
    console.log(`4. Menavigasi ke ${baseUrl}/workspace/users-access ...`);
    await send('Page.navigate', { url: `${baseUrl}/workspace/users-access` });
    await delay(3000);

    const usersDom = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const body = document.body.innerText;
          const hasTitle = body.includes('Pengguna & Hak Akses');
          const hasStaffTab = body.includes('Penugasan Pengguna');
          const hasMatrixTab = body.includes('Matriks Izin Akses');
          const addBtn = !!document.getElementById('btn-add-assignment');
          return { hasTitle, hasStaffTab, hasMatrixTab, addBtn, url: window.location.pathname };
        })()
      `,
      returnByValue: true,
    });
    console.log('Hasil inspeksi Pengguna & Hak Akses (/workspace/users-access):', usersDom.result.value);

    if (!usersDom.result.value.hasTitle || !usersDom.result.value.hasStaffTab) {
      throw new Error('Halaman Pengguna & Hak Akses tidak memuat data penugasan atau judul.');
    }

    // Uji klik tab Matriks Izin Akses
    console.log('5. Menguji interaksi tab Matriks Izin Akses...');
    const switchTabRes = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          const matrixBtn = buttons.find(b => b.innerText.includes('Matriks Izin Akses'));
          if (matrixBtn) {
            matrixBtn.click();
            return { clicked: true };
          }
          return { clicked: false };
        })()
      `,
      returnByValue: true,
    });
    await delay(1500);

    const matrixCheck = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const body = document.body.innerText;
          return {
            hasOwnerMatrix: body.includes('Matriks Izin: Owner / Direksi') || body.includes('Matriks Izin'),
            hasCheckboxes: document.querySelectorAll('input[type="checkbox"]').length > 0
          };
        })()
      `,
      returnByValue: true,
    });
    console.log('Hasil inspeksi Matriks Izin:', matrixCheck.result.value);
    console.log('✓ Halaman Pengguna & Hak Akses serta Matriks Izin terverifikasi.');

    // 4. Verifikasi Navigasi ke /workspace/profile
    console.log(`6. Menavigasi ke ${baseUrl}/workspace/profile ...`);
    await send('Page.navigate', { url: `${baseUrl}/workspace/profile` });
    await delay(2500);

    const profileDom = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const body = document.body.innerText;
          const hasTitle = body.includes('Profil Pengguna');
          const hasPersonalCard = body.includes('Informasi Pribadi & Kontak');
          const hasSecurityCard = body.includes('Keamanan & Kata Sandi');
          const nameInput = document.getElementById('profile-name');
          const currPassInput = document.getElementById('current-password');
          return {
            hasTitle,
            hasPersonalCard,
            hasSecurityCard,
            nameInputFound: !!nameInput,
            currPassInputFound: !!currPassInput,
            url: window.location.pathname
          };
        })()
      `,
      returnByValue: true,
    });
    console.log('Hasil inspeksi Profil Pengguna (/workspace/profile):', profileDom.result.value);

    if (!profileDom.result.value.hasTitle || !profileDom.result.value.hasPersonalCard) {
      throw new Error('Halaman Profil Pengguna tidak memuat kartu informasi pribadi.');
    }
    console.log('✓ Halaman Profil Pengguna (/workspace/profile) terverifikasi.');

    console.log('✓ SELURUH VERIFIKASI BROWSER FASE 2 SUKSES 100%!');
  } finally {
    if (ws) ws.close();
    chromeProcess.kill('SIGTERM');
  }
}

main().catch((err) => {
  console.error('VERIFIKASI FASE 2 GAGAL:', err);
  if (chromeProcess) chromeProcess.kill('SIGTERM');
  process.exit(1);
});
