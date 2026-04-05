import { useMemo, useState } from 'react'
import { ReactReader } from 'react-reader'
import './App.css'

const mobyDickUrl = `${import.meta.env.BASE_URL}assets/mobydick.epub`

function App() {
  const [bookUrl, setBookUrl] = useState(mobyDickUrl)
  const [location, setLocation] = useState<string | number>(0)

  const bookLabel = useMemo(() => {
    if (bookUrl === mobyDickUrl) return 'Moby-Dick (bundled EPUB)'
    try {
      const url = new URL(bookUrl, window.location.origin)
      return url.pathname.split('/').pop() || bookUrl
    } catch {
      return bookUrl
    }
  }, [bookUrl])

  return (
    <main className="reader-shell">
      <header className="reader-header">
        <div>
          <p className="eyebrow">React Reader</p>
          <h1>Read Moby-Dick in the browser</h1>
          <p className="lede">
            The bundled EPUB loads automatically. You can still paste a
            different public EPUB URL if you want.
          </p>
        </div>

        <form
          className="book-form"
          onSubmit={(event) => {
            event.preventDefault()
            const nextUrl = new FormData(event.currentTarget).get('bookUrl')
            if (typeof nextUrl === 'string' && nextUrl.trim()) {
              setBookUrl(nextUrl.trim())
              setLocation(0)
            }
          }}
        >
          <label htmlFor="bookUrl">EPUB URL</label>
          <div className="book-form-row">
            <input
              id="bookUrl"
              name="bookUrl"
              type="url"
              defaultValue={mobyDickUrl}
              placeholder="https://example.com/book.epub"
            />
            <button type="submit">Load book</button>
          </div>
        </form>
      </header>

      <section className="reader-frame" aria-label="EPUB reader">
        <div className="reader-meta">
          <span>{bookLabel}</span>
          <span>Location: {String(location)}</span>
        </div>

        <div className="reader-canvas">
          <ReactReader
            key={bookUrl}
            url={bookUrl}
            location={location}
            locationChanged={setLocation}
            title={bookLabel}
          />
        </div>
      </section>
    </main>
  )
}

export default App
