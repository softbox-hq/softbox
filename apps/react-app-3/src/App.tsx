import { useRef } from 'react'
import './App.css'

type Point = { x: number; y: number }

function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const lastPoint = useRef<Point | null>(null)

  const getPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return null

    const rect = canvas.getBoundingClientRect()
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }
  }

  const drawLine = (from: Point, to: Point) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const context = canvas.getContext('2d')
    if (!context) return

    context.lineWidth = 4
    context.lineCap = 'round'
    context.strokeStyle = '#ffffff'
    context.beginPath()
    context.moveTo(from.x, from.y)
    context.lineTo(to.x, to.y)
    context.stroke()
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = getPoint(event)
    if (!point) return

    drawing.current = true
    lastPoint.current = point
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    const point = getPoint(event)
    if (!point || !lastPoint.current) return

    drawLine(lastPoint.current, point)
    lastPoint.current = point
  }

  const stopDrawing = (event: React.PointerEvent<HTMLCanvasElement>) => {
    drawing.current = false
    lastPoint.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const clearCanvas = () => {
    const canvas = canvasRef.current
    if (!canvas) return

    const context = canvas.getContext('2d')
    if (!context) return

    context.clearRect(0, 0, canvas.width, canvas.height)
  }

  return (
    <main className="screen">
      <section className="panel">
        <div className="canvas-card">
          <div className="canvas-card__head">
            <div>
              <p className="eyebrow">Canvas</p>
              <h1>Draw here</h1>
              <p className="subtitle">Click and drag to sketch on the black surface.</p>
            </div>
            <button className="clear-button" type="button" onClick={clearCanvas}>
              Clear
            </button>
          </div>

          <div className="canvas-wrap">
            <canvas
              ref={canvasRef}
              className="drawing-canvas"
              width={1200}
              height={700}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={stopDrawing}
              onPointerLeave={stopDrawing}
            />
          </div>
        </div>
      </section>
    </main>
  )
}

export default App
