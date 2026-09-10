import { readFileSync, writeFileSync } from 'fs';
let content = readFileSync('src/product-server.ts', 'utf8');
content = content.replace(
  'const input = await bodyJson<{ path: string, description: string, rightsConfirmed: boolean }>(request);',
  'const input = await bodyJson<{ path: string, description: string, rightsStatus: \\'approved\\' | \\'unknown\\' | \\'restricted\\', rightsBasis: \\'owned\\' | \\'permission\\' | \\'generated\\' | \\'public-domain\\' | \\'licensed\\' | \\'unknown\\', rightsNote?: string }>(request);'
);
writeFileSync('src/product-server.ts', content);
