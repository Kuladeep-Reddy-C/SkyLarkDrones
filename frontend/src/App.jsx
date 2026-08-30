import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import Message from './components/Message.jsx';
import Composer from './components/Composer.jsx';
import DataStatusBar from './components/DataStatusBar.jsx';
import LeadershipModal from './components/LeadershipModal.jsx';

const SUGGESTIONS = [
  "How's our pipeline looking for the energy sector this quarter?",
  'What is our total open pipeline value, weighted by probability?',
  'Which sectors have the most won revenue?',
  'How healthy are our collections? Any big receivables outstanding?',
  'Break down work orders by execution status.',
  'Which sales owner has the strongest pipeline?',
];

const WELCOME = {
  role: 'assistant',
  content:
    "Hi — I'm the Skylark Drones BI agent. I read your live **Deals** and **Work Orders** boards from Monday.com and answer founder-level questions about pipeline, revenue, sector performance and delivery.\n\nAsk me something, or try one of the suggestions below.",
  meta: { welcome: true },
};

export default function App() {
  const [messages, setMessages] = useState([WELCOME]);
  const [conversationId, setConversationId] = useState(null);
  const [busy, setBusy] = useState(false);
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
  }, [messages, busy]);

  async function send(text) {
    if (!text.trim() || busy) return;
    setMessages((m) => [...m, { role: 'user', content: text }]);
    setBusy(true);
    try {
      const res = await api.chat(text, conversationId);
      setConversationId(res.conversationId);
      setMessages((m) => [...m, { role: 'assistant', content: res.reply, meta: res.meta }]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: `⚠️ ${err.message}`, meta: { error: true } },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function refreshData() {
    try {
      await api.refresh();
      const o = await api.overview();
      setOverview(o);
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
            {health?.status === 'ok'
              ? `Monday: ${health.monday?.account || 'connected'}`
              : `Monday: ${health?.monday?.connected ? 'ok' : 'checking…'}`}
          </span>
          <span className={`pill ${health?.llm ? 'ok' : 'warn'}`}>
            {health?.llm ? `LLM: ${health.model}` : 'LLM: offline'}
          </span>
          <button className="btn primary" onClick={() => setShowReport(true)}>
            Leadership Update
          </button>
        </div>
      </header>

      <DataStatusBar overview={overview} onRefresh={refreshData} />

      <main className="chat" ref={scrollRef}>
        {messages.map((m, i) => (
          <Message key={i} message={m} />
        ))}
        {busy && (
          <div className="msg assistant">
            <div className="bubble typing"><span /><span /><span /></div>
          </div>
        )}

        {messages.length <= 1 && (
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
