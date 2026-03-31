import { useEffect, useMemo, useRef, useState } from 'react'
import Packery from 'packery'
import Draggabilly from 'draggabilly'
import './App.css'

const cards = [
  { title: 'One', body: 'Drag me around.' },
  { title: 'Two', body: 'Packery keeps the layout tight.' },
  { title: 'Three', body: 'Drop cards anywhere.' },
  { title: 'Four', body: 'Simple, tactile, and direct.' },
  { title: 'Five', body: 'That is the whole point.' },
  { title: 'Six', body: 'Yep, this one too.' },
]

function App() {
  const gridRef = useRef(null)
  const packeryRef = useRef(null)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const timeParts = useMemo(() => {
    const time = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(now)

    const date = new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(now)

    return { time, date }
  }, [now])

  useEffect(() => {
    if (!gridRef.current) return

    const gridElement = gridRef.current
    const pckry = new Packery(gridElement, {
      itemSelector: '.grid-item',
      gutter: 16,
      percentPosition: true,
      initLayout: false,
    })

    packeryRef.current = pckry

    const draggies = pckry.getItemElements().map((itemElem) => {
      const draggie = new Draggabilly(itemElem, {
        handle: '.drag-handle',
      })

      pckry.bindDraggabillyEvents(draggie)
      return draggie
    })

    pckry.layout()

    return () => {
      draggies.forEach((draggie) => draggie.destroy())
      pckry.destroy()
      packeryRef.current = null
    }
  }, [])

  return (
    <main className="app-shell">
      <section className="app-card">
        <div className="app-header">
          <h1>Packery board</h1>
          <p>Drag the cards around on the main screen.</p>
        </div>

        <div className="grid" ref={gridRef}>
          <article className="grid-item clock-card">
            <div className="drag-handle" aria-label="Drag current time widget">
              ≡
            </div>
            <h2>Current time</h2>
            <p className="clock-time">{timeParts.time}</p>
            <p className="clock-date">{timeParts.date}</p>
          </article>
          {cards.map((card) => (
            <article className="grid-item" key={card.title}>
              <div className="drag-handle" aria-label={`Drag ${card.title}`}>
                ≡
              </div>
              <h2>{card.title}</h2>
              <p>{card.body}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}

export default App
