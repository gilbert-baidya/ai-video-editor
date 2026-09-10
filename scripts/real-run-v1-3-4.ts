import { basename } from 'path';

const PROJECT_ID = process.argv[2] || 'project-broll-test';

async function main() {
  const res = await fetch(`http://localhost:4174/api/projects/${PROJECT_ID}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Real B-roll Validation',
      source: { type: 'youtube-url', url: 'https://youtube.com/shorts/lPN9AWaTuEc' }
    })
  });
  const data = await res.json();
  console.log(data);
}
main().catch(console.error);
