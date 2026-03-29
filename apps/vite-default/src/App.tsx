import { useEffect, useRef, useState, type FormEvent } from 'react'
import { firstReadFileMessage, initialLiveAppState, type ChatMessage } from './defaultState'
import './App.css'

const quickPrompts = [
  'Are you Claude or Codex or OpenClaw?',
  'Keep the update minimal.',
]

const timeFormatter = new Intl.DateTimeFormat([], {
  hour: '2-digit',
  minute: '2-digit',
})

const runStepDelayMs = 680

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function createTimestamp() {
  return timeFormatter.format(new Date())
}

function summarizeRequest(body: string) {
  const normalized = body.replace(/\s+/g, ' ').trim()
  return normalized.length > 72 ? `${normalized.slice(0, 69)}...` : normalized
}

function createRunFrames(request: string) {
  const target = summarizeRequest(request)

  return [
    `RUN TARGET\n${target}\n\n1. Read apps/vite-default/AGENTS.md and wrote its contents into the conversation.\n2. Inspecting src/App.tsx, src/App.css, src/defaultState.ts, and src/index.css...`,
    `RUN TARGET\n${target}\n\n1. Read apps/vite-default/AGENTS.md and wrote its contents into the conversation.\n2. Inspected src/App.tsx, src/App.css, src/defaultState.ts, and src/index.css.\n3. Applying the requested UI change...`,
    `RUN TARGET\n${target}\n\n1. Read apps/vite-default/AGENTS.md and wrote its contents into the conversation.\n2. Inspected src/App.tsx, src/App.css, src/defaultState.ts, and src/index.css.\n3. Applied the requested UI change.\n4. Running pnpm ui:screenshot from apps/vite-default...`,
    `RUN TARGET\n${target}\n\n1. Read apps/vite-default/AGENTS.md and wrote its contents into the conversation.\n2. Inspected src/App.tsx, src/App.css, src/defaultState.ts, and src/index.css.\n3. Applied the requested UI change.\n4. Ran pnpm ui:screenshot from apps/vite-default.\n5. Inspecting .softbox/screenshots/latest.png...`,
    `RUN TARGET\n${target}\n\n1. Read apps/vite-default/AGENTS.md and wrote its contents into the conversation.\n2. Inspected src/App.tsx, src/App.css, src/defaultState.ts, and src/index.css.\n3. Applied the requested UI change.\n4. Ran pnpm ui:screenshot from apps/vite-default.\n5. Inspected .softbox/screenshots/latest.png.\n6. Reported the completed change in the same thread.`,
  ]
}

function App() {
  const { messages: seedMessages, composerPlaceholder } = initialLiveAppState.ui
  const [messages, setMessages] = useState<ChatMessage[]>(() => [...seedMessages])
  const [draft, setDraft] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const runTimersRef = useRef<number[]>([])

  useEffect(() => {
    return () => {
      runTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    }
  }, [])

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const body = draft.trim()

    if (!body) {
      return
    }

    const nextUserMessage: ChatMessage = {
      id: createId('user'),
      role: 'user',
      body,
      time: createTimestamp(),
    }

    const runFrames = createRunFrames(body)
    const fileMessageId = createId('agent')
    const runMessageId = createId('agent')
    const nextFileMessage: ChatMessage = {
      id: fileMessageId,
      role: 'agent',
      body: firstReadFileMessage,
      time: createTimestamp(),
      variant: 'file',
    }
    const nextAgentMessage: ChatMessage = {
      id: runMessageId,
      role: 'agent',
      body: runFrames[0],
      time: createTimestamp(),
      variant: 'runlog',
    }

    runTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    runTimersRef.current = []

    setIsRunning(true)
    setMessages((current) => [...current, nextUserMessage, nextFileMessage, nextAgentMessage])
    setDraft('')

    runFrames.slice(1).forEach((frame, index) => {
      const isLastFrame = index === runFrames.length - 2
      const timer = window.setTimeout(() => {
        setMessages((current) =>
          current.map((message) =>
            message.id === runMessageId ? { ...message, body: frame } : message,
          ),
        )

        if (isLastFrame) {
          setIsRunning(false)
        }
      }, runStepDelayMs * (index + 1))

      runTimersRef.current.push(timer)
    })
  }

  return (
    <main className="chat-page">
      <section className="chat-shell" aria-labelledby="chat-title">
        <header className="chat-header">
          <div className="chat-heading">
            <p className="chat-kicker">SOFTBOX / AGENT CHAT</p>
            <h1 id="chat-title" className="chat-title">
              You and the agent
            </h1>
            <p className="chat-summary">
              Describe the change, point at the target, and keep constraints explicit. I print the
              first file I read, the run steps, verification, and outcome on screen.
            </p>
          </div>
        </header>

        <ul className="chat-prompts" aria-label="Quick prompts">
          {quickPrompts.map((prompt) => (
            <li key={prompt}>
              <button
                type="button"
                className="prompt-chip"
                onClick={() => setDraft(prompt)}
                disabled={isRunning}
              >
                {prompt}
              </button>
            </li>
          ))}
        </ul>

        <form className="composer" onSubmit={handleSubmit}>
          <label className="sr-only" htmlFor="chat-draft">
            Message the agent
          </label>
          <textarea
            id="chat-draft"
            className="composer-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={composerPlaceholder}
            disabled={isRunning}
          />

          <div className="composer-bar">
            <p className="composer-note">
              Direct request in. First file contents, run output, and verification on screen.
            </p>
            <button className="send-button" type="submit" disabled={!draft.trim() || isRunning}>
              {isRunning ? 'Running...' : 'Send'}
            </button>
          </div>
        </form>
      </section>
    </main>
  )
}

export default App
