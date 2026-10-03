import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AUDIO_SILENCE_FLOOR_DB, evaluateAudioContinuity, measureAudioLevels, parseVolumeDetect, validateMediaIntegrity, verifyAudioContinuity } from '../src/media-integrity.ts';
import { createVideoFormatProfile } from '../src/video-format.ts';

const work = await mkdtemp(join(tmpdir(), 'media-integrity-'));
const portrait = createVideoFormatProfile(1080, 1920);
const lightweight = { orientation: 'portrait' } as any;

// --- Failures that need no real media ---
const missing = await validateMediaIntegrity(join(work, 'missing.mp4'), 'ffprobe', lightweight);
assert.equal(missing.passed, false);
assert.ok(missing.failures.some((f) => f.includes('File does not exist')), 'final artifact must exist');

await writeFile(join(work, 'empty.mp4'), '');
const zero = await validateMediaIntegrity(join(work, 'empty.mp4'), 'ffprobe', lightweight);
assert.equal(zero.passed, false);
assert.ok(zero.failures.some((f) => f.includes('too small or empty')), 'zero-byte output rejected');

await writeFile(join(work, 'fake.mp4'), 'this is not a real video'.repeat(100));
const fake = await validateMediaIntegrity(join(work, 'fake.mp4'), 'ffprobe', lightweight);
assert.equal(fake.passed, false);
assert.ok(fake.failures.some((f) => f.includes('ffprobe execution failed') || f.includes('Missing format')), 'invalid MP4 rejected');

// --- Audio measurement logic (pure) ---
const sample = '[Parsed_volumedetect_0 @ 0x1] mean_volume: -21.1 dB\n[Parsed_volumedetect_0 @ 0x1] max_volume: -16.1 dB';
assert.deepEqual(parseVolumeDetect(sample), { meanDb: -21.1, maxDb: -16.1 });
assert.equal(parseVolumeDetect('no audio here'), undefined);
assert.equal(parseVolumeDetect('mean_volume: -inf dB\nmax_volume: -inf dB')?.maxDb, Number.NEGATIVE_INFINITY);
const speech = { meanDb: -20, maxDb: -6 };
assert.deepEqual(evaluateAudioContinuity(speech, [{ id: 'b1', source: speech, output: { meanDb: -21, maxDb: -7 } }]), [], 'matching audio passes');
assert.ok(evaluateAudioContinuity(undefined, []).some((f) => f.includes('could not be measured')));
assert.ok(evaluateAudioContinuity({ meanDb: -91, maxDb: AUDIO_SILENCE_FLOOR_DB - 1 }, []).some((f) => f.includes('silent')), 'silent output rejected');
assert.ok(evaluateAudioContinuity(speech, [{ id: 'b1', source: speech, output: { meanDb: -90, maxDb: -80 } }]).some((f) => f.includes('drops out during B-roll')), 'sermon audio dropout during B-roll rejected');
assert.ok(evaluateAudioContinuity(speech, [{ id: 'b1', source: speech, output: { meanDb: -30, maxDb: -15 } }]).some((f) => f.includes('differs from the sermon source')), 'replaced/attenuated audio rejected');
assert.ok(evaluateAudioContinuity(speech, [{ id: 'b1', source: speech }]).some((f) => f.includes('could not be measured')), 'unmeasurable window is not silently accepted');

// --- Real encoded media (skipped only when ffmpeg is genuinely unavailable) ---
const ffmpeg = '/opt/homebrew/bin/ffmpeg';
const ffprobe = '/opt/homebrew/bin/ffprobe';
if (existsSync(ffmpeg) && existsSync(ffprobe)) {
  const encode = (name: string, args: string[]) => {
    execFileSync(ffmpeg, ['-v', 'error', '-y', ...args, join(work, name)]);
    return join(work, name);
  };
  const video = (size: string) => ['-f', 'lavfi', '-i', `testsrc=size=${size}:rate=30`];
  const tone = (frequency = 440) => ['-f', 'lavfi', '-i', `sine=frequency=${frequency}:sample_rate=48000`];
  const h264 = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p'];

  const good = encode('good.mp4', [...video('1080x1920'), ...tone(), '-t', '3', ...h264, '-c:a', 'aac', '-shortest']);
  const ok = await validateMediaIntegrity(good, ffprobe, portrait, { expectedDurationSeconds: 3 });
  assert.deepEqual(ok.failures, [], 'standard H.264 + AAC export accepted');
  assert.equal(ok.passed, true);
  assert.equal(ok.videoCodec, 'h264');
  assert.equal(ok.audioCodec, 'aac');

  const noAudio = encode('noaudio.mp4', [...video('1080x1920'), '-t', '3', ...h264, '-an']);
  assert.ok((await validateMediaIntegrity(noAudio, ffprobe, portrait)).failures.some((f) => f.includes('Missing audio stream')), 'missing audio stream rejected');

  const audioOnly = encode('audioonly.mp4', [...tone(), '-t', '3', '-c:a', 'aac']);
  assert.ok((await validateMediaIntegrity(audioOnly, ffprobe, portrait)).failures.some((f) => f.includes('Missing video stream')), 'missing video stream rejected');

  const landscape = encode('landscape.mp4', [...video('1920x1080'), ...tone(), '-t', '3', ...h264, '-c:a', 'aac', '-shortest']);
  const wrongOrientation = await validateMediaIntegrity(landscape, ffprobe, portrait);
  assert.ok(wrongOrientation.failures.some((f) => f.includes('Orientation mismatch')), 'wrong orientation rejected');
  assert.ok(wrongOrientation.failures.some((f) => f.includes('Dimension mismatch')), 'wrong dimensions rejected');

  const mpeg4 = encode('mpeg4.mp4', [...video('1080x1920'), ...tone(), '-t', '3', '-c:v', 'mpeg4', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest']);
  assert.ok((await validateMediaIntegrity(mpeg4, ffprobe, portrait)).failures.some((f) => f.includes('Invalid video codec')), 'incompatible video codec rejected');

  const yuv444 = encode('yuv444.mp4', [...video('1080x1920'), ...tone(), '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv444p', '-c:a', 'aac', '-shortest']);
  assert.ok((await validateMediaIntegrity(yuv444, ffprobe, portrait)).failures.some((f) => f.includes('Invalid pixel format')), 'incompatible pixel format rejected');

  const mp3 = encode('mp3audio.mkv', [...video('1080x1920'), ...tone(), '-t', '3', ...h264, '-c:a', 'libmp3lame', '-shortest']);
  const notMp4 = await validateMediaIntegrity(mp3, ffprobe, portrait);
  assert.ok(notMp4.failures.some((f) => f.includes('Invalid audio codec')), 'non-AAC audio rejected');
  assert.ok(notMp4.failures.some((f) => f.includes('Invalid container')), 'non-MP4 container rejected');

  assert.ok((await validateMediaIntegrity(good, ffprobe, portrait, { expectedDurationSeconds: 10 })).failures.some((f) => f.includes('Duration mismatch')), 'truncated/incorrect duration rejected');

  // Sermon-audio continuity against real encodes: a source tone, a faithful render, a render whose B-roll
  // window lost the sermon audio, and a silent render.
  const source = encode('source.mp4', [...video('1080x1920'), ...tone(440), '-t', '6', ...h264, '-c:a', 'aac', '-shortest']);
  const faithful = encode('faithful.mp4', [...video('1080x1920'), '-i', source, '-map', '0:v', '-map', '1:a', '-t', '6', ...h264, '-c:a', 'aac']);
  const dropout = encode('dropout.mp4', [...video('1080x1920'), '-i', source, '-af', "volume=enable='between(t,2,4)':volume=0", '-map', '0:v', '-map', '1:a', '-t', '6', ...h264, '-c:a', 'aac']);
  const silent = encode('silent.mp4', [...video('1080x1920'), '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-map', '0:v', '-map', '1:a', '-t', '6', ...h264, '-c:a', 'aac']);
  const windows = [{ id: 'broll-section-1', start: 2, end: 4 }];
  assert.ok((await measureAudioLevels(ffmpeg, source))!.maxDb > AUDIO_SILENCE_FLOOR_DB, 'source audio is measurable and audible');
  assert.deepEqual(await verifyAudioContinuity({ ffmpegPath: ffmpeg, sourcePath: source, outputPath: faithful, windows }), [], 'continuous sermon audio passes');
  assert.ok((await verifyAudioContinuity({ ffmpegPath: ffmpeg, sourcePath: source, outputPath: dropout, windows })).some((f) => f.includes('broll-section-1')), 'audio dropout during B-roll is detected in the real output');
  assert.ok((await verifyAudioContinuity({ ffmpegPath: ffmpeg, sourcePath: source, outputPath: silent, windows })).some((f) => f.includes('silent')), 'silent render is detected');
} else {
  console.log('SKIPPED real-encode checks: ffmpeg/ffprobe are not installed at /opt/homebrew/bin.');
}

await rm(work, { recursive: true, force: true });
console.log(JSON.stringify({ status: 'PASS', suite: 'media-integrity-v1-3-8' }, null, 2));
