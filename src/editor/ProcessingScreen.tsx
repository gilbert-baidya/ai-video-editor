import React, { useEffect, useState } from 'react';
import type { EditorSession } from './useEditorSession.ts';
import { FilmIcon, CheckIcon } from './Icons.tsx';

export const ProcessingScreen: React.FC<{ session: EditorSession }> = ({ session }) => {
  const { project, runStage, act } = session;
  if (!project) return null;

  const ingest = project.workflow.stages.ingest;
  const transcript = project.workflow.stages.transcript;
  const director = project.workflow.stages.director;

  const getProgress = () => {
    if (director.status === 'running') return { phase: 'Extracting Clips', percent: 75, message: 'AI is discovering the most engaging moments...' };
    if (transcript.status === 'running') return { phase: 'Transcribing', percent: 45, message: 'Converting audio to text with timestamps...' };
    if (ingest.status === 'running') return { phase: 'Importing Media', percent: 15, message: 'Downloading and preparing source video...' };
    
    if (transcript.status === 'completed' && director.status !== 'completed') return { phase: 'Ready', percent: 50, message: 'Audio transcribed successfully. Ready to find Shorts.' };
    if (director.status === 'completed') return { phase: 'Complete', percent: 100, message: 'Shorts are ready for review.' };
    if (ingest.status === 'completed') return { phase: 'Ready', percent: 25, message: 'Media imported. Ready to transcribe.' };
    
    return { phase: 'Initializing', percent: 5, message: 'Preparing workflow...' };
  };

  const progress = getProgress();
  const busy = ingest.status === 'running' || transcript.status === 'running' || director.status === 'running';
  
  // Auto-advance stages to simplify user journey
  useEffect(() => {
    if (session.busy) return;
    if (ingest.status === 'completed' && transcript.status === 'not-started') {
      void runStage('transcript');
    }
  }, [ingest.status, transcript.status, session.busy, runStage]);

  return (
    <div className="view-content-wrapper" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '40px' }}>
      
      <div className="analysis-progress-card" style={{ width: '100%', maxWidth: '650px', background: 'var(--bg-surface)', border: '1px solid var(--border-accent)', borderRadius: '16px', padding: '40px', textAlign: 'center', boxShadow: '0 10px 30px rgba(99, 102, 241, 0.15)' }}>
        <div style={{ width: '64px', height: '64px', borderRadius: '16px', background: 'rgba(99, 102, 241, 0.1)', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
          <FilmIcon size={32} />
        </div>
        
        <h2 style={{ fontSize: '24px', fontWeight: 700, color: '#FFFFFF', marginBottom: '8px' }}>{progress.phase}</h2>
        <p style={{ fontSize: '15px', color: 'var(--text-secondary)', marginBottom: '32px' }}>{progress.message}</p>
        
        {session.actionError && (
          <div style={{ marginBottom: '24px', padding: '12px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '8px', color: '#F87171', fontSize: '13px' }}>
            {session.actionError}
            <button onClick={() => session.clearError()} style={{ display: 'block', margin: '8px auto 0', padding: '4px 12px', background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '4px', color: '#FFF', cursor: 'pointer' }}>Dismiss</button>
          </div>
        )}

        <div style={{ width: '100%', height: '8px', background: 'var(--bg-sidebar)', borderRadius: '4px', overflow: 'hidden', marginBottom: '32px' }}>
          <div style={{ width: `${progress.percent}%`, height: '100%', background: 'var(--accent-gradient)', transition: 'width 0.4s ease', boxShadow: '0 0 10px rgba(99, 102, 241, 0.5)' }} />
        </div>

        {!busy && progress.percent < 100 && (
          <button 
            className="btn-primary" 
            onClick={() => {
              if (transcript.status === 'completed') void runStage('director');
              else if (ingest.status === 'completed') void runStage('transcript');
            }}
            style={{ padding: '12px 32px', fontSize: '15px', fontWeight: 600, background: 'var(--accent-primary)', color: '#FFF', border: 'none', borderRadius: '8px', cursor: 'pointer', boxShadow: '0 4px 12px rgba(99, 102, 241, 0.3)' }}
          >
            {transcript.status === 'completed' ? 'Discover Shorts' : 'Continue'}
          </button>
        )}
      </div>
      
    </div>
  );
};
