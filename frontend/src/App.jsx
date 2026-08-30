import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import Message from './components/Message.jsx';
import Composer from './components/Composer.jsx';
import DataStatusBar from './components/DataStatusBar.jsx';
import LeadershipModal from './components/LeadershipModal.jsx';
import AgentActivity from './components/AgentActivity.jsx';

const SUGGESTIONS = [
  "How's our pipeline looking for the energy sector this quarter?",
  'Total open pipeline value, weighted by probability, broken down by stage',
  'Which sectors generate the most delivered revenue?',
  'How are collections? Any large receivables outstanding?',
  'Break down work orders by execution status',
  'Which sales owner has the strongest pipeline?',
];

const WELCOME = {
  role: 'assistant',
  content:
    "Hi — I'm the Skylark Drones BI agent. I read your live **Deals** and **Work Orders** boards from Monday.com and answer founder-level questions about pipeline, revenue, sector performance and delivery.\n\nAsk me something, or try a suggestion below.",
  meta: { welcome: true },
};

export default function App() {
  const [messages, setMessages] = useState([WELCOME]);
  const [conversationId, setConversationId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState({ steps: [], phase: 'idle' });
  const [health, setHealth] = useState(null);
  const [overview, setOverview] = useState(null);
  const [showReport, setShowReport] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth({ status: 'unreachable' }));
    api.overview().then(setOverview).catch(() => {});
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy, activity]);

  async function send(text) {
    if (!text.trim() || busy) return;
    setMessages((m) => [...m, { role: 'user', content: text }]);
    setBusy(true);
    setActivity({ steps: [], phase: 'thinking' });

    let answer = '';
    let charts = [];
    let meta = {};

    try {
      await api.chatStream(text, conversationId, (ev) => {
        if (ev.type === 'conversation') setConversationId(ev.conversationId);
        else if (ev.type === 'status') {
          setActivity((a) => ({ ...a, steps: [...a.steps, { id: `s${a.steps.length}`, label: ev.label, state: 'done' }] }));
        } else if (ev.type === 'tool') {
          setActivity((a) => ({ ...a, steps: [...a.steps, { id: ev.id, label: ev.label, state: 'run' }] }));
        } else if (ev.type === 'tool_done') {
          setActivity((a) => ({
            ...a,
            steps: a.steps.map((s) => (s.id === ev.id ? { ...s, state: 'done', summary: ev.summary } : s)),
          }));
        } else if (ev.type === 'answer') {
          answer = ev.text;
          setActivity((a) => ({ ...a, phase: 'answering' }));
        } else if (ev.type === 'charts') {
          charts = ev.charts || [];
        } else if (ev.type === 'done') {
          meta = ev.meta || {};
        } else if (ev.type === 'error') {
          throw new Error(ev.error || 'stream error');
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
    try {
      await api.refresh();
      setOverview(await api.overview());
    } catch { /* ignore */ }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">◈</span>
          <div>
            <h1>Skylark Drones · BI Agent</h1>
            <p>Conversational business intelligence over Monday.com</p>
          </div>
        </div>
        <div className="topbar-actions">
          <span className={`pill ${health?.status === 'ok' ? 'ok' : 'warn'}`}>
            {health?.status === 'ok' ? `Monday: ${health.monday?.account || 'connected'}` : 'Monday: checking…'}
          </span>
          <span className={`pill ${health?.llm ? 'ok' : 'warn'}`}>
            {health?.llm ? `LLM: ${health.model}` : 'LLM: offline'}
          </span>
          <button className="btn primary" onClick={() => setShowReport(true)}>Leadership Update</button>
        </div>
      </header>

      <DataStatusBar overview={overview} onRefresh={refreshData} />

      <main className="chat" ref={scrollRef}>
        {messages.map((m, i) => <Message key={i} message={m} />)}

        {busy && <AgentActivity steps={activity.steps} phase={activity.phase} />}

        {messages.length <= 1 && !busy && (
          <div className="suggestions">
            {SUGGESTIONS.map((s) => (
              <button key={s} className="chip" onClick={() => send(s)}>{s}</button>
            ))}
          </div>
        )}
      </main>

      <Composer onSend={send} busy={busy} />

      {showReport && <LeadershipModal onClose={() => setShowReport(false)} />}
    </div>
  );
}
