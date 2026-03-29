import { useState, type FormEvent } from 'react'
import { initialLiveAppState, type ChatMessage } from './defaultState'
import './App.css'

const quickPrompts = [
  'Change this copy.',
  'Make the layout tighter.',
  'Keep the update minimal.',
]

const timeFormatter = new Intl.DateTimeFormat([], {
  hour: '2-digit',
  minute: '2-digit',
})

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function createTimestamp() {
  return timeFormatter.format(new Date())
}

function createAgentReply(): ChatMessage {
  return {
    id: createId('agent'),
    role: 'agent',
    body: 'Received. I will inspect the target, make the change, verify it, and report back here.',
    time: createTimestamp(),
  }
}

function App() {
  const { messages: seedMessages, composerPlaceholder } = initialLiveAppState.ui
  const [messages, setMessages] = useState<ChatMessage[]>(() => [...seedMessages])
  const [draft, setDraft] = useState('')

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

    setMessages((current) => [...current, nextUserMessage, createAgentReply()])
    setDraft('')
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
              Describe the change, point at the target, and keep constraints explicit. I reply with
              edits, verification, and outcome.
            </p>
          </div>
        </header>

        <div className="chat-thread" role="log" aria-live="polite" aria-label="Conversation">
          {messages.map((message) => (
            <article
              key={message.id}
              className={`message message--${message.role}`}
              aria-label={`${message.role} message`}
            >
              <p className="message-meta">
                <span>{message.role === 'user' ? 'You' : 'Agent'}</span>
                <span>{message.time}</span>
              </p>
              <div className="message-bubble">
                <p>{message.body}</p>
              </div>
            </article>
          ))}
        </div>

        <ul className="chat-prompts" aria-label="Quick prompts">
          {quickPrompts.map((prompt) => (
            <li key={prompt}>
              <button type="button" className="prompt-chip" onClick={() => setDraft(prompt)}>
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
          />

          <div className="composer-bar">
            <p className="composer-note">Direct request in. Concrete edit and verification out.</p>
            <button className="send-button" type="submit" disabled={!draft.trim()}>
              Send
            </button>
          </div>
        </form>
      </section>
    </main>
  )
}

export default App
