const fs = require('fs');
let content = fs.readFileSync('scripts/test-broll-realization-v1-3-4.ts', 'utf8');

const oldMock = `    render: async () => ({
      status: 'PASS', durationSeconds: 60, failures: [],
      editorial: {`;
      
const newMock = `    render: async () => ({
      status: 'PASS', durationSeconds: 60, failures: [],
      video: true, audio: true, directorCoverage: true, brollRights: true, placement: true, bengaliGraphics: true, reviewReadiness: true, editorialQuality: true,
      editorial: {`;

content = content.replace(oldMock, newMock);
fs.writeFileSync('scripts/test-broll-realization-v1-3-4.ts', content);
