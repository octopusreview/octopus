import React from 'react';
import { createRoot } from 'react-dom/client';
import { IndexingLogs } from '@/components/indexing-logs';
const listeners = new Map<string, (event: unknown) => void>();
const channel = { bind: (name: string, cb: (event: unknown) => void) => listeners.set(name, cb), unbind: (name: string) => listeners.delete(name) };
Object.assign(window, { privacyFixture: { channel, emit: (event: unknown) => listeners.get('index-log')?.(event) } });
window.fetch = async () => Response.json({ logs: [], attempt: null, indexAttemptId: null });
createRoot(document.getElementById('root')!).render(<IndexingLogs repoId="repo" orgId="org" initialStatus="indexing" provider="github" />);
