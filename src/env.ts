import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadEnv(appRoot: string) {
  const envPath = resolve(appRoot, '.env.local');
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, 'utf-8');
    const lines = content.split('\n');
    for (const line of lines) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = match[2] || '';
        // Remove surrounding quotes
        if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
        else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
        if (process.env[key] === undefined) {
          process.env[key] = value;
        }
      }
    }
  }
}
