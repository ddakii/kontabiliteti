import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const databaseDir = path.resolve(serverDir, '..', '.pgdata');
const port = Number(process.env.PG_PORT ?? 54329);
const user = process.env.PG_USER ?? 'kontabilisti';
const password = process.env.PG_PASSWORD ?? 'kontabilisti';

const postgres = new EmbeddedPostgres({
  databaseDir,
  port,
  user,
  password,
  persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  onLog: () => undefined,
  onError: (error) => console.error(error),
});

if (!fs.existsSync(path.join(databaseDir, 'PG_VERSION'))) {
  await postgres.initialise();
}
await postgres.start();
for (const name of ['kontabiliteti_pro', 'kontabiliteti_test']) {
  try {
    await postgres.createDatabase(name);
  } catch {
    // Baza ekziston tashmë.
  }
}
console.log(`PostgreSQL është duke u ekzekutuar te 127.0.0.1:${port}`);

const shutdown = async () => {
  try {
    await postgres.stop();
  } catch {
    // Procesi po mbyllet.
  }
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
setInterval(() => undefined, 60_000);
