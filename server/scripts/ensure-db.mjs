import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(serverDir, '..');
const port = 54329;
const databaseUrl = `postgresql://kontabilisti:kontabilisti@127.0.0.1:${port}/kontabiliteti_pro?schema=public`;

function portOpen() {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' }, () => {
      socket.end();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
  });
}

function ensureEnv() {
  const example = path.join(root, '.env.example');
  const target = path.join(root, '.env');
  if (!fs.existsSync(target) && fs.existsSync(example)) {
    let content = fs.readFileSync(example, 'utf8');
    const key = crypto.randomBytes(32).toString('hex');
    content = content.replace('AUTH_ENCRYPTION_KEY=', `AUTH_ENCRYPTION_KEY=${key}`);
    fs.writeFileSync(target, content);
  }
  const envPath = path.join(serverDir, '.env');
  const keyLine = fs.existsSync(target) ? fs.readFileSync(target, 'utf8').match(/^AUTH_ENCRYPTION_KEY=(.*)$/m)?.[1] ?? '' : '';
  fs.writeFileSync(
    envPath,
    `DATABASE_URL=${databaseUrl}\nAUTH_ENCRYPTION_KEY=${keyLine}\nNODE_ENV=development\n`,
  );
}

if (!(await portOpen())) {
  const child = spawn(process.execPath, [path.join(serverDir, 'scripts', 'postgres-host.mjs')], {
    cwd: serverDir,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await portOpen()) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!(await portOpen())) {
    console.error('PostgreSQL nuk nisi. Shihni server/scripts/postgres-host.mjs.');
    process.exit(1);
  }
}

ensureEnv();
console.log('Baza lokale është gati.');
