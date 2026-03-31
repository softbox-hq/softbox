import { useEffect, useRef } from 'react'
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
