import { useEffect, useState } from 'react'
import { layoutWithLines, prepareWithSegments } from '@chenglou/pretext'
import './App.css'

const FONT = '400 18px "Helvetica Neue", Helvetica, Arial, sans-serif'
const LINE_HEIGHT = 28
const MAX_RENDERED_LINES = 220

const PLAY_TEXT = `Deux amants nés sous de funestes étoiles,
Dont les malheurs scelleront le destin,
Traversent la nuit, la peur et les détours,
Et cherchent encore un peu de matin.

Leur amour est tendre, leur monde est cruel,
Les familles grondent, le sort se fait lourd;
Mais sous le silence et les ombres du ciel,
Leur cœur persiste et défie le jour.`

function App() {
  const [fontsReady, setFontsReady] = useState(
    typeof document === 'undefined' || !('fonts' in document),
  )

  useEffect(() => {
    if (!('fonts' in document)) return

    let cancelled = false
    document.fonts.ready.then(() => {
      if (!cancelled) setFontsReady(true)
    })

    return () => {
      cancelled = true
    }
  }, [])

  const prepared = prepareWithSegments(PLAY_TEXT, FONT)
  const result = layoutWithLines(prepared, 360, LINE_HEIGHT)
  const visibleLines = result.lines.slice(0, MAX_RENDERED_LINES)

  return (
    <main className="demo-shell">
      <section className="demo-grid">
        <div className="panel preview">
          {visibleLines.map((line, index) => (
            <div className="line-row" key={`${index}-${line.text}`}>
              <span className="line-number">{index + 1}</span>
              <span className="line-text">{line.text}</span>
            </div>
          ))}
          {result.lineCount > MAX_RENDERED_LINES && (
            <div className="line-row">
              <span className="line-number">...</span>
              <span className="line-text">
                Affichage des {MAX_RENDERED_LINES} premières lignes sur {result.lineCount}.
              </span>
            </div>
          )}
        </div>
      </section>
    </main>
  )
}

export default App
