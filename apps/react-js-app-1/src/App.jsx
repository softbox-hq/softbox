import { NavLink, Route, Routes } from 'react-router-dom'
import './App.css'

function Layout({ children }) {
  return (
    <div className="app-shell">
      <nav className="navbar">
        <NavLink to="/" end>
          Home
        </NavLink>
        <NavLink to="/dashboard">Dashboard</NavLink>
        <NavLink to="/chat">Chat</NavLink>
      </nav>
      <main className="page-content">{children}</main>
    </div>
  )
}

function Home() {
  return <h1 className="hero-text">Home</h1>
}

function Dashboard() {
  return <h1 className="hero-text">Dashboard</h1>
}

function Chat() {
  return <h1 className="hero-text">Chat</h1>
}

function App() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <Layout>
            <Home />
          </Layout>
        }
      />
      <Route
        path="/dashboard"
        element={
          <Layout>
            <Dashboard />
          </Layout>
        }
      />
      <Route
        path="/chat"
        element={
          <Layout>
            <Chat />
          </Layout>
        }
      />
    </Routes>
  )
}

export default App
