import './App.css'

const telegramAnswer = `Not by default. I don't have direct access to your Telegram account or chats unless you've explicitly connected Telegram to this OpenClaw setup.

From inside this app, I also can't independently verify your Telegram connection state. If you want, I can help you check the OpenClaw/Telegram setup next.`

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
            <p className="chat-summary">Answer here:</p>
          </div>
        </header>

        <div className="lorem-card" aria-label="Lorem ipsum block">
          <p>{telegramAnswer}</p>
        </div>
      </section>
    </main>
  )
}

export default App
