import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MediaAsset, MediaLibraryRoot } from '../src/contracts.ts';
import { assetMetadataIssues, rightsEvidenceIssues, sniffImage, sniffVideoContainer } from '../src/media-asset-validation.ts';
import { importImageAsset, verifyAssetOnDisk } from '../src/media-import.ts';
import { indexLocalMedia } from '../src/media-library.ts';

const work = await mkdtemp(join(tmpdir(), 'media-import-'));
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function png(width: number, height: number): Buffer {
  const header = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12, 'ascii');
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  header[24] = 8; header[25] = 2;
  return header;
}

// JPEG with a large EXIF APP1 segment before the frame header, as real camera/AI exports have.
function jpeg(width: number, height: number, sof = 0xc0): Buffer {
  const exif = Buffer.concat([Buffer.from([0xff, 0xe1, 0x10, 0x00]), Buffer.alloc(0x0ffe, 0x41)]);
  const frame = Buffer.from([0xff, sof, 0x00, 0x0b, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x01, 0x01, 0x11, 0x00]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), exif, frame, Buffer.from([0xff, 0xd9])]);
}

// --- Content sniffing ---
assert.deepEqual(sniffImage(png(1080, 1920)), { format: 'png', mimeType: 'image/png', extension: 'png', width: 1080, height: 1920 });
assert.deepEqual(sniffImage(jpeg(1024, 1024)), { format: 'jpeg', mimeType: 'image/jpeg', extension: 'jpg', width: 1024, height: 1024 });
assert.equal(sniffImage(jpeg(640, 480, 0xc2)).width, 640, 'progressive JPEG (SOF2) is read');
assert.equal(sniffImage(jpeg(640, 480, 0xc1)).height, 480, 'extended-sequential JPEG (SOF1) is read');
assert.throws(() => sniffImage(Buffer.alloc(0)), /empty/);
assert.throws(() => sniffImage(Buffer.from('not an image at all')), /not a supported image/);
assert.throws(() => sniffImage(png(0, 10)), /invalid dimensions/);
assert.throws(() => sniffImage(png(1080, 1920).subarray(0, 20)), /truncated/);
assert.throws(() => sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xd9])), /no readable frame header/);
const webp = Buffer.alloc(30);
webp.write('RIFF', 0, 'ascii'); webp.writeUInt32LE(22, 4); webp.write('WEBPVP8X', 8, 'ascii');
webp.writeUIntLE(799, 24, 3); webp.writeUIntLE(599, 27, 3);
assert.equal(sniffImage(webp).width, 800);
assert.equal(sniffImage(webp).height, 600);
assert.equal(sniffVideoContainer(Buffer.from('\u0000\u0000\u0000\u0018ftypmp42\u0000\u0000\u0000\u0000'))?.mimeType, 'video/mp4');
assert.equal(sniffVideoContainer(Buffer.from('plain text file'))?.mimeType, undefined);

// --- The recorded personal-Mac defect: stored PNG / 0 bytes / 1080x1920 vs a real 1024x1024 JPEG ---
const stale: MediaAsset = {
  id: 'media-stale', path: '/nowhere/stale.png', relativePath: 'stale.png', fileName: 'stale.png', kind: 'image', mimeType: 'image/png', sizeBytes: 0,
  modifiedAt: '2026-01-01T00:00:00.000Z', width: 1080, height: 1920, aspectRatio: 1080 / 1920, hasAudio: false, tags: [], categories: [], searchTerms: [],
  rightsStatus: 'approved', rightsBasis: 'owned', libraryRootId: 'local-import', libraryPolicyVersion: '1.0', usable: true, unusableReasons: [],
};
const staleIssues = assetMetadataIssues(stale);
assert.ok(staleIssues.some((i) => i.includes('not a positive byte count')), 'zero-byte metadata is invalid');
assert.ok(staleIssues.some((i) => i.includes('SHA-256')), 'missing hash is invalid');

const real = jpeg(1024, 1024);
const disguised = join(work, 'sermon-illustration.png');
await writeFile(disguised, real);
const imported = await importImageAsset({ sourcePath: disguised, destinationDirectory: join(work, 'media'), relativeDirectory: 'media', description: 'illustration', rightsStatus: 'approved', rightsBasis: 'generated', rightsNote: 'Generated with an AI image tool for this sermon.' });
assert.equal(imported.mimeType, 'image/jpeg', 'MIME comes from content, not the .png extension');
assert.equal(imported.width, 1024);
assert.equal(imported.height, 1024);
assert.equal(imported.sizeBytes, real.length, 'size is the real byte count');
assert.ok(imported.sizeBytes > 0);
assert.equal(imported.contentHash, sha(real), 'hash is the real SHA-256');
assert.equal(imported.id, `media-${sha(real).slice(0, 24)}`, 'identity derives from the content');
assert.ok(imported.path.endsWith('.jpg'), 'stored extension matches the real format');
assert.equal(imported.originalFileName, 'sermon-illustration.png', 'provenance records the original file name');
assert.ok(imported.importedAt && imported.rightsConfirmedAt, 'import and rights-confirmation times are recorded');
assert.equal(imported.usable, true);
assert.deepEqual(assetMetadataIssues(imported), []);
assert.equal((await stat(imported.path)).size, real.length, 'the managed copy exists with the real size');
assert.deepEqual(await verifyAssetOnDisk(imported), [], 'stored metadata reflects the actual file');
const again = await importImageAsset({ sourcePath: disguised, destinationDirectory: join(work, 'media'), relativeDirectory: 'media', description: 'again', rightsStatus: 'approved', rightsBasis: 'owned' });
assert.equal(again.id, imported.id, 'identical content has a stable identity');

// --- Imports that must fail ---
const empty = join(work, 'empty.png');
await writeFile(empty, '');
await assert.rejects(importImageAsset({ sourcePath: empty, destinationDirectory: join(work, 'media'), relativeDirectory: 'media', description: 'x', rightsStatus: 'unknown', rightsBasis: 'unknown' }), /empty/);
const fake = join(work, 'fake.jpg');
await writeFile(fake, 'definitely not a jpeg');
await assert.rejects(importImageAsset({ sourcePath: fake, destinationDirectory: join(work, 'media'), relativeDirectory: 'media', description: 'x', rightsStatus: 'unknown', rightsBasis: 'unknown' }), /not a supported image/);
await assert.rejects(importImageAsset({ sourcePath: join(work, 'missing.png'), destinationDirectory: join(work, 'media'), relativeDirectory: 'media', description: 'x', rightsStatus: 'unknown', rightsBasis: 'unknown' }));
await assert.rejects(importImageAsset({ sourcePath: work, destinationDirectory: join(work, 'media'), relativeDirectory: 'media', description: 'x', rightsStatus: 'unknown', rightsBasis: 'unknown' }), /not a regular file/);

// --- Rights evidence is never invented ---
assert.deepEqual(rightsEvidenceIssues({ rightsStatus: 'approved', rightsBasis: 'owned' }), []);
assert.equal(rightsEvidenceIssues({ rightsStatus: 'approved', rightsBasis: 'unknown' }).length, 1);
assert.equal(rightsEvidenceIssues({ rightsStatus: 'approved', rightsBasis: 'licensed' }).length, 1);
assert.deepEqual(rightsEvidenceIssues({ rightsStatus: 'approved', rightsBasis: 'licensed', rightsNote: 'Licence #123' }), []);
await assert.rejects(importImageAsset({ sourcePath: disguised, destinationDirectory: join(work, 'media'), relativeDirectory: 'media', description: 'x', rightsStatus: 'approved', rightsBasis: 'unknown' }), /declared basis/);
const unknownRights = await importImageAsset({ sourcePath: disguised, destinationDirectory: join(work, 'media'), relativeDirectory: 'media', description: 'x', rightsStatus: 'unknown', rightsBasis: 'unknown' });
assert.equal(unknownRights.rightsStatus, 'unknown');
assert.equal(unknownRights.rightsConfirmedAt, undefined, 'unknown rights are never stamped as confirmed');

// --- Disk verification detects drift ---
await writeFile(imported.path, jpeg(1024, 1024, 0xc0).subarray(0, real.length - 3));
const drift = await verifyAssetOnDisk(imported);
assert.ok(drift.some((i) => i.includes('does not match actual size')), 'size drift detected');
assert.ok(drift.some((i) => i.includes('SHA-256')), 'hash drift detected');
await writeFile(imported.path, png(1080, 1920));
assert.ok((await verifyAssetOnDisk(imported)).some((i) => i.includes('MIME type image/jpeg does not match actual image/png')), 'format drift detected');
await rm(imported.path);
assert.ok((await verifyAssetOnDisk(imported)).some((i) => i.includes('missing')), 'missing file detected');
assert.ok((await verifyAssetOnDisk(stale)).length > 0, 'the recorded stale metadata is rejected');

// --- Indexer reflects actual contents ---
if (existsSync('/opt/homebrew/bin/ffprobe') && existsSync('/opt/homebrew/bin/ffmpeg')) {
  const library = join(work, 'library');
  await rm(library, { recursive: true, force: true });
  const { mkdir } = await import('node:fs/promises');
  await mkdir(library, { recursive: true });
  execFileSync('/opt/homebrew/bin/ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=1024x1024', '-frames:v', '1', '-pix_fmt', 'yuvj420p', '-c:v', 'mjpeg', '-f', 'image2', join(library, 'actually-a-jpeg.png')]);
  await writeFile(join(library, 'zero.jpg'), '');
  await writeFile(join(library, 'garbage.jpg'), 'not an image');
  const root: MediaLibraryRoot = { id: 'root', path: library, label: 'fixture', defaultRightsStatus: 'approved', rightsPolicyVersion: '1', recursive: false, enabled: true };
  const { index } = await indexLocalMedia({ roots: [root], outputDirectory: join(work, 'index') });
  const byName = new Map(index.assets.map((a) => [a.fileName, a]));
  const mislabeled = byName.get('actually-a-jpeg.png')!;
  assert.equal(mislabeled.mimeType, 'image/jpeg', 'indexed MIME reflects the bytes (a JPEG stored under a .png name)');
  assert.equal(mislabeled.width, 1024);
  assert.equal(mislabeled.height, 1024);
  assert.equal(mislabeled.sizeBytes, (await readFile(join(library, 'actually-a-jpeg.png'))).length);
  assert.equal(mislabeled.contentHash, sha(await readFile(join(library, 'actually-a-jpeg.png'))));
  assert.equal(mislabeled.usable, true);
  assert.deepEqual(await verifyAssetOnDisk(mislabeled), []);
  assert.equal(byName.get('zero.jpg')!.usable, false, 'zero-byte file is not usable');
  assert.ok(byName.get('zero.jpg')!.unusableReasons.some((r) => r.includes('0 bytes')));
  assert.equal(byName.get('garbage.jpg')!.usable, false, 'non-image content is not usable');
  const cached = await indexLocalMedia({ roots: [root], outputDirectory: join(work, 'index'), previousIndexPath: join(work, 'index', 'index.json') });
  // The zero-byte file has no hash, so it is always re-inspected rather than trusted from the cache.
  assert.equal(cached.cache.reused, 2, 'unchanged hashed files are reused from the validated index');
  // An index written by an older indexer (no hashes, extension-derived MIME) must be rebuilt.
  const legacy = JSON.parse(await readFile(join(work, 'index', 'index.json'), 'utf8'));
  legacy.indexerVersion = 'director-v4-media-indexer-3';
  for (const a of legacy.assets) { delete a.contentHash; a.mimeType = 'image/png'; a.width = 1080; a.height = 1920; }
  await writeFile(join(work, 'index', 'legacy.json'), JSON.stringify(legacy));
  const rebuilt = await indexLocalMedia({ roots: [root], outputDirectory: join(work, 'index'), previousIndexPath: join(work, 'index', 'legacy.json') });
  assert.equal(rebuilt.cache.reused, 0, 'stale legacy metadata is never reused');
  assert.equal(rebuilt.index.assets.find((a) => a.fileName === 'actually-a-jpeg.png')!.width, 1024);
} else {
  console.log('SKIPPED indexer checks: ffprobe/ffmpeg are not installed at /opt/homebrew/bin.');
}

await rm(work, { recursive: true, force: true });
console.log(JSON.stringify({ status: 'PASS', suite: 'media-import-v1-3-8' }, null, 2));
