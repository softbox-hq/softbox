import { useEffect, useState } from "react";
import { initialLiveAppState } from "./defaultState";
import { useSoftboxRuntime } from "./adapter/runtime";

const laneOrder = ["draft", "review", "healthy-preview", "blocked"] as const;

type LaneId = (typeof laneOrder)[number];
type AppRoute = "/" | "/about";
type ReleaseModeId = "guarded" | "fast";

type LiveRun = {
  id: string;
  title: string;
  lane: LaneId;
  status: string;
  summary: string;
  owner: string;
  updatedAt: string;
  nextStep: string;
};

type TimelineEvent = {
  time: string;
  title: string;
  detail: string;
  stage: string;
};

function readBrowserRoute(): AppRoute | null {
  if (typeof window === "undefined") {
    return null;
  }
  return isAppRoute(window.location.pathname) ? window.location.pathname : null;
}

function syncBrowserRoute(route: AppRoute) {
  if (typeof window === "undefined") {
    return;
  }
  if (window.location.pathname === route) {
    return;
  }
  const nextUrl = `${route}${window.location.search}${window.location.hash}`;
  window.history.pushState(window.history.state, "", nextUrl);
}

const laneConfig: Record<LaneId, { label: string; hint: string }> = {
  draft: {
    label: "Draft",
    hint: "Queued changes waiting for a first preview build.",
  },
  review: {
    label: "Review",
    hint: "Candidates ready for human sign-off before promotion.",
  },
  "healthy-preview": {
    label: "Healthy Preview",
    hint: "Stable previews that can safely promote next.",
  },
  blocked: {
    label: "Blocked",
    hint: "Runs stalled by missing env, APIs, or upstream state.",
  },
};

const liveRuns: LiveRun[] = [
  {
    id: "run-2044",
    title: "Support center tidy-up",
    lane: "draft",
    status: "Draft",
    summary: "Queued help-center card cleanup and search empty-state refinements before the first preview.",
    owner: "Primary agent",
    updatedAt: "Queued 11m ago",
    nextStep: "Await first preview",
  },
  {
    id: "run-2047",
    title: "Pricing page motion pass",
    lane: "draft",
    status: "Draft",
    summary: "Staged a tighter hero motion treatment and CTA spacing pass, but it has not built yet.",
    owner: "Worker lane",
    updatedAt: "Queued 6m ago",
    nextStep: "Needs build slot",
  },
  {
    id: "run-2051",
    title: "Billing workflow pass",
    lane: "review",
    status: "Review",
    summary: "Added retry controls and a queue-health row, now waiting for a guarded approval pass.",
    owner: "Worker + validation",
    updatedAt: "Review ready",
    nextStep: "Human sign-off",
  },
  {
    id: "run-2058",
    title: "Retention email composer",
    lane: "review",
    status: "Review",
    summary: "Refined copy grouping and fallback handling so the reviewer can compare template variants cleanly.",
    owner: "Content agent",
    updatedAt: "Review queued",
    nextStep: "Content approval",
  },
  {
    id: "run-2048",
    title: "CRM pipeline refresh",
    lane: "healthy-preview",
    status: "Healthy preview",
    summary: "Refreshed summary cards, tightened activity spacing, and preserved state across preview swaps.",
    owner: "Primary agent",
    updatedAt: "Healthy 18m",
    nextStep: "Promote when ready",
  },
  {
    id: "run-2060",
    title: "Onboarding checklist polish",
    lane: "healthy-preview",
    status: "Healthy preview",
    summary: "Previewed a lighter onboarding sequence with the final health probes already passing.",
    owner: "Shell host",
    updatedAt: "Healthy 7m",
    nextStep: "Watch health probes",
  },
  {
    id: "run-2055",
    title: "Marketing site rewrite",
    lane: "blocked",
    status: "Blocked",
    summary: "Missing live API key in preview environment. Rebuild is paused until the secret is restored.",
    owner: "Shell host",
    updatedAt: "Blocked 13m",
    nextStep: "Restore API key",
  },
];

const runTimelineById: Record<string, TimelineEvent[]> = {
  "run-2044": [
    {
      time: "10:18",
      title: "Prompt claimed",
      detail: "Primary agent picked up the support-center tidy-up request and scoped the first pass.",
      stage: "Agent",
    },
    {
      time: "10:11",
      title: "Draft assembled",
      detail: "Worker staged the empty-state copy and support card cleanup into a single draft bundle.",
      stage: "Build",
    },
    {
      time: "10:03",
      title: "Assets reused",
      detail: "Existing icon and article metadata were reused to keep the first preview lean.",
      stage: "Prep",
    },
    {
      time: "09:58",
      title: "Queue reserved",
      detail: "Draft lane reserved a fresh build slot but has not started the preview mount yet.",
      stage: "Queue",
    },
    {
      time: "09:46",
      title: "Request logged",
      detail: "Softbox recorded the support cleanup prompt and attached it to the draft board column.",
      stage: "Runtime",
    },
  ],
  "run-2047": [
    {
      time: "10:20",
      title: "Motion spec trimmed",
      detail: "Pricing hero motion was shortened to keep the staged candidate within the safe animation budget.",
      stage: "UI",
    },
    {
      time: "10:13",
      title: "CTA spacing revised",
      detail: "Draft candidate picked up tighter button spacing and denser proof-point rhythm.",
      stage: "Build",
    },
    {
      time: "10:06",
      title: "Validation queued",
      detail: "Worker queued a first preview build behind the current CRM and onboarding healthy previews.",
      stage: "Queue",
    },
    {
      time: "09:55",
      title: "Prompt claimed",
      detail: "Worker lane accepted the pricing motion task and started a draft-only rewrite path.",
      stage: "Agent",
    },
    {
      time: "09:41",
      title: "Scope narrowed",
      detail: "Task was narrowed to hero motion and CTA spacing to avoid touching pricing logic.",
      stage: "Prep",
    },
  ],
  "run-2051": [
    {
      time: "10:06",
      title: "Retries enabled",
      detail: "Billing preview now exposes manual retry controls for failed sync steps.",
      stage: "Build",
    },
    {
      time: "09:52",
      title: "Queue health row added",
      detail: "Review build gained a queue-health row so sign-off can assess lane stability faster.",
      stage: "UI",
    },
    {
      time: "09:34",
      title: "Snapshot compared",
      detail: "Validation compared the billing candidate against the previous artifact before review handoff.",
      stage: "Checks",
    },
    {
      time: "09:18",
      title: "Review notes attached",
      detail: "Worker attached reviewer notes covering retry behavior and promotion risk.",
      stage: "Review",
    },
    {
      time: "08:59",
      title: "Prompt claimed",
      detail: "Validation agent queued the billing pass into the guarded review lane.",
      stage: "Agent",
    },
  ],
  "run-2058": [
    {
      time: "10:14",
      title: "Variant grouped",
      detail: "Composer preview now groups retention variants by audience before sign-off.",
      stage: "UI",
    },
    {
      time: "10:02",
      title: "Fallback copy tightened",
      detail: "Fallback handling was simplified so reviewers can compare final copy without template noise.",
      stage: "Content",
    },
    {
      time: "09:48",
      title: "Preview annotated",
      detail: "Reviewer checklist was attached to the candidate with notes on subject-line risk.",
      stage: "Review",
    },
    {
      time: "09:36",
      title: "Checks passed",
      detail: "Preflight checks cleared missing token and malformed template concerns.",
      stage: "Checks",
    },
    {
      time: "09:10",
      title: "Prompt claimed",
      detail: "Content agent claimed the composer rewrite and staged the updated email variants.",
      stage: "Agent",
    },
  ],
  "run-2048": [
    {
      time: "09:41",
      title: "Diff packaged",
      detail: "Worker bundled updated dashboard cards and persisted the refreshed app state.",
      stage: "Build",
    },
    {
      time: "09:28",
      title: "Preview booted",
      detail: "Shell mounted the candidate and confirmed the CRM widgets rendered without layout drift.",
      stage: "Preview",
    },
    {
      time: "09:14",
      title: "Queue checks passed",
      detail: "Validation finished the stale-job sweep and cleared the run for promotion readiness.",
      stage: "Checks",
    },
    {
      time: "08:57",
      title: "State replayed",
      detail: "Selected run and board focus state published back into the host runtime.",
      stage: "Runtime",
    },
    {
      time: "08:44",
      title: "Prompt claimed",
      detail: "Primary agent claimed the CRM refresh request and started the rewrite pass.",
      stage: "Agent",
    },
  ],
  "run-2060": [
    {
      time: "10:09",
      title: "Health probe green",
      detail: "Latest onboarding preview reported healthy twice in a row after mount.",
      stage: "Checks",
    },
    {
      time: "09:58",
      title: "Checklist reordered",
      detail: "New user onboarding steps were reordered to reduce friction before promotion.",
      stage: "UI",
    },
    {
      time: "09:46",
      title: "Preview compared",
      detail: "Host compared the onboarding candidate against the current live artifact for regressions.",
      stage: "Preview",
    },
    {
      time: "09:33",
      title: "State restored",
      detail: "Published checklist progress restored cleanly after the preview app remounted.",
      stage: "Runtime",
    },
    {
      time: "09:21",
      title: "Prompt claimed",
      detail: "Shell host accepted the onboarding polish request and routed it into healthy preview.",
      stage: "Agent",
    },
  ],
  "run-2055": [
    {
      time: "10:12",
      title: "API key missing",
      detail: "Preview environment reported a missing live marketing token and stopped the rebuild.",
      stage: "Blocked",
    },
    {
      time: "09:47",
      title: "Host retried",
      detail: "Shell host attempted a warm remount, but the env check failed before hydration.",
      stage: "Host",
    },
    {
      time: "09:21",
      title: "Artifact staged",
      detail: "Static rewrite bundle uploaded successfully and waited for preview env injection.",
      stage: "Upload",
    },
    {
      time: "09:03",
      title: "Promotion gate paused",
      detail: "Health checks were paused until the missing secret is restored in preview.",
      stage: "Checks",
    },
    {
      time: "08:38",
      title: "Prompt claimed",
      detail: "Shell host accepted the marketing rewrite request and kicked off the first build.",
      stage: "Agent",
    },
  ],
};

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

function isLaneId(value: string): value is LaneId {
  return laneOrder.some((lane) => lane === value);
}

function isAppRoute(value: string): value is AppRoute {
  return value === "/" || value === "/about";
}

function isReleaseModeId(value: string): value is ReleaseModeId {
  return releaseModes.some((mode) => mode.id === value);
}

export default function App() {
  const { initialState, publishState } = useSoftboxRuntime();
  const [route, setRoute] = useState<AppRoute>(() =>
    readBrowserRoute() ??
      (isAppRoute(initialState.route) ? initialState.route : (initialLiveAppState.route as AppRoute)),
  );
  const [focusQueue] = useState<LaneId>(() =>
    isLaneId(initialState.focusQueue)
      ? initialState.focusQueue
      : (initialLiveAppState.focusQueue as LaneId),
  );
  const [selectedRunId] = useState(() =>
    liveRuns.some((run) => run.id === initialState.selectedRunId)
      ? initialState.selectedRunId
      : initialLiveAppState.selectedRunId,
  );
  const [releaseMode, setReleaseMode] = useState<ReleaseModeId>(() =>
    isReleaseModeId(initialState.releaseMode)
      ? initialState.releaseMode
      : (initialLiveAppState.releaseMode as ReleaseModeId),
  );

  useEffect(() => {
    publishState({
      route,
      focusQueue,
      selectedRunId,
      releaseMode,
    });
  }, [focusQueue, publishState, releaseMode, route, selectedRunId]);

  useEffect(() => {
    syncBrowserRoute(route);
  }, [route]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handlePopState = () => {
      const nextRoute = readBrowserRoute();
      if (!nextRoute) {
        return;
      }
      setRoute(nextRoute);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const boardColumns = laneOrder.map((lane) => ({
    id: lane,
    ...laneConfig[lane],
    runs: liveRuns.filter((run) => run.lane === lane),
  }));
  const activeRun = liveRuns.find((run) => run.id === selectedRunId) ?? liveRuns[0];
  const activeTimeline = runTimelineById[activeRun.id] ?? [];
  const activeLane = laneConfig[activeRun.lane];
  const activeReleaseMode =
    releaseModes.find((mode) => mode.id === releaseMode) ?? releaseModes[0];
  const isAboutRouteActive = route === "/about";

  return (
    <div className="dashboard">
      <header className="hero">
        <div>
          <p className="eyebrow">Softbox bundled example</p>
          <h1>{isAboutRouteActive ? "About this release demo" : "Release overview for mutable Vite apps"}</h1>
          <p className="lede">
            {isAboutRouteActive
              ? "A secondary route that explains what this Softbox-ready example is meant to prove."
              : "Draft, review, healthy preview, and blocked releases stay visible at a glance without the full board view."}
          </p>
        </div>
        <div className="hero-card">
          <span className="hero-label">{isAboutRouteActive ? "Current route" : "Current focus"}</span>
          <strong>{isAboutRouteActive ? route : activeLane.label}</strong>
          <p>
            {isAboutRouteActive
              ? "The overview remains available at /. Use the blocked metric card or the back action below to switch views."
              : `${activeRun.title} is selected. Current promotion mode is ${activeReleaseMode.name.toLowerCase()}.`}
          </p>
        </div>
      </header>

      <section className="metrics">
        {boardColumns.map((column) => (
          <article
            key={column.id}
            className={
              column.id === focusQueue
                ? `metric-card metric-card--${column.id} active`
                : `metric-card metric-card--${column.id}`
            }
          >
            <span className="metric-label">{column.label}</span>
            <strong>{column.runs.length}</strong>
            <p>{column.hint}</p>
            {column.id === "blocked" ? (
              <button className="metric-route" onClick={() => setRoute("/about")} type="button">
                {isAboutRouteActive ? "Viewing /about" : "Open /about"}
              </button>
            ) : null}
          </article>
        ))}
      </section>

      {isAboutRouteActive ? (
        <main className="about-layout">
          <section className="panel about-panel">
            <div className="panel-header">
              <div>
                <h2>About</h2>
                <p>What this Softbox-ready demo is built to show.</p>
              </div>
              <span className="badge">/about</span>
            </div>
            <div className="about-copy">
              <p>
                This example stays small on purpose: it demonstrates a mutable inner app that can
                run standalone, mount inside the Softbox shell, and publish lightweight runtime
                state back to the host.
              </p>
              <p>
                Adding `/about` gives the app a second route for prompt-driven edits, route-level
                previews, and quick validation that stateful UI work can expand beyond a single
                overview screen.
              </p>
            </div>
            <div className="about-grid">
              <article className="about-card">
                <span className="detail-label">Runtime</span>
                <strong>Shell-compatible</strong>
                <p>The app keeps its wrapper thin and continues to publish route and release state.</p>
              </article>
              <article className="about-card">
                <span className="detail-label">Purpose</span>
                <strong>Secondary route</strong>
                <p>The blocked metric now exposes a visible path entry point to this `/about` view.</p>
              </article>
            </div>
            <div className="about-actions">
              <button className="route-link" onClick={() => setRoute("/")} type="button">
                Back to /
              </button>
            </div>
          </section>
        </main>
      ) : (
        <main className="detail-grid">
          <section className="panel detail-panel">
            <div className="panel-header">
              <div>
                <h2>Selected release</h2>
                <p>Operational context for the currently selected release.</p>
              </div>
              <span className="badge">{activeRun.status}</span>
            </div>
            <div className="detail-hero">
              <div>
                <span className="detail-label">Run</span>
                <strong>{activeRun.title}</strong>
                <p>{activeRun.summary}</p>
              </div>
              <span className="lane-chip prominent">{activeLane.label}</span>
            </div>
            <dl className="detail-facts">
              <div>
                <dt>Owner</dt>
                <dd>{activeRun.owner}</dd>
              </div>
              <div>
                <dt>Lane</dt>
                <dd>{activeLane.label}</dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd>{activeRun.updatedAt}</dd>
              </div>
              <div>
                <dt>Next step</dt>
                <dd>{activeRun.nextStep}</dd>
              </div>
            </dl>
            <div className="mode-toggle">
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

          <section className="panel timeline-panel">
            <div className="panel-header">
              <div>
                <h2>Activity timeline</h2>
                <p>Five recent events for the selected release.</p>
              </div>
              <span className="badge">{activeTimeline.length} events</span>
            </div>
            <div className="timeline-summary">
              <strong>{activeRun.title}</strong>
              <span>{activeRun.owner}</span>
            </div>
            <ol className="timeline-list">
              {activeTimeline.map((event) => (
                <li key={`${activeRun.id}-${event.time}-${event.title}`} className="timeline-item">
                  <span aria-hidden="true" className="timeline-dot" />
                  <div className="timeline-copy">
                    <div className="timeline-meta">
                      <strong>{event.title}</strong>
                      <span>{event.time}</span>
                    </div>
                    <p>{event.detail}</p>
                  </div>
                  <span className="timeline-stage">{event.stage}</span>
                </li>
              ))}
            </ol>
          </section>
        </main>
      )}

      <footer className="footer">
        <span>Current shell state publishes route, focused lane, selected run, and release mode.</span>
        <span>
          Fallback state: {initialLiveAppState.route} / {initialLiveAppState.focusQueue} / {initialLiveAppState.releaseMode}
        </span>
      </footer>
    </div>
  );
}
