import { useEffect, useState } from 'react'
import './App.css'

type ModuleStatus = {
  name: string
  state: 'checking' | 'ok' | 'missing'
  details: string
}

const MODULES = ['react', 'react-dom', 'sql.js']

async function probeModule(name: string): Promise<ModuleStatus> {
  try {
    await import(/* @vite-ignore */ name)

    return {
      name,
      state: 'ok',
      details: 'loaded',
    }
  } catch {
    return {
      name,
      state: 'missing',
      details: 'not reachable',
    }
  }
}

function App() {
  const [modules, setModules] = useState<ModuleStatus[]>(
    MODULES.map((name) => ({ name, state: 'checking' as const, details: 'waiting' })),
  )
  const [lastCheckedAt, setLastCheckedAt] = useState<string>('—')

  useEffect(() => {
    let alive = true

    const refresh = async () => {
      const results = await Promise.all(MODULES.map((name) => probeModule(name)))
      if (!alive) return

      setModules(results)
      setLastCheckedAt(new Date().toLocaleTimeString())
    }

    refresh()
    const timer = window.setInterval(refresh, 15_000)

    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])

  return (
    <main className="screen">
      <aside className="widget" aria-label="module poller">
        <div className="widget__head">
          <p className="widget__eyebrow">Module poller</p>
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
