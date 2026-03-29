import type { CSSProperties } from 'react'
import './App.css'
import { useSoftboxRuntime } from './adapter/runtime'
import { defaultGridConfig } from './defaultState'

function App() {
  const { initialState } = useSoftboxRuntime()
  const grid = initialState.ui.grid ?? defaultGridConfig
  const { columns, rows, cellSize } = grid
  const cellCount = columns * rows
  const cells = Array.from({ length: cellCount }, (_, index) => index)
  const gridStyle = {
    '--grid-columns': columns,
    '--grid-rows': rows,
    '--cell-size': `${cellSize}px`,
  } as CSSProperties

  return (
    <main className="app-shell">
      <header className="app-header">
        <p className="eyebrow">React Grid Study</p>
        <h1>10,000 React cells on a 10px lattice</h1>
        <p className="intro">
          The original <code>a.html</code> sketch is now rendered as React
          elements: a {columns} by {rows} matrix where every cell stays exactly{' '}
          {cellSize}px square.
        </p>
      </header>

      <section className="grid-panel" aria-labelledby="grid-summary">
        <div className="grid-summary" id="grid-summary">
          <span>{columns} columns</span>
          <span>{rows} rows</span>
          <span>{cellSize}px cells</span>
          <span>{cellCount.toLocaleString()} elements</span>
        </div>

        <div className="grid-frame">
          <div className="grid-canvas" style={gridStyle} aria-hidden="true">
            {cells.map((cell) => (
              <div className="grid-cell" key={cell} />
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}

export default App
