import { createRoot } from 'react-dom/client';

import { Portal } from './portal.tsx';
import './styles.css';

const root = document.getElementById('root');

if (root) {
  createRoot(root).render(<Portal />);
}
