const reviewData = require('../.runtime/projects/project-17864554-8c47-4218-a80f-02458985e2db/artifacts/review-workspace.json');
const brollDecision = reviewData.beats.find(b => b.section.type === 'story' || b.originalOperation?.visualType === 'image-broll');

const reviewPayload = {
  decisions: [
    {
      beatId: brollDecision.beatId,
      status: 'approved'
    }
  ]
};

const decisions = new Map(reviewPayload.decisions.map((decision) => [decision.beatId, decision]));
for (const beat of reviewData.beats) {
  const decision = decisions.get(beat.section.id);
  console.log('Beat Section ID:', beat.section.id);
  console.log('Decision found:', decision);
  if (beat.requiredReview && (!decision || decision.status === 'pending')) {
    console.log('BLOCKER ADDED');
  }
}
