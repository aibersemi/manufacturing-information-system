import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--from') {
  console.error('Gunakan npm run types:db -- --from <artifact-database.types.ts> dari admin platform.');
  process.exitCode = 1;
} else {
  const source = path.resolve(args[1]);
  const content = fs.readFileSync(source, 'utf8');
  if (!content.includes('export type Database') || !content.includes('public:')) {
    throw new Error('Artifact bukan kontrak tipe MIS yang diharapkan.');
  }
  const target = path.resolve('src/types/database.types.ts');
  if (source !== target) fs.writeFileSync(target, content);
  console.log('Kontrak tipe MIS berhasil diimpor dari artifact admin.');
}
