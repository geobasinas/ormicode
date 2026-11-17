export { App } from './routes/App.tsx';
export { usePlatform } from './lib/platform.ts';
export { applyTheme, themeByName } from './lib/theme.ts';
export { defaultLayout, validateLayout, applyLayout } from './lib/layout.ts';
export type { LayoutDescriptor, RegionState, RegionId } from './lib/layout.ts';
export { useSessions } from './features/session/useSessions.ts';
export { useTranscript } from './features/session/useTranscript.ts';
