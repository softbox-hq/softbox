import './App.css'

const telegramAnswer = `Not by default. I don't have direct access to your Telegram account or chats unless you've explicitly connected Telegram to this OpenClaw setup.

From inside this app, I also can't independently verify your Telegram connection state.`

const telegramSteps = [
  'If you want Telegram access, connect Telegram to this OpenClaw setup first.',
  'The usual flow is: create a bot with BotFather, add the bot token to your OpenClaw config or env, then enable the Telegram integration.',
  'After that, send a message to the bot from your Telegram account so OpenClaw has an active chat to reply into.',
  'Once it is connected, I can respond through Telegram inside the connected scope, not magically inspect your whole account.',
  'If you want, next I can help you check the exact config files or commands for your current setup.',
]

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

        <div className="info-card" aria-label="Telegram setup guide">
          <h2>How to give me Telegram access</h2>
          <ol>
            {telegramSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      </section>
    </main>
  )
}

export default App
