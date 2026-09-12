import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const projectRoot = process.cwd();
const envPath = path.join(projectRoot, '.env');

function parseEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error('.env file not found at: ' + filePath);
  }
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

function resolveEmails(username) {
  if (username.includes('@')) {
    return [username];
  }
  // Daftarkan ke domain sistem mis.mrmads.net dan mrmads.net
  return [`${username}@mis.mrmads.net`, `${username}@mrmads.net`];
}

async function seedUsers() {
  const env = parseEnv(envPath);

  const supabaseUrl = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  }

  const superUserUsername = env.SUPER_USER_USERNAME;
  const superUserPassword = env.SUPER_USER_PASSWORD;
  const e2eUserUsername = env.E2E_USER_USERNAME;
  const e2eUserPassword = env.E2E_USER_PASSWORD;

  if (!superUserUsername || !superUserPassword || !e2eUserUsername || !e2eUserPassword) {
    throw new Error('Missing SUPER_USER or E2E_USER credentials in .env');
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const definitions = [
    {
      username: superUserUsername,
      password: superUserPassword,
      role: 'owner',
      label: 'Super User (Owner)',
    },
    {
      username: e2eUserUsername,
      password: e2eUserPassword,
      role: 'head',
      label: 'E2E User (Head)',
    },
  ];

  console.log('Mengambil daftar pengguna aktif di Supabase Auth...');
  const { data: usersData, error: listError } = await supabase.auth.admin.listUsers();
  if (listError) {
    throw new Error('Gagal mengambil daftar pengguna: ' + listError.message);
  }

  const existingUsers = usersData?.users || [];

  for (const def of definitions) {
    const emails = resolveEmails(def.username);

    for (const email of emails) {
      const existing = existingUsers.find(
        (u) => u.email?.toLowerCase() === email.toLowerCase()
      );

      if (existing) {
        console.log(`Memperbarui kredensial untuk ${def.label} [${email}]...`);
        const { error: updateError } = await supabase.auth.admin.updateUserById(existing.id, {
          password: def.password,
          email_confirm: true,
          app_metadata: { role: def.role, username: def.username },
          user_metadata: { role: def.role, username: def.username },
        });

        if (updateError) {
          console.error(`Gagal memperbarui ${def.label} [${email}]:`, updateError.message);
        } else {
          console.log(`Berhasil memperbarui ${def.label} (Role: ${def.role}) [${email}].`);
        }
      } else {
        console.log(`Mendaftarkan akun baru ${def.label} [${email}]...`);
        const { data: created, error: createError } = await supabase.auth.admin.createUser({
          email,
          password: def.password,
          email_confirm: true,
          app_metadata: { role: def.role, username: def.username },
          user_metadata: { role: def.role, username: def.username },
        });

        if (createError) {
          console.error(`Gagal mendaftarkan ${def.label} [${email}]:`, createError.message);
        } else {
          console.log(
            `Berhasil mendaftarkan ${def.label} (Role: ${def.role}) [${email} - ID: ${created.user.id}].`
          );
        }
      }
    }
  }

  console.log('Seluruh pengguna target telah berhasil dikonfigurasi di Supabase Auth.');
}

seedUsers().catch((err) => {
  console.error('Error saat seeding users:', err.message);
  process.exit(1);
});
