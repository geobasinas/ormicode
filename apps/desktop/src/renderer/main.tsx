import { createRoot } from 'react-dom/client';
import { App } from '@ormicode/client-ui';
import { electronPlatform } from '@ormicode/client-platform';
import '@ormicode/client-ui/index.css';
import './theme.css';

createRoot(document.getElementById('root')!).render(<App platform={electronPlatform()} />);
