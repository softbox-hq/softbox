import { useEffect, useState } from 'react'

import './App.css'

const telegramAnswer = `Not by default. I don't have direct access to your Telegram account or chats unless you've explicitly connected Telegram to this OpenClaw setup.

From inside this app, I also can't independently verify your Telegram connection state.`

const telegramReality = [
  'No — not magically. I cannot inspect your whole Telegram account, read all your private messages, or browse your history unless Telegram itself exposes that data through a connection you explicitly set up.',
  'With a normal Telegram bot integration, the scope is much narrower: I can only see messages sent to that bot or in chats where the bot is present and allowed to read them.',
  'I do not get automatic access to your DMs, archived chats, contacts, secret chats, or account-wide history just because you asked.',
  'So: your messages are not something I can just pull out of your account on my own. That is a platform permission boundary, not me being difficult.',
  'If you want, I can help you set up the maximum legitimate access Telegram allows through a bot, or show you how to export your own data and let me analyze it locally.',
]

function formatNow(date: Date) {
  return {
    date: new Intl.DateTimeFormat(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(date),
    time: new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(date),
  }
}

function App() {
  const [now, setNow] = useState(() => formatNow(new Date()))

  useEffect(() => {
    const tick = () => setNow(formatNow(new Date()))
    const interval = window.setInterval(tick, 1000)

    return () => window.clearInterval(interval)
  }, [])

  return (
    <main className="chat-page">
      <section className="chat-shell" aria-labelledby="chat-title">
        <div className="clock-widget" aria-label="Current date and time widget">
          <p className="clock-widget__label">Current time</p>
          <p className="clock-widget__time">{now.time}</p>
          <p className="clock-widget__date">{now.date}</p>
        </div>

        <header className="chat-header">
          <div className="chat-heading">
            <p className="chat-kicker">SOFTBOX / AGENT CHAT</p>
            <h1 id="chat-title" className="chat-title">
              You and the agent
            </h1>
            <p className="chat-summary">Answer here:</p>
          </div>
        </header>

        <div className="lorem-card" aria-label="Lorem ipsum block">
          <p>{telegramAnswer}</p>
        </div>

        <div className="info-card" aria-label="Telegram setup guide">
          <h2>Can I inspect your whole Telegram account?</h2>
          <ol>
            {telegramReality.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      </section>
    </main>
  )
}

export default App
