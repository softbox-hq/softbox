import { useEffect, useState } from 'react'
import { layoutWithLines, prepareWithSegments } from '@chenglou/pretext'
import romeoAndJulietRaw from '../romeoandjuliet.txt?raw'
import './App.css'

const FONT = '400 18px "Helvetica Neue", Helvetica, Arial, sans-serif'
const LINE_HEIGHT = 28
const MIN_WIDTH = 220
const MAX_WIDTH = 640
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

const PLAY_TEXT = extractPlayText(romeoAndJulietRaw)

function App() {
  const [maxWidth, setMaxWidth] = useState(360)
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
  const result = layoutWithLines(prepared, maxWidth, LINE_HEIGHT)
  const visibleLines = result.lines.slice(0, MAX_RENDERED_LINES)

  return (
    <main className="demo-shell">
      <section className="demo-grid">
        <div className="panel controls">
          <h2>Controls</h2>
          <label className="slider-label" htmlFor="width">
            Max width: <strong>{maxWidth}px</strong>
          </label>
          <input
            id="width"
            type="range"
            min={MIN_WIDTH}
            max={MAX_WIDTH}
            value={maxWidth}
            onChange={(event) => setMaxWidth(Number(event.target.value))}
          />

          <dl className="stats">
            <div>
              <dt>Lines</dt>
              <dd>{result.lineCount}</dd>
            </div>
            <div>
              <dt>Chars</dt>
              <dd>{PLAY_TEXT.length}</dd>
            </div>
            <div>
              <dt>Height</dt>
              <dd>{Math.round(result.height)}px</dd>
            </div>
            <div>
              <dt>Line height</dt>
              <dd>{LINE_HEIGHT}px</dd>
            </div>
          </dl>

          <pre className="snippet">
{`import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext'

const prepared = prepareWithSegments(text, '${FONT}')
const result = layoutWithLines(prepared, ${maxWidth}, ${LINE_HEIGHT})`}
          </pre>
        </div>

        <div className="panel preview">
          <div className="preview-meta">
            <h2>Layout result</h2>
            <span>{fontsReady ? 'Fonts ready' : 'Waiting for fonts'}</span>
          </div>

          <div className="paragraph-frame" style={{ width: `${maxWidth}px` }}>
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
                  Showing first {MAX_RENDERED_LINES} lines of {result.lineCount}.
                </span>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  )
}

export default App
