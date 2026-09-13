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

console.log(`--- TEST LIVE BROWSER: ${baseUrl} ---`);

// 1. Jalankan Chrome headless
const chromeProcess = spawn('google-chrome', [
  '--headless=new',
  '--remote-debugging-port=9222',
  '--no-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--window-size=1280,800',
  'about:blank'
], { stdio: 'ignore' });

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

    // Enable Page, Runtime, DOM
    await send('Page.enable');
    await send('Runtime.enable');

    console.log(`1. Membuka ${baseUrl}/login ...`);
    await send('Page.navigate', { url: `${baseUrl}/login` });
    await delay(2500);

    // Evaluasi apakah halaman login termuat
    let pageTitle = await send('Runtime.evaluate', {
      expression: 'document.title',
      returnByValue: true
    });
    console.log('Judul Halaman:', pageTitle.result.value);

    // Isi formulir login dan klik tombol submit
    console.log('2. Mengisi credential login...');
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

    const fillRes = await send('Runtime.evaluate', {
      expression: fillScript,
      awaitPromise: true,
      returnByValue: true
    });
    console.log('Hasil submit form login:', fillRes.result.value);

    // Tunggu redirect ke dashboard
    console.log('3. Menunggu navigasi ke Dashboard...');
    let currentUrl = '';
    for (let i = 0; i < 15; i++) {
      await delay(1000);
      const urlRes = await send('Runtime.evaluate', {
        expression: 'window.location.pathname',
        returnByValue: true
      });
      currentUrl = urlRes.result.value;
      if (currentUrl.includes('/dashboard') || currentUrl === '/') {
        break;
      }
    }
    console.log('Current pathname setelah login:', currentUrl);

    // Periksa komponen Dashboard Layout (Company Switcher & Role Badge)
    await delay(2000);
    const inspectScript = `
      (() => {
        const bodyText = document.body.innerText;
        const hasAiber = bodyText.includes('PT Aiber Semikonduktor Indonesia') || bodyText.includes('AIBER001');
        const hasOwnerRole = bodyText.includes('Owner / Direksi') || bodyText.includes('Owner');
        
        // Cari tombol dropdown switcher company
        const switcherBtn = document.querySelector('button[aria-haspopup="listbox"]') || 
                            document.querySelector('button[title="Ganti Perusahaan"]') ||
                            Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('PT Aiber') || b.innerText.includes('AIBER001'));

        return {
          hasAiber,
          hasOwnerRole,
          switcherBtnFound: !!switcherBtn,
          switcherText: switcherBtn ? switcherBtn.innerText.replace(/\\n/g, ' ') : null,
          url: window.location.href
        };
      })()
    `;

    const inspectRes = await send('Runtime.evaluate', {
      expression: inspectScript,
      returnByValue: true
    });

    console.log('4. Hasil inspeksi DOM Header & Company Switcher:');
    console.log(JSON.stringify(inspectRes.result.value, null, 2));

    if (!inspectRes.result.value.hasAiber) {
      throw new Error('Nama company "PT Aiber Semikonduktor Indonesia" / "AIBER001" tidak ditemukan di UI!');
    }

    if (!inspectRes.result.value.hasOwnerRole) {
      throw new Error('Role badge "Owner / Direksi" tidak ditemukan di UI!');
    }

    console.log(`✓ Verifikasi UI live browser pada ${baseUrl} SUKSES PENUH!`);
  } finally {
    if (ws) ws.close();
    chromeProcess.kill('SIGTERM');
  }
}

main().catch((err) => {
  console.error('VERIFIKASI BROWSER GAGAL:', err);
  if (chromeProcess) chromeProcess.kill('SIGTERM');
  process.exit(1);
});
