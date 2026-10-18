import { createApp } from './app';
import { config } from './config';
import { startJobs } from './jobs';
import { prisma } from './lib/prisma';

const app = createApp();
startJobs();

const server = app.listen(config.port, () => {
  console.log(`API është duke u ekzekutuar te http://127.0.0.1:${config.port}`);
});

async function shutdown() {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
