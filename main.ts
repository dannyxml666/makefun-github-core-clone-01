import { createApp } from './app.ts';
import http from 'node:http';

const ENV_URL = process.env.MAKEFUN_ENV_URL;

if (!ENV_URL) {
  process.stderr.write('MAKEFUN_ENV_URL is empty or unset\n');
  process.exit(1);
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function register(port: number): Promise<void> {
  let delay = 250;
  const maxDelay = 2000;

  while (true) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const res = await fetch(`${ENV_URL}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (res.status === 200 || res.status === 409) {
        return;
      }
      if (res.status === 400 || res.status === 405) {
        throw new Error(`Register answered fatal status ${res.status}`);
      }
      throw new Error(`Register answered status ${res.status}`);
    } catch (err: any) {
      if (err.message && err.message.includes('fatal status')) {
        process.stderr.write(`Fatal registration error: ${err.message}\n`);
        process.exit(1);
      }
      await sleep(delay);
      delay = Math.min(delay * 2, maxDelay);
    }
  }
}

async function pollDone(server: http.Server): Promise<void> {
  let delay = 250;
  const maxDelay = 2000;

  while (true) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const res = await fetch(`${ENV_URL}/done`, {
        method: 'GET',
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const text = await res.text();
        try {
          const data = JSON.parse(text);
          if (data && data.done === true) {
            await new Promise<void>(resolve => server.close(() => resolve()));
            process.exit(0);
          }
        } catch {
          // parse error, retry
        }
      }
      await sleep(delay);
      delay = Math.min(delay * 2, maxDelay);
    } catch {
      await sleep(delay);
      delay = Math.min(delay * 2, maxDelay);
    }
  }
}

async function main() {
  const server = createApp();

  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
    server.on('error', err => reject(err));
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    process.stderr.write('Failed to bind ephemeral port\n');
    process.exit(1);
  }

  await register(address.port);
  pollDone(server);
}

main().catch(err => {
  process.stderr.write(`Fatal error in main: ${err}\n`);
  process.exit(1);
});
