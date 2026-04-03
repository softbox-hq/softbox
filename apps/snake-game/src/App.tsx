import './App.css'

const tips = [
  'Arrow keys move the snake',
  'Eat food to grow longer',
  'Don\'t crash into the walls',
]

function App() {
  return (
    <main className="app-shell">
      <section className="hero-card">
        <p className="eyebrow">Snake Game</p>
        <h1>Clean starter template</h1>
        <p className="lead">
          A simple Vite + React landing screen that is ready for actual gameplay.
        </p>

        <div className="tips" aria-label="Game tips">
          {tips.map((tip) => (
            <span key={tip} className="tip">
              {tip}
            </span>
          ))}
        </div>
      </section>

      <section className="panel-grid" aria-label="Next steps">
        <article>
          <h2>What to build next</h2>
          <p>Replace this placeholder with the board, snake, food, and score.</p>
        </article>
        <article>
          <h2>Keep it small</h2>
          <p>
            Put game state in React components or a tiny store, and keep the UI easy
            to reason about.
          </p>
        </article>
      </section>
    </main>
  )
}

export default App
