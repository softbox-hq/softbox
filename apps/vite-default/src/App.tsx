import { useMemo, useState } from 'react'
import './App.css'

function App() {
  const [seed] = useState(() => Math.floor(Math.random() * 100000))

  const photoUrl = useMemo(() => {
    return `https://picsum.photos/seed/${seed}/800/800`
  }, [seed])

  return (
    <main className="chat-page">
      <section className="photo-widget" aria-label="Random photo">
        <div className="photo-widget__header">
          <p className="photo-widget__label">Random photo</p>
          <span className="photo-widget__badge">Fresh</span>
        </div>

        <div className="photo-widget__frame">
          <img
            className="photo-widget__image"
            src={photoUrl}
            alt="Randomly selected photo"
            loading="lazy"
          />
        </div>
      </section>
    </main>
  )
}

export default App
