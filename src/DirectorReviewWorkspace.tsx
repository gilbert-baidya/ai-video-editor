import React, { useMemo, useRef, useState } from 'react';
import type { EditOperation } from './contracts.ts';
import { applyReviewAction, isReviewStateCompatible, updateReview, type ReviewAction, type ReviewBeat, type ReviewState, type ReviewWorkspaceData } from './director-review.ts';
import { summarizeReviewWorkspace } from './editorial-quality.ts';

export interface ReviewDataPayload extends ReviewWorkspaceData {
  assetPreviewUrls: Record<string, string>;
}

const bn = (value: string | undefined): string => value?.trim() || '—';
const time = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const statusLabel: Record<string, string> = { pending: 'PENDING', accepted: 'ACCEPTED', modified: 'MODIFIED', rejected: 'REJECTED' };

function operationName(operation: EditOperation | undefined): string {
  if (!operation) return 'No visual operation';
  if (operation.type === 'broll') return `${operation.mode} B-roll`;
  if (operation.type === 'sermon-point') return 'Sermon point graphic';
  if (operation.type === 'speaker-position') return `Speaker ${operation.position}`;
  return operation.type.replaceAll('-', ' ');
}

function SectionTitle({ eyebrow, children }: { eyebrow: string; children: React.ReactNode }): React.ReactElement {
  return <div className="section-title"><span>{eyebrow}</span><h2>{children}</h2></div>;
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'gold' | 'green' | 'muted' }): React.ReactElement {
  return <div className={`metric ${tone ?? ''}`}><small>{label}</small><strong>{value}</strong></div>;
}

function CandidateInspector({ beat, data }: { beat: ReviewBeat; data: ReviewDataPayload }): React.ReactElement | null {
  if (!beat.brollDecision || beat.candidates.length === 0) return null;
  return <details className="evidence" open>
    <summary>Candidate ranking · {beat.candidates.length} candidates</summary>
    <div className="candidate-list">{beat.candidates.slice(0, 5).map((candidate) => {
      const asset = candidate.asset;
      return <div className={`candidate ${candidate.eligible ? 'winner' : ''}`} key={candidate.assetId}>
        <div className="candidate-heading"><b>{asset?.fileName ?? candidate.assetId}</b><span className={candidate.eligible ? 'pill green' : 'pill muted'}>{candidate.eligible ? 'ELIGIBLE' : 'INELIGIBLE'}</span></div>
        <div className="candidate-score">{candidate.score.toFixed(3)}</div>
        <div className="score-row"><span>Semantic {candidate.semanticScore.toFixed(2)}</span><span>Category {candidate.categoryScore.toFixed(2)}</span><span>Technical {candidate.technicalScore.toFixed(2)}</span><span>Rights {candidate.rightsScore.toFixed(2)}</span><span>Reuse −{candidate.repetitionPenalty.toFixed(2)}</span></div>
        <div className="candidate-foot"><span>{asset?.rightsStatus === 'unknown' ? '⚠ UNKNOWN RIGHTS' : `✓ ${asset?.rightsStatus ?? 'not indexed'}`}</span><span>{candidate.reasons[0]}</span></div>
        {asset && <div className="candidate-foot"><span>{asset.width}×{asset.height} · {asset.kind}</span><span>{asset.usable ? 'Technical valid' : 'Technical review'}</span></div>}
      </div>;
    })}</div>
  </details>;
}

function DecisionCard({ beat, data, decision, selected, onSelect, onAction }: { beat: ReviewBeat; data: ReviewDataPayload; decision: ReviewState['decisions'][number]; selected: boolean; onSelect: () => void; onAction: (action: ReviewAction, options?: { operation?: EditOperation; displayText?: string; reason?: string }) => void }): React.ReactElement {
  const section = beat.section;
  const isBroll = section.visualRecommendation === 'image-broll' || section.visualRecommendation === 'video-broll';
  const unresolvedBroll = isBroll && beat.brollDecision?.decision !== 'selected';
  const approvedText = decision.approvedDisplayText;
  const [editingText, setEditingText] = useState(false);
  const [draftText, setDraftText] = useState(approvedText ?? section.suggestedDisplayText ?? '');
  const [replaceMode, setReplaceMode] = useState(false);
  return <article className={`decision-card ${selected ? 'selected' : ''} status-${decision.status}`} onClick={onSelect}>
    <div className="card-top"><div><span className="time-code">{time(section.start)}—{time(section.end)}</span><span className="type-label">{section.type}</span></div><span className={`status status-${decision.status}`}>{statusLabel[decision.status]}</span></div>
    <h3>{bn(section.suggestedDisplayText ?? section.transcriptText.slice(0, 54))}</h3>
    <p className="transcript-snippet">{bn(section.transcriptText.slice(0, 180))}{section.transcriptText.length > 180 ? '…' : ''}</p>
    <div className="card-grid"><Metric label="Director recommendation" value={section.visualRecommendation ?? 'speaker-full'} /><Metric label="Provenance" value={decision.provenance ?? data.directorExecution?.source ?? 'UNKNOWN'} tone={decision.provenance === 'human-override' ? 'gold' : undefined} /><Metric label="Confidence" value={`${Math.round(section.confidence * 100)}%`} /></div>
    {isBroll && beat.selectedAsset && <div className="asset-summary"><div className="asset-thumb">{data.assetPreviewUrls[beat.selectedAsset.id] && <img src={data.assetPreviewUrls[beat.selectedAsset.id]} alt={beat.selectedAsset.fileName} />}</div><div><small>FINAL AI-RESOLVED VISUAL · {beat.selectedAsset.rightsStatus.toUpperCase()}</small><strong>{beat.selectedAsset.fileName}</strong><span>{beat.brollDecision?.candidates.find((candidate) => candidate.assetId === beat.selectedAsset?.id)?.score.toFixed(3)} score · {beat.placement?.decision === 'place' ? beat.placement.selectedRegion : 'review'} placement</span></div></div>}
    {unresolvedBroll && <div className="unresolved-broll"><small>UNRESOLVED B-ROLL</small><strong>No rights-safe approved asset is attached.</strong><span>Replace the asset, reject B-roll, or explicitly Keep Pastor before rendering.</span></div>}
    {section.visualRecommendation === 'scripture-card' && <div className="scripture-state"><small>SCRIPTURE INTEGRITY</small><span>Detected reference <b>{section.scriptureReference ?? 'Needs review'}</b></span><span>Verification <b>NEEDS REVIEW</b></span><span>Approved text <b>{approvedText ? 'APPROVED' : 'REFERENCE ONLY'}</b></span></div>}
    {section.suggestedDisplayText && <div className="text-state"><small>DISPLAY TEXT · {section.visualRecommendation === 'scripture-card' ? 'SCRIPTURE REFERENCE NEEDS REVIEW' : approvedText ? 'APPROVED DISPLAY' : 'AI-SUGGESTED-UNAPPROVED'}</small>{editingText ? <><textarea aria-label="Bangla display text" value={draftText} onChange={(event) => setDraftText(event.target.value)} /><button className="text-save" onClick={() => { setEditingText(false); onAction('approve-text', { displayText: draftText, reason: 'Bangla display text edited and explicitly approved during review.' }); }}>Save text</button></> : <div>{bn(approvedText ?? section.suggestedDisplayText)}</div>}</div>}
    <div className="reason"><small>WHY</small><span>{beat.brollDecision?.reason ?? section.reason}</span></div>
    <div className="actions" onClick={(event) => event.stopPropagation()}>
      {decision.status === 'pending' && <button className="primary" onClick={() => onAction('accept')}>Accept</button>}
      {isBroll && <><button disabled={beat.candidates.every((candidate) => !candidate.eligible)} onClick={() => setReplaceMode(true)}>Replace B-roll</button><button onClick={() => onAction('keep-pastor')}>Keep Pastor — Static</button><button onClick={() => onAction('reject', { reason: 'Reviewer rejected the B-roll recommendation without creating a Keep Pastor decision.' })}>Reject B-roll</button></>}
      {unresolvedBroll && <><button onClick={() => onAction('modify', { operation: { id: `reframe-${section.id}`, type: 'speaker-position', start: section.start, end: section.end, position: 'left', reason: 'Human resolved unavailable B-roll with a restrained speaker reframe.', confidence: section.confidence } })}>Use Reframe</button><button onClick={() => onAction('modify', { operation: { id: `punch-in-${section.id}`, type: 'speaker-position', start: section.start, end: section.end, position: 'punch-in', reason: 'Human resolved unavailable B-roll with a subtle punch-in.', confidence: section.confidence } })}>Use Punch-in</button>{section.suggestedDisplayText && <button onClick={() => onAction('modify', { operation: { id: `caption-${section.id}`, type: 'caption', start: section.start, end: section.end, text: section.suggestedDisplayText!, textTrust: 'ai-suggested-unapproved', reason: 'Human resolved unavailable B-roll with the Director’s concise semantic phrase.', confidence: section.confidence } })}>Use Caption</button>}</>}
      {section.suggestedDisplayText && section.visualRecommendation !== 'scripture-card' && <><button onClick={() => onAction('approve-text', { displayText: section.transcriptText.slice(0, 120), reason: 'Approved from canonical sermon wording.' })}>Approve text</button><button onClick={() => { setDraftText(approvedText ?? section.suggestedDisplayText ?? ''); setEditingText(true); }}>Edit text</button></>}
      {section.visualRecommendation === 'scripture-card' && <button onClick={() => onAction('keep-pastor')}>Remove graphic</button>}
      {decision.status !== 'pending' && <button className="quiet" onClick={() => onAction('revert')}>Revert to AI</button>}
      <button className="quiet" onClick={() => onAction('accept')}>Preview</button>
    </div>
    {replaceMode && isBroll && <div className="replace-picker"><small>REPLACE FROM INDEXED, RIGHTS-SAFE MEDIA</small>{beat.candidates.filter((candidate) => candidate.eligible && candidate.asset).map((candidate) => <button key={candidate.assetId} onClick={() => {
      setReplaceMode(false);
      const original = beat.originalOperation;
      const operation: EditOperation = original?.type === 'broll'
        ? { ...original, assetId: candidate.assetId }
        : {
          id: `broll-${section.id}`,
          type: 'broll',
          sourceStart: 0,
          sourceEnd: Math.min(candidate.asset?.durationSeconds ?? section.end - section.start, section.end - section.start),
          start: section.start,
          end: section.end,
          assetId: candidate.assetId,
          mode: 'full-screen',
          muted: true,
          reason: `Human selected ${candidate.asset?.fileName} for the Director B-roll recommendation.`,
          confidence: section.confidence,
        };
      onAction('replace-broll', { operation, reason: `Selected ${candidate.asset?.fileName} from the indexed eligible candidate list.` });
    }}>Use {candidate.asset?.fileName}</button>)}{beat.candidates.filter((candidate) => candidate.eligible && candidate.asset).length === 0 && <span>No eligible local replacement is available.</span>}</div>}
    <CandidateInspector beat={beat} data={data} />
  </article>;
}

export const DirectorReviewWorkspace: React.FC<{
  data: ReviewDataPayload;
  onReviewStateChange?: (review: ReviewState, ready: boolean) => void;
}> = ({ data, onReviewStateChange }) => {
  const playerRef = useRef<HTMLVideoElement>(null);
  const [review, setReview] = useState<ReviewState>(() => {
    try {
      const saved = window.localStorage.getItem(`director-review:${data.projectId}`);
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (isReviewStateCompatible(data, parsed)) return parsed;
      }
    } catch { /* Corrupt or unavailable browser storage falls back to the persisted initial state. */ }
    return data.initialReview;
  });
  const [selectedId, setSelectedId] = useState('section-3');
  const [filter, setFilter] = useState('All');
  const [showControl, setShowControl] = useState(false);
  const [previewTime, setPreviewTime] = useState(60);
  React.useEffect(() => { try { window.localStorage.setItem(`director-review:${data.projectId}`, JSON.stringify(review)); } catch { /* Persistence is best-effort in restricted preview contexts. */ } }, [data.projectId, review]);
  const resolved = useMemo(() => updateReview(data, review), [data, review]);
  React.useEffect(() => {
    onReviewStateChange?.(review, resolved.readiness.ready);
  }, [onReviewStateChange, resolved.readiness.ready, review]);
  const decisions = new Map(review.decisions.map((decision) => [decision.beatId, decision]));
  const selectedBeat = data.beats.find((beat) => beat.section.id === selectedId) ?? data.beats[0];
  const selectedDecision = decisions.get(selectedBeat.section.id) ?? review.decisions[0];
  const counts = { total: data.beats.length, accepted: review.decisions.filter((decision) => decision.status === 'accepted').length, modified: review.decisions.filter((decision) => decision.status === 'modified').length, rejected: review.decisions.filter((decision) => decision.status === 'rejected').length, pending: review.decisions.filter((decision) => decision.status === 'pending').length };
  const filteredBeats = data.beats.filter((beat) => {
    const status = decisions.get(beat.section.id)?.status;
    if (filter === 'All') return true;
    if (filter === 'Needs Review') return status === 'pending';
    if (filter === 'B-roll') return beat.brollDecision?.decision === 'selected';
    if (filter === 'No Change') return beat.noBroll;
    return status === filter.toLowerCase();
  });
  const execution = data.directorExecution;
  const editorial = useMemo(() => summarizeReviewWorkspace(data, review), [data, review]);
  const directorQuality = data.directorQuality;
  const enrichment = data.editorialEnrichment;

  function selectBeat(beat: ReviewBeat): void {
    setSelectedId(beat.section.id);
    const mapped = Math.max(0, Math.min(data.preview.durationSeconds, beat.section.start - data.preview.sourceStart));
    setPreviewTime(mapped);
    if (playerRef.current) playerRef.current.currentTime = mapped;
  }
  function act(action: ReviewAction, options?: { operation?: EditOperation; displayText?: string; reason?: string }): void {
    setReview((current) => applyReviewAction(current, selectedBeat.section.id, action, options));
  }

  return <div className="review-shell">
    <header className="topbar"><div className="brand"><span className="brand-mark">✦</span><div><strong>DIRECTOR REVIEW</strong><small>{execution?.source === 'ai' ? 'AI-assisted sermon editing' : 'Deterministic fallback review'}</small></div></div><div className="project-title"><span className="live-dot" />{data.title}<span className="language">বাংলা · SOURCE FORMAT</span></div><div className="top-actions"><span className={`readiness ${resolved.readiness.ready ? 'ready' : 'blocked'}`}>{resolved.readiness.label}</span><span className="save-state">Saved to project host</span></div></header>
    <section className="editorial-summary">
      <Metric label="AI coverage" value={`${editorial.canonicalCoveragePercent.toFixed(1)}%`} />
      <Metric label="Meaningful edits" value={String(editorial.meaningfulEditCount)} tone={editorial.meaningfulEditCount ? 'green' : 'gold'} />
      <Metric label="Keep Pastor" value={`${editorial.keepPastorDuration.toFixed(0)}s`} />
      <Metric label="No Change" value={`${editorial.noChangeDuration.toFixed(0)}s`} />
      <Metric label="Graphics" value={String(editorial.graphics)} />
      <Metric label="B-roll" value={String(editorial.broll)} />
      <Metric label="Scripture" value={String(editorial.scripture)} />
      <Metric label="Reframes" value={String(editorial.reframes)} />
      <Metric label="Captions" value={String(editorial.captions)} />
      <Metric label="Director quality" value={directorQuality?.status ?? 'NOT SCORED'} tone={directorQuality?.status === 'LOW-ACTIVITY' ? 'gold' : 'green'} />
      <Metric label="Story untreated" value={String(directorQuality?.untreatedStorySections ?? 0)} tone={directorQuality?.untreatedStorySections ? 'gold' : undefined} />
      <Metric
        label="Enrichment"
        value={enrichment ? `${enrichment.outcome.toUpperCase()} · ${enrichment.enrichmentAttemptCount}` : directorQuality?.enrichmentTriggered ? 'REQUIRED · UNAVAILABLE' : 'NOT NEEDED'}
        tone={enrichment?.outcome === 'failed' || enrichment?.outcome === 'unavailable' ? 'gold' : enrichment?.outcome === 'succeeded' ? 'green' : undefined}
      />
    </section>
    <main className="workspace">
      <section className="preview-column"><div className="preview-toolbar"><SectionTitle eyebrow="01 · PREVIEW">Director preview</SectionTitle><div className="preview-tabs"><button className={!showControl ? 'active' : ''} onClick={() => setShowControl(false)}>AI Director</button><button className={showControl ? 'active' : ''} onClick={() => setShowControl(true)}>Control</button></div></div><div className="video-frame"><video ref={playerRef} controls src={showControl ? data.preview.controlUrl : data.preview.directorUrl} onTimeUpdate={(event) => setPreviewTime(event.currentTarget.currentTime)} /><div className="preview-badge">{showControl ? 'CONTROL' : 'AI DIRECTOR'} · {time(previewTime)}</div></div><div className="preview-meta"><span>Preview window <b>{time(data.preview.sourceStart)}—{time(data.preview.sourceEnd)}</b> source seconds</span><span>Audio <b>sermon authoritative · AAC</b></span></div><div className="proof-strip"><figure><img src={data.evidence.beforeFrame} alt="Before B-roll frame" /><figcaption>BEFORE · {time(19)}</figcaption></figure><figure className="active-proof"><img src={data.evidence.duringFrame} alt="During B-roll frame" /><figcaption>DURING B-ROLL · pressure cooker visible</figcaption></figure><figure><img src={data.evidence.afterFrame} alt="After B-roll frame" /><figcaption>AFTER · {time(101)}</figcaption></figure></div></section>
      <aside className="inspector"><div className="inspector-head"><SectionTitle eyebrow="02 · INSPECTOR">Director decision</SectionTitle><span className="beat-count">{selectedBeat.section.id}</span></div><div className="card-grid"><Metric label="Provider" value={execution?.provider ?? data.aiPlan.createdBy.provider} /><Metric label="Model" value={execution?.model ?? data.aiPlan.createdBy.model} /><Metric label="Fallback" value={execution?.fallbackUsed ? execution.fallbackReason ?? 'USED' : 'NO'} tone={execution?.fallbackUsed ? 'gold' : 'green'} /></div>{selectedBeat && <DecisionCard beat={selectedBeat} data={data} decision={selectedDecision} selected onSelect={() => undefined} onAction={act} />}<details className="explanation"><summary>Why did the Director do this?</summary><div className="chain"><span>Semantic beat</span><b>→</b><span>Reverent Retention</span><b>→</b><span>Local ranking</span><b>→</b><span>V3 placement</span></div><p>{selectedBeat.brollDecision?.reason ?? selectedBeat.section.reason}</p>{selectedBeat.placement && <p><b>V3:</b> {selectedBeat.placement.reason}</p>}<a href={data.evidence.explanationChain}>Open developer evidence</a></details></aside>
      <section className="timeline-column"><div className="timeline-head"><SectionTitle eyebrow="03 · BEAT REVIEW">Timeline / sermon map</SectionTitle><div className="progress"><span>{counts.total} decisions</span><b>{counts.accepted} accepted</b><b>{counts.modified} modified</b><b>{counts.rejected} rejected</b><strong>{counts.pending} pending</strong></div></div><div className="filters">{['All', 'Needs Review', 'B-roll', 'No Change', 'Accepted', 'Modified', 'Rejected'].map((item) => <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{item}</button>)}      </div><div className="timeline"><div className="axis"><span>{time(data.preview.sourceStart)}</span><span>SERMON MAP</span><span>{time(data.preview.sourceEnd)}</span></div>{filteredBeats.map((beat) => { const decision = decisions.get(beat.section.id)!; const timelineDuration = Math.max(1, data.preview.sourceEnd - data.preview.sourceStart); const left = `${Math.max(0, ((beat.section.start - data.preview.sourceStart) / timelineDuration) * 100)}%`; const width = `${Math.max(3, ((beat.section.end - beat.section.start) / timelineDuration) * 100)}%`; return <button key={beat.section.id} className={`timeline-event ${decision.status} ${beat.noBroll ? 'no-broll' : 'broll'}`} style={{ left, width }} onClick={() => selectBeat(beat)}><small>{time(beat.section.start)} · {(beat.section.intensity ?? 'normal-teaching').replace('reverent-', '').replace('normal-', '').replace('story-', '').toUpperCase()}</small><b>{beat.section.type.replaceAll('-', ' ')}</b><span>{beat.noBroll ? 'KEEP PASTOR / NO CHANGE' : operationName(beat.originalOperation)}</span></button>; })}</div><div className="decision-list">{filteredBeats.map((beat) => <DecisionCard key={beat.section.id} beat={beat} data={data} decision={decisions.get(beat.section.id)!} selected={beat.section.id === selectedId} onSelect={() => selectBeat(beat)} onAction={(action, options) => { setSelectedId(beat.section.id); setReview((current) => applyReviewAction(current, beat.section.id, action, options)); }} />)}</div><div className={`readiness-panel ${resolved.readiness.ready ? 'ready' : ''}`}><div><small>APPROVAL READINESS</small><h3>{resolved.readiness.label}</h3></div>{resolved.readiness.blockers.length > 0 ? <div className="blockers">{resolved.readiness.blockers.map((blocker) => <span key={blocker}>⚠ {blocker}</span>)}</div> : <span className="ready-copy">Reviewed plan is valid and downstream render is available.</span>}<div className="save-note">{review.updatedAt ? `Last review change ${new Date(review.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Unsaved review changes'}</div></div></section>
    </main>
  </div>;
};
