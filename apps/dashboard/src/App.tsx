import { type PointerEventHandler, useMemo, useRef, useState } from 'react'
import './App.css'

type Point = {
  x: number
  y: number
  color: string
  size: number
}

const palette = ['#1f1d2b', '#ff6b6b', '#ffd93d', '#6bcBef', '#7bed9f', '#a29bfe']

function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [color, setColor] = useState(palette[1])
  const [size, setSize] = useState(10)
  const [isPainting, setIsPainting] = useState(false)
  const [strokes, setStrokes] = useState<Point[]>([])

  const grid = useMemo(() => Array.from({ length: 20 }, (_, i) => i), [])

  const drawPoint = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top

    const nextPoint = { x, y, color, size }
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(x, y, size / 2, 0, Math.PI * 2)
    ctx.fill()

    setStrokes((current) => [...current, nextPoint])
  }

  const handlePointerDown: PointerEventHandler<HTMLCanvasElement> = (event) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    setIsPainting(true)
    drawPoint(event.clientX, event.clientY)
  }

  const handlePointerMove: PointerEventHandler<HTMLCanvasElement> = (event) => {
    if (!isPainting) return
    drawPoint(event.clientX, event.clientY)
  }

  const stopPainting = () => setIsPainting(false)

  const clearCanvas = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setStrokes([])
  }

  return (
    <main className="paint-app">
      <section className="cabinet">
        <div className="screen frame">
          <div className="screen-topbar">
            <span>RETRO PAINT</span>
            <span>{strokes.length} pixels</span>
          </div>

          <canvas
            ref={canvasRef}
            className="paint-canvas"
            width={960}
            height={540}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={stopPainting}
            onPointerLeave={stopPainting}
            aria-label="Retro painting canvas"
          />

          <div className="scanlines" aria-hidden="true" />
        </div>

        <aside className="toolbox frame">
          <h1>Paint Box</h1>
          <p className="subtitle">A tiny retro sketchpad with neon controls.</p>

          <label className="control">
            <span>Brush</span>
            <input
              type="range"
              min="2"
              max="28"
              value={size}
              onChange={(event) => setSize(Number(event.target.value))}
            />
          </label>

          <label className="control">
            <span>Color</span>
            <input
              type="color"
              value={color}
              onChange={(event) => setColor(event.target.value)}
              aria-label="Pick a color"
            />
          </label>

          <div className="swatches" role="list" aria-label="Color swatches">
            {palette.map((swatch) => (
              <button
                key={swatch}
                type="button"
                className={`swatch ${color === swatch ? 'active' : ''}`}
                style={{ backgroundColor: swatch }}
                onClick={() => setColor(swatch)}
                aria-label={`Use color ${swatch}`}
              />
            ))}
          </div>

          <div className="actions">
            <button type="button" className="retro-button" onClick={clearCanvas}>
              Clear
            </button>
          </div>

          <div className="info-grid">
            <div>
              <span className="label">Mode</span>
              <strong>Draw</strong>
            </div>
            <div>
              <span className="label">Brush</span>
              <strong>{size}px</strong>
            </div>
            <div>
              <span className="label">Color</span>
              <strong>{color.toUpperCase()}</strong>
            </div>
          </div>
        </aside>
      </section>

      <section className="footer-note frame">
        <span>Tip: drag on the screen to paint. It’s intentionally crunchy.</span>
        <div className="grid" aria-hidden="true">
          {grid.map((n) => (
            <i key={n} />
          ))}
        </div>
      </section>
    </main>
  )
}

export default App
