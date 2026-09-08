import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DirectorReviewWorkspace, type ReviewDataPayload } from './DirectorReviewWorkspace.tsx';
import './director-review.css';
import './director-review-overrides.css';
import './director-review-text.css';

const root = document.getElementById('root');
if (!root) throw new Error('Director Review root element is missing.');

const App: React.FC = () => {
  const [data, setData] = useState<ReviewDataPayload>();
  const [error, setError] = useState<string>();
  useEffect(() => { fetch('./review-data.json').then((response) => { if (!response.ok) throw new Error(`Review artifact unavailable (${response.status}).`); return response.json() as Promise<ReviewDataPayload>; }).then(setData).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason))); }, []);
  if (error) return <main style={{ color: '#f3c977', padding: 40, fontFamily: 'system-ui' }}><h1>Director Review unavailable</h1><p>{error}</p></main>;
  if (!data) return <main style={{ color: '#9eafb4', padding: 40, fontFamily: 'system-ui' }}>Loading Director artifacts…</main>;
  return <DirectorReviewWorkspace data={data} />;
};

createRoot(root).render(<App />);
