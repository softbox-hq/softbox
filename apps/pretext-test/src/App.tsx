import { useEffect, useState } from 'react'
import { layoutWithLines, prepareWithSegments } from '@chenglou/pretext'
import './App.css'

const FONT = '400 18px "Helvetica Neue", Helvetica, Arial, sans-serif'
const LINE_HEIGHT = 28
const MAX_RENDERED_LINES = 220

const PLAY_TEXT = `Deux amants nés sous de funestes étoiles,
portent au cœur la douceur et la cendre;
leurs pas s’égarent dans les rues frileuses,
et pourtant l’aube semble encore les entendre.

La ville murmure, les familles s’opposent, et le sort hésite,
le nom des pères pèse comme un verrou;
mais dans la nuit, leurs voix se rejoignent,
plus fortes que la haine et plus fortes que tout.

Ils traversent le doute, la peur et le silence,
avec un amour fragile et farouche à la fois;
chaque mot qu’ils prononcent fend l’ombre autour d’eux,
chaque regard promet un monde à refaire.

Ô cœur obstiné, qu’aucun sort ne décourage,
avance encore quand le destin se ferme;
car même au bord de l’abîme et du drame,
il reste une lumière au milieu de l’hiver.`

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
