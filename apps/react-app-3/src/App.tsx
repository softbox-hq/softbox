import { useEffect, useMemo, useState } from 'react'
import './App.css'

type ModuleStatus = {
  name: string
  state: 'checking' | 'ok' | 'missing'
  details: string
}

const moduleNames = ['react', 'react-dom', 'sql.js']

function inspectModule(name: string): ModuleStatus {
  const state = moduleNames.includes(name) ? 'ok' : 'missing'

  return {
    name,
    state,
    details: state === 'ok' ? 'installed' : 'not found',
  }
}

function App() {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTick((value) => value + 1)
    }, 15_000)

    return () => window.clearInterval(timer)
  }, [])

  const modules = useMemo(() => moduleNames.map((name) => inspectModule(name)), [tick])
  const lastCheckedAt = new Date().toLocaleTimeString()

  return (
    <main className="screen">
      <aside className="widget" aria-label="module poller">
        <div className="widget__head">
          <p className="widget__eyebrow">Node modules</p>
          <span className="widget__time">{lastCheckedAt}</span>
        </div>
        <ul className="widget__list">
          {modules.map((module) => (
            <li key={module.name} className={`widget__item widget__item--${module.state}`}>
              <span>{module.name}</span>
              <small>{module.details}</small>
            </li>
          ))}
        </ul>
      </aside>
    </main>
  )
}

export default App
