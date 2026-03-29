import './App.css'

const pwd = '/home/fvrlak/ventures/softbox/apps/vite-default'

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
            <p className="chat-summary">Current working directory:</p>
          </div>
        </header>

        <div className="lorem-card" aria-label="Lorem ipsum block">
          <p>{pwd}</p>
        </div>
      </section>
    </main>
  )
}

export default App
