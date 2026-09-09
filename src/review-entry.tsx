import React from 'react';
import { createRoot } from 'react-dom/client';
import { ProductHostWorkspace } from './ProductHostWorkspace.tsx';
import './director-review.css';
import './director-review-overrides.css';
import './director-review-text.css';
import './product-workspace.css';

const root = document.getElementById('root');
if (!root) throw new Error('Director Review root element is missing.');

createRoot(root).render(<ProductHostWorkspace />);
