const { spawn } = require('child_process');
async function probe() {
  const path = './.runtime/projects/project-743fa954-c0a9-452c-840b-7fffdbdb6ef7/source/source.mp4';
  const output = await new Promise((done, reject) => {
    const child = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size:stream=width,height:stream_tags=rotate:stream_side_data=rotation', '-select_streams', 'v:0', '-of', 'json', path]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? done(stdout) : reject(new Error(stderr || `ffprobe exited with ${code}.`)));
  });
  console.log(output);
  const parsed = JSON.parse(output);
  console.log('Duration:', Number(parsed.format?.duration ?? 0));
}
probe().catch(console.error);
