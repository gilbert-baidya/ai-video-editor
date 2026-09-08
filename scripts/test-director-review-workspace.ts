import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { applyReviewAction, deriveApprovedEditPlan, evaluateReviewReadiness, type ReviewState, type ReviewWorkspaceData } from '../src/director-review.ts';
import type { EditPlan } from '../src/contracts.ts';
import { readJson, validatePlan } from '../src/foundation.ts';

const root = resolve(import.meta.dirname, '..');
const artifacts = join(root, 'artifacts', 'director-review-workspace-v1');

async function main(): Promise<void> {
  const data = await readJson<ReviewWorkspaceData>(join(artifacts, 'review-data.json'));
  const initial = data.initialReview;
  const broll = data.beats.find((beat) => beat.section.id === 'section-3');
  if (!broll?.originalOperation) throw new Error('Review test fixture has no pressure-cooker AI operation.');
  const accepted = applyReviewAction(initial, 'section-3', 'accept');
  if (deriveApprovedEditPlan(data.aiPlan, accepted).operations.length !== 1) throw new Error('Accept did not preserve the AI B-roll operation.');
  const rejected = applyReviewAction(accepted, 'section-3', 'reject');
  if (deriveApprovedEditPlan(data.aiPlan, rejected).operations.length !== 0) throw new Error('Reject did not remove the B-roll operation.');
  const modified = applyReviewAction(accepted, 'section-3', 'modify', { reason: 'Test modification.' });
  if (modified.decisions.find((decision) => decision.beatId === 'section-3')?.status !== 'modified') throw new Error('Modify did not persist modified status.');
  const replaced = applyReviewAction(accepted, 'section-3', 'replace-broll', { operation: broll.originalOperation, reason: 'Indexed candidate replacement test.' });
  if (replaced.decisions.find((decision) => decision.beatId === 'section-3')?.status !== 'modified') throw new Error('Replace B-roll did not persist modified status.');
  const reverted = applyReviewAction(rejected, 'section-3', 'revert');
  if (reverted.decisions.find((decision) => decision.beatId === 'section-3')?.status !== 'pending') throw new Error('Revert did not restore pending AI review.');
  const textApproved = applyReviewAction(initial, 'section-2', 'approve-text', { displayText: 'প্রার্থনা করছেন আর উত্তর আপনার দরজার সামনে দাঁড়িয়ে আছে' });
  if (textApproved.decisions.find((decision) => decision.beatId === 'section-2')?.approvedDisplayText === undefined) throw new Error('Bangla text approval was not persisted.');
  const scriptureBlocked = applyReviewAction(initial, 'section-3', 'accept');
  const scriptureReadiness = evaluateReviewReadiness(data, scriptureBlocked, 120);
  if (!scriptureReadiness.blockers.some((blocker) => blocker.includes('section-1'))) throw new Error('Scripture review warning did not block readiness.');
  const finalReview = await readJson<ReviewState>(join(artifacts, 'review', 'director-review.json'));
  const approvedPlan = await readJson<EditPlan>(join(artifacts, 'review', 'approved-edit-plan.json'));
  if (validatePlan(approvedPlan, 120).length) throw new Error('Persisted approved plan is invalid.');
  if (finalReview.decisions.length !== data.beats.length) throw new Error('Persisted review state lost a beat.');
  const cache = await readJson<{ reused: string[]; invalidated: string[]; rerun: Record<string, boolean> }>(join(artifacts, 'review-cache.json'));
  if (cache.rerun.sermonAnalysis !== false || !cache.reused.includes('media index') || !cache.invalidated.includes('reviewed preview render')) throw new Error('Review cache boundary is incorrect.');
  const proof = await readJson<{ status: string; render: { changedAt60s: boolean; audio?: unknown[] } }>(join(artifacts, 'review-proof.json'));
  if (proof.status !== 'PASS' || !proof.render.changedAt60s || !proof.render.audio?.length) throw new Error('Reviewed render proof is incomplete.');
  const uiBundle = await readFile(join(artifacts, 'main.js'), 'utf8');
  if (!uiBundle.includes('DIRECTOR REVIEW')) throw new Error('Review UI bundle is missing.');
  console.log(JSON.stringify({ status: 'PASS', checks: ['accept', 'reject', 'modify', 'revert', 'Bangla text approval', 'Scripture readiness blocker', 'plan validation', 'persistence', 'cache invalidation', 'reviewed render', 'UI bundle'], approvedOperations: approvedPlan.operations.length, ready: true }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
