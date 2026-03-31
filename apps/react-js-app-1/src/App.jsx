import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Grid } from '@react-three/drei'
import {
  DndContext,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { useDraggable } from '@dnd-kit/core'
import { NavLink, Route, Routes } from 'react-router-dom'
import * as THREE from 'three'
import initSqlJs from 'sql.js'
import orbitData from '../data.json'
import './App.css'

function DraggableCard({ id, children, className = '', ariaLabel }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id })

  return (
    <section
      ref={setNodeRef}
      className={`draggable-card ${className}`.trim()}
      style={{ transform: CSS.Translate.toString(transform) }}
      aria-label={ariaLabel}
    >
      <button className="drag-handle" type="button" {...listeners} {...attributes}>
        ⠿
      </button>
      {children}
    </section>
  )
}

function Layout({ children, contentClassName = '' }) {
  return (
    <div className="app-shell">
      <nav className="navbar">
        <NavLink to="/" end>
          Home
        </NavLink>
        <NavLink to="/dashboard">Dashboard</NavLink>
        <NavLink to="/chat">Chat</NavLink>
        <NavLink to="/space">Space</NavLink>
      </nav>
      <main className={`page-content ${contentClassName}`.trim()}>{children}</main>
    </div>
  )
}

function Home() {
  const [packages, setPackages] = useState([])
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    let db = null

    const loadPackages = async () => {
      setStatus('loading')
      setError('')
      try {
        const response = await Promise.race([
          fetch('/apps/react-js-app-1/package.json', { cache: 'no-store' }),
          new Promise((_, reject) => window.setTimeout(() => reject(new Error('timeout')), 2500)),
        ])

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }

        const data = await response.json()
        const dependencies = Object.keys(data.dependencies ?? {})
          .filter((name) => name !== 'react' && name !== 'react-dom')
          .sort((a, b) => a.localeCompare(b))

        const SQL = await initSqlJs({
          locateFile: (file) => `/node_modules/sql.js/dist/${file}`,
        })
        db = new SQL.Database()
        db.exec(`
          CREATE TABLE IF NOT EXISTS packages (
            name TEXT PRIMARY KEY,
            installed_at TEXT DEFAULT CURRENT_TIMESTAMP
          );
          DELETE FROM packages;
        `)

        const insert = db.prepare('INSERT OR REPLACE INTO packages (name) VALUES (?)')
        for (const name of dependencies) {
          insert.run([name])
        }
        insert.free()

        const result = db.exec('SELECT name FROM packages ORDER BY name ASC')
        const rows = result[0]?.values?.map(([name]) => name) ?? []

        if (!cancelled) {
          setPackages(rows)
          setStatus('live')
        }
      } catch (err) {
        if (!cancelled) {
          setPackages([])
          setStatus('error')
          setError(err instanceof Error ? err.message : 'Failed to fetch package list')
        }
      }
    }

    loadPackages()
    const interval = window.setInterval(loadPackages, 15000)

    return () => {
      cancelled = true
      window.clearInterval(interval)
      db?.close()
    }
  }, [])

  return (
    <DraggableCard
      id="deps-card"
      className="info-widget"
      ariaLabel="Installed unnecessary packages"
    >
      <p className="clock-label">Installed non-native Vite modules</p>
      <h1 className="info-title">SQLite-backed live package list</h1>
      <p className="info-status">
        {status === 'live' && 'Live from package.json'}
        {status === 'loading' && 'Loading live package list...'}
        {status === 'error' && `Error: ${error}`}
      </p>
      <ul className="module-list">
        {packages.length ? (
          packages.map((name) => <li key={name}>{name}</li>)
        ) : (
          <li>{status === 'error' ? 'No live packages available' : 'Loading packages...'}</li>
        )}
      </ul>
    </DraggableCard>
  )
}

function DraggableDrawingWidget() {
  const canvasRef = useRef(null)
  const [drawing, setDrawing] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const context = canvas.getContext('2d')
    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect()
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.lineWidth = 4
      context.lineCap = 'round'
      context.lineJoin = 'round'
      context.strokeStyle = '#ffffff'
    }

    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    return () => observer.disconnect()
  }, [])

  const getPoint = (event) => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }
  }

  const startDrawing = (event) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    const point = getPoint(event)
    context.beginPath()
    context.moveTo(point.x, point.y)
    setDrawing(true)
  }

  const draw = (event) => {
    if (!drawing) return
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    const point = getPoint(event)
    context.lineTo(point.x, point.y)
    context.stroke()
  }

  const stopDrawing = () => setDrawing(false)

  return (
    <DraggableCard id="drawing-card" className="drawing-widget dashboard-piece" ariaLabel="Drawing canvas widget">
      <div className="drawing-header">
        <h1>Draw here</h1>
        <p>Drag this card to another grid cell.</p>
      </div>
      <canvas
        ref={canvasRef}
        className="drawing-canvas"
        onPointerDown={startDrawing}
        onPointerMove={draw}
        onPointerUp={stopDrawing}
        onPointerLeave={stopDrawing}
      />
    </DraggableCard>
  )
}

function GridCell({ id, children, active }) {
  const { setNodeRef, isOver } = useDroppable({ id })

  return (
    <div ref={setNodeRef} className={`grid-cell ${isOver ? 'is-over' : ''} ${active ? 'is-active' : ''}`.trim()}>
      {children}
    </div>
  )
}

function Dashboard() {
  return (
    <section className="dashboard-empty" aria-label="Dashboard empty" />
  )
}

function Chat() {
  return (
    <div className="answer-card">
      <p>Paris is most famous for</p>
      <h1>The Eiffel Tower, art, fashion, and food</h1>
      <p className="answer-subtext">Capital city of France · Continent: Europe</p>
    </div>
  )
}

function Space() {
  return (
    <section className="space-shell" aria-label="3D space">
      <div className="space-canvas-wrap">
        <Canvas camera={{ position: [0, 1.5, 5], fov: 60 }}>
          <color attach="background" args={['#050816']} />
          <ambientLight intensity={0.8} />
          <directionalLight position={[3, 5, 2]} intensity={2} />
          <pointLight position={[-3, 2, -2]} intensity={18} color="#ff88cc" />
          <Grid
            args={[20, 20]}
            cellSize={0.5}
            cellThickness={0.9}
            sectionSize={2}
            sectionThickness={1.4}
            fadeDistance={18}
            fadeStrength={1}
            followCamera={false}
            infiniteGrid
            position={[0, -1, 0]}
          />
          <mesh position={[0, 0, 0]}>
            <sphereGeometry args={[0.45, 32, 32]} />
            <meshStandardMaterial color="#ffcc33" emissive="#ff9900" emissiveIntensity={1.2} />
          </mesh>
          <EarthOrbit />
          {orbitData.map((body) => (
            <OrbitBody key={body.id} body={body} />
          ))}
          <FirstPersonControls />
        </Canvas>
      </div>
    </section>
  )
}

function EarthOrbit() {
  const orbitRef = useRef(null)

  useFrame((_, delta) => {
    if (!orbitRef.current) return
    orbitRef.current.rotation.y += delta * 0.35
  })

  return (
    <group ref={orbitRef}>
      <mesh position={[1.5, 0, 0]}>
        <sphereGeometry args={[0.18, 24, 24]} />
        <meshStandardMaterial color="#4aa3ff" />
      </mesh>
    </group>
  )
}

function FirstPersonControls() {
  const { camera } = useThree()
  const keysRef = useRef(new Set())

  useEffect(() => {
    const handleKeyDown = (event) => keysRef.current.add(event.key.toLowerCase())
    const handleKeyUp = (event) => keysRef.current.delete(event.key.toLowerCase())

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  useFrame((_, delta) => {
    const speed = 2.8 * delta
    const forward = new THREE.Vector3()
    const right = new THREE.Vector3()
    const up = new THREE.Vector3(0, 1, 0)

    camera.getWorldDirection(forward)
    forward.y = 0
    forward.normalize()
    right.crossVectors(forward, up).normalize()

    const keys = keysRef.current
    if (keys.has('w')) camera.position.addScaledVector(forward, speed)
    if (keys.has('s')) camera.position.addScaledVector(forward, -speed)
    if (keys.has('a')) camera.position.addScaledVector(right, -speed)
    if (keys.has('d')) camera.position.addScaledVector(right, speed)
    if (keys.has('q')) camera.position.y += speed
    if (keys.has('e')) camera.position.y -= speed

    camera.lookAt(0, 0, 0)
  })

  return null
}

function OrbitBody({ body }) {
  const meshRef = useRef(null)
  const materialColor =
    body.type === 'comet' ? '#d6f0ff' : body.type === 'trojan' ? '#f0c674' : body.type === 'tno' ? '#c08cff' : '#9ad1ff'
  const size = body.type === 'tno' ? 0.12 : body.type === 'comet' ? 0.08 : body.type === 'trojan' ? 0.09 : 0.07
  const orbitRadius = Math.max(1.6, Math.min(body.a / 20, 3.8))
  const orbitSpeed = 0.12 / Math.max(0.7, body.a / 3)
  const tilt = THREE.MathUtils.degToRad(body.i)
  const phase = THREE.MathUtils.degToRad(body.M0)

  useFrame((state, delta) => {
    if (!meshRef.current) return
    const t = state.clock.elapsedTime * orbitSpeed + phase
    const x = Math.cos(t) * orbitRadius
    const z = Math.sin(t) * orbitRadius
    const y = Math.sin(t * 2 + tilt) * 0.18 * Math.sin(tilt + 0.2)
    meshRef.current.position.set(x, y, z)
    meshRef.current.rotation.y += delta * 0.6
    meshRef.current.rotation.x += delta * 0.3
  })

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[size, 12, 12]} />
      <meshStandardMaterial color={materialColor} roughness={0.9} metalness={0.05} />
    </mesh>
  )
}

function ShellRoutes() {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  )

  return (
    <DndContext sensors={sensors}>
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
        <Route
          path="/space"
          element={
            <Layout contentClassName="page-content--space">
              <Space />
            </Layout>
          }
        />
      </Routes>
    </DndContext>
  )
}

function App() {
  return <ShellRoutes />
}

export default App
