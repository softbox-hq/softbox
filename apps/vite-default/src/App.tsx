import { useEffect, useMemo, useState } from 'react'
import './App.css'

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'full',
    timeStyle: 'medium',
  }).format(date)
}

function formatTimeZone(date: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZoneName: 'short',
  }).formatToParts(date)

  return parts.find((part) => part.type === 'timeZoneName')?.value ?? 'local time'
}

function App() {
  const [now, setNow] = useState(() => new Date())
  const timeZone = useMemo(() => formatTimeZone(now), [now])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date())
    }, 1000)

    return () => window.clearInterval(timer)
  }, [])

  return (
    <main className="chat-page">
      <section className="date-widget" aria-label="Current date and time">
        <div className="date-widget__topline">
          <p className="date-widget__label">Current date and time</p>
          <span className="date-widget__badge">Live</span>
        </div>

        <div className="date-widget__value" role="status" aria-live="polite">
          {formatDateTime(now)}
        </div>

        <p className="date-widget__meta">Timezone: {timeZone}</p>
      </section>
    </main>
  )
}

export default App
