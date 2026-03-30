import { useEffect, useState } from 'react'
import './App.css'

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'full',
    timeStyle: 'medium',
  }).format(date)
}

function App() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date())
    }, 1000)

    return () => window.clearInterval(timer)
  }, [])

  return (
    <main className="chat-page">
      <section className="date-widget" aria-label="Current date and time">
        <p className="date-widget__label">Current date and time</p>
        <div className="date-widget__value" role="status" aria-live="polite">
          {formatDateTime(now)}
        </div>
      </section>
    </main>
  )
}

export default App
