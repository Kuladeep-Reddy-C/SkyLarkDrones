import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { useTheme } from './lib/theme.js';
import { Icon } from './lib/icons.jsx';
import Sidebar from './components/Sidebar.jsx';
import EmptyState from './components/EmptyState.jsx';
import Message from './components/Message.jsx';
import Composer from './components/Composer.jsx';
import AgentTrace from './components/AgentTrace.jsx';
import SnapshotChip from './components/SnapshotChip.jsx';
import ReportDrawer from './components/ReportDrawer.jsx';

export default function App() {
  const [theme, toggleTheme] = useTheme();
  const [messages, setMessages] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState({ steps: [], phase: 'idle' });
  const [health, setHealth] = useState(null);
  const [overview, setOverview] = useState(null);
  const [showReport, setShowReport] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const threadRef = useRef(null);

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth({ status: 'unreachable' }));
    api.overview().then(setOverview).catch(() => {});
  }, []);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy, activity]);

  async function send(text) {
    if (!text.trim() || busy) return;
    setRailOpen(false);
    setMessages((m) => [...m, { role: 'user', content: text }]);
    setBusy(true);
    setActivity({ steps: [], phase: 'thinking' });

    let answer = '';
    let charts = [];
    let meta = {};
    try {
      await api.chatStream(text, conversationId, (ev) => {
        switch (ev.type) {
          case 'conversation': setConversationId(ev.conversationId); break;
          case 'status':
            setActivity((a) => ({ ...a, steps: [...a.steps, { id: `s${a.steps.length}`, label: ev.label, state: 'done' }] }));
            break;
          case 'tool':
            setActivity((a) => ({ ...a, steps: [...a.steps, { id: ev.id, label: ev.label, state: 'run' }] }));
            break;
          case 'tool_done':
            setActivity((a) => ({
              ...a,
              steps: a.steps.map((s) => (s.id === ev.id ? { ...s, state: 'done', summary: ev.summary } : s)),
            }));
            break;
          case 'answer': answer = ev.text; setActivity((a) => ({ ...a, phase: 'answering' })); break;
          case 'charts': charts = ev.charts || []; break;
          case 'done': meta = ev.meta || {}; break;
          case 'error': throw new Error(ev.error || 'stream error');
          default: break;
        }
      });
      setMessages((m) => [...m, { role: 'assistant', content: answer || '(no answer)', charts, meta }]);
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', content: `⚠️ ${err.message}`, meta: { error: true } }]);
    } finally {
      setBusy(false);
      setActivity({ steps: [], phase: 'idle' });
    }
  }

  async function refreshData() {
    try { await api.refresh(); setOverview(await api.overview()); } catch { /* ignore */ }
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
        onReport={() => { setShowReport(true); setRailOpen(false); }}
        theme={theme}
        onToggleTheme={toggleTheme}
        health={health}
      />

      <div className="workspace">
        <div className="topbar">
          <button className="icon-btn rail-toggle" onClick={() => setRailOpen(true)} aria-label="Menu">
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
