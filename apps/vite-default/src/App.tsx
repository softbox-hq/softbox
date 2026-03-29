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

        <div className="lorem-card" aria-label="Lorem ipsum block">
          <p>
            Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer posuere erat a ante
            venenatis dapibus posuere velit aliquet. Cras mattis consectetur purus sit amet
            fermentum. Maecenas faucibus mollis interdum. Donec ullamcorper nulla non metus auctor
            fringilla.
          </p>
        </div>
      </section>
    </main>
  )
}

export default App
