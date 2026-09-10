const reviewData = require('../.runtime/projects/project-17864554-8c47-4218-a80f-02458985e2db/artifacts/review-workspace.json');
const brollDecision = reviewData.beats.find(b => b.section.type === 'story' || b.originalOperation?.visualType === 'image-broll');
console.log('brollDecision.beatId:', brollDecision.beatId);
