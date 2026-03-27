import { useEffect, useState } from "react";
import { initialLiveAppState } from "./defaultState";
import { useSoftboxRuntime } from "./adapter/runtime";

const queueSummary = [
  { id: "review", label: "Review", count: 18, hint: "Runs waiting for human sign-off" },
  { id: "draft", label: "Draft", count: 9, hint: "Work staged but not previewed yet" },
  { id: "blocked", label: "Blocked", count: 4, hint: "Runs waiting on missing env or API state" },
] as const;

const liveRuns = [
  {
    id: "run-2048",
    title: "CRM pipeline refresh",
    status: "Healthy preview",
    summary: "Refreshed summary cards, tightened activity stream spacing, and preserved existing state.",
    owner: "Primary agent",
  },
  {
    id: "run-2051",
    title: "Billing workflow pass",
    status: "Needs review",
    summary: "Added retry controls and a new queue health row before promotion.",
    owner: "Worker + validation",
  },
  {
    id: "run-2055",
    title: "Marketing site rewrite",
    status: "Blocked",
    summary: "Missing live API key in preview environment. Waiting before rebuild resumes.",
    owner: "Shell host",
  },
] as const;

const releaseModes = [
  {
    id: "guarded",
    name: "Guarded",
    text: "Preview must mount and report healthy before promotion.",
  },
  {
    id: "fast",
    name: "Fast lane",
    text: "Promote smaller safe UI updates after a quick preview pass.",
  },
] as const;

const recentNotes = [
  "Queue worker recovered 3 previously stale runs.",
  "Preview host stayed stable during the last 12 app swaps.",
  "Latest pipeline run published state back into the shell.",
];

export default function App() {
  const { initialState, publishState } = useSoftboxRuntime();
  const [focusQueue, setFocusQueue] = useState(initialState.focusQueue);
  const [selectedRunId, setSelectedRunId] = useState(initialState.selectedRunId);
  const [releaseMode, setReleaseMode] = useState(initialState.releaseMode);

  useEffect(() => {
    publishState({
      focusQueue,
      selectedRunId,
      releaseMode,
    });
  }, [focusQueue, publishState, releaseMode, selectedRunId]);

  const activeQueue =
    queueSummary.find((queue) => queue.id === focusQueue) ?? queueSummary[0];
  const activeRun = liveRuns.find((run) => run.id === selectedRunId) ?? liveRuns[0];

  return (
    <div className="dashboard">
      <header className="hero">
        <div>
          <p className="eyebrow">Softbox bundled example</p>
          <h1>Agentic release control for Vite apps</h1>
          <p className="lede">
            A starter dashboard that works standalone and inside the Softbox shell.
            Use it as the default seed app or copy it to start a new runtime-ready app.
          </p>
        </div>
        <div className="hero-card">
          <span className="hero-label">Active release mode</span>
          <strong>{releaseModes.find((mode) => mode.id === releaseMode)?.name}</strong>
          <p>{releaseModes.find((mode) => mode.id === releaseMode)?.text}</p>
        </div>
      </header>

      <section className="metrics">
        <article className="metric-card">
          <span className="metric-label">Shell stability</span>
          <strong>99.94%</strong>
          <p>Recent preview swaps completed without host teardown.</p>
        </article>
        <article className="metric-card">
          <span className="metric-label">Preview queue</span>
          <strong>31 runs</strong>
          <p>Across review, draft, and blocked lanes.</p>
        </article>
        <article className="metric-card">
          <span className="metric-label">Promotion cadence</span>
          <strong>6 today</strong>
          <p>Guarded promotion remains the default path.</p>
        </article>
      </section>

      <main className="content-grid">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Queues</h2>
              <p>Pick the operating lane you want to focus on.</p>
            </div>
            <span className="badge">{activeQueue.label}</span>
          </div>
          <div className="queue-list">
            {queueSummary.map((queue) => (
              <button
                key={queue.id}
                className={queue.id === focusQueue ? "queue-item active" : "queue-item"}
                onClick={() => setFocusQueue(queue.id)}
                type="button"
              >
                <div>
                  <strong>{queue.label}</strong>
                  <p>{queue.hint}</p>
                </div>
                <span>{queue.count}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Pipeline runs</h2>
              <p>These are the live candidate builds moving through preview.</p>
            </div>
            <span className="badge">{activeRun.status}</span>
          </div>
          <div className="run-list">
            {liveRuns.map((run) => (
              <button
                key={run.id}
                className={run.id === selectedRunId ? "run-item active" : "run-item"}
                onClick={() => setSelectedRunId(run.id)}
                type="button"
              >
                <div>
                  <strong>{run.title}</strong>
                  <p>{run.summary}</p>
                </div>
                <span>{run.owner}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Release mode</h2>
              <p>Switch the default posture for incoming app changes.</p>
            </div>
            <span className="badge">{releaseMode}</span>
          </div>
          <div className="mode-list">
            {releaseModes.map((mode) => (
              <button
                key={mode.id}
                className={mode.id === releaseMode ? "mode-item active" : "mode-item"}
                onClick={() => setReleaseMode(mode.id)}
                type="button"
              >
                <strong>{mode.name}</strong>
                <p>{mode.text}</p>
              </button>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Recent notes</h2>
              <p>Short operational updates that prove the app is stateful.</p>
            </div>
            <span className="badge">Live</span>
          </div>
          <ul className="note-list">
            {recentNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="footer">
        <span>Current shell state publishes queue, run selection, and release mode.</span>
        <span>Fallback state: {initialLiveAppState.focusQueue} / {initialLiveAppState.releaseMode}</span>
      </footer>
    </div>
  );
}
