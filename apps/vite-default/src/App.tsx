import './App.css'

function App() {
  return (
    <main className="chat-page">
      <section className="chat-shell" aria-labelledby="chat-title">
        <header className="chat-header">
          <div className="chat-heading">
            <p className="chat-kicker">SOFTBOX / AGENT CHAT</p>
            <h1 id="chat-title" className="chat-title">
              You and the agent
            </h1>
            <p className="chat-summary">
              Describe the change, point at the target, and keep constraints explicit.
            </p>
          </div>
        </header>
      </section>
    </main>
  )
}

export default App
