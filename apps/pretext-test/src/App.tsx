import { useEffect, useState } from 'react'
import { layoutWithLines, prepareWithSegments } from '@chenglou/pretext'
import romeoAndJulietRaw from '../romeoandjuliet.txt?raw'
import './App.css'

const FONT = '400 18px "Helvetica Neue", Helvetica, Arial, sans-serif'
const LINE_HEIGHT = 28
const MAX_RENDERED_LINES = 220

function extractPlayText(text: string): string {
  const startMarker = '*** START OF THE PROJECT GUTENBERG EBOOK ROMEO AND JULIET ***'
  const endMarker = '*** END OF THE PROJECT GUTENBERG EBOOK ROMEO AND JULIET ***'
  const playTitleMarker = 'THE TRAGEDY OF ROMEO AND JULIET'

  const startIndex = text.indexOf(startMarker)
  const endIndex = text.indexOf(endMarker)
  const coreText =
    startIndex === -1
      ? text
      : text.slice(startIndex + startMarker.length, endIndex === -1 ? undefined : endIndex)

  const playStartIndex = coreText.indexOf(playTitleMarker)
  const trimmed = playStartIndex === -1 ? coreText : coreText.slice(playStartIndex)
  return trimmed.replace(/\s+\n/g, '\n').trim()
}

const PLAY_TEXT = extractPlayText(romeoAndJulietRaw).replace(
  'to Juliet’s Chamber, overlooking the Garden.',
  'à la chambre de Juliette, donnant sur le jardin.',
)

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
