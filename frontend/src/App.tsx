import { useEffect, useRef, useState } from 'react';
import { api } from './api.ts';
import { useTheme } from './lib/theme.ts';
import { Icon } from './lib/icons.tsx';
import Sidebar from './components/Sidebar.tsx';
import EmptyState from './components/EmptyState.tsx';
import Message from './components/Message.tsx';
import Composer from './components/Composer.tsx';
import AgentTrace from './components/AgentTrace.tsx';
import SnapshotChip from './components/SnapshotChip.tsx';
import ReportDrawer from './components/ReportDrawer.tsx';
import type {
  AgentMeta,
  ChartSpec,
  ChatMessage,
  HealthResponse,
  OverviewResponse,
  TraceStep,
} from './types.ts';

type Phase = 'idle' | 'thinking' | 'answering';

export default function App() {
  const [theme, toggleTheme] = useTheme();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<{ steps: TraceStep[]; phase: Phase }>({
    steps: [],
    phase: 'idle',
  });
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .health()
      .then(setHealth)
      .catch(() => setHealth({ status: 'unreachable' }));
    api
      .overview()
      .then(setOverview)
      .catch(() => {});
  }, []);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy, activity]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setRailOpen(false);
    setMessages((m) => [...m, { role: 'user', content: text }]);
    setBusy(true);
    setActivity({ steps: [], phase: 'thinking' });

    let answer = '';
    let charts: ChartSpec[] = [];
    let meta: AgentMeta = {};
    try {
      await api.chatStream(text, conversationId, (ev) => {
        switch (ev.type) {
          case 'conversation':
            setConversationId(ev.conversationId);
            break;
          case 'status':
            setActivity((a) => ({
              ...a,
              steps: [...a.steps, { id: `s${a.steps.length}`, label: ev.label, state: 'done' }],
            }));
            break;
          case 'tool':
            setActivity((a) => ({
              ...a,
              steps: [...a.steps, { id: ev.id, label: ev.label, state: 'run' }],
            }));
            break;
          case 'tool_done':
            setActivity((a) => ({
              ...a,
              steps: a.steps.map((s) =>
                s.id === ev.id ? { ...s, state: 'done', summary: ev.summary } : s,
              ),
            }));
            break;
          case 'answer':
            answer = ev.text;
            setActivity((a) => ({ ...a, phase: 'answering' }));
            break;
          case 'charts':
            charts = ev.charts ?? [];
            break;
          case 'done':
            meta = ev.meta ?? {};
            break;
          case 'error':
            throw new Error(ev.error || 'stream error');
        }
      });
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: answer || '(no answer)', charts, meta },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: `⚠️ ${msg}`, meta: { error: true } },
      ]);
    } finally {
      setBusy(false);
      setActivity({ steps: [], phase: 'idle' });
    }
  }

  async function refreshData() {
    try {
      await api.refresh();
      setOverview(await api.overview());
    } catch {
      /* ignore */
    }
  }
  function newConversation() {
    if (busy) return;
    setMessages([]);
    setConversationId(null);
    setRailOpen(false);
  }

  const turns = messages.filter((m) => m.role === 'user').map((m) => m.content);

  return (
    <div className="shell">
      <Sidebar
        open={railOpen}
        onClose={() => setRailOpen(false)}
        turns={turns}
        onNew={newConversation}
        onReport={() => {
          setShowReport(true);
          setRailOpen(false);
        }}
        theme={theme}
        onToggleTheme={toggleTheme}
        health={health}
      />

      <div className="workspace">
        <div className="topbar">
          <button
            className="icon-btn rail-toggle"
            onClick={() => setRailOpen(true)}
            aria-label="Menu"
          >
            <Icon.chevron width={15} height={15} />
          </button>
          <h2>{messages.length ? 'Conversation' : 'Ask anything'}</h2>
          <SnapshotChip overview={overview} onRefresh={refreshData} />
        </div>

        <div className="thread" ref={threadRef}>
          <div className="thread-inner">
            {messages.length === 0 && !busy && (
              <EmptyState onPick={send} counts={overview?.counts} />
            )}
            {messages.map((m, i) => (
              <Message key={i} message={m} index={turns.indexOf(m.content)} />
            ))}
            {busy && <AgentTrace steps={activity.steps} phase={activity.phase} />}
          </div>
        </div>

        <Composer onSend={send} busy={busy} />
      </div>

      {showReport && <ReportDrawer onClose={() => setShowReport(false)} />}
    </div>
  );
}
