import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Grid, Text } from '@react-three/drei'
import { DndContext, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { useDraggable } from '@dnd-kit/core'
import { NavLink, Route, Routes } from 'react-router-dom'
import * as THREE from 'three'
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
  return (
    <DraggableCard
      id="deps-card"
      className="info-widget"
      ariaLabel="Installed unnecessary packages"
    >
      <p className="clock-label">Installed non-native Vite modules</p>
      <h1 className="info-title">Not needed to run this app</h1>
      <ul className="module-list">
        <li>deck.gl</li>
        <li>draggabilly</li>
        <li>packery</li>
      </ul>
    </DraggableCard>
  )
}

function DrawingCanvas() {
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
    <DraggableCard id="drawing-card" className="drawing-widget" ariaLabel="Drawing canvas widget">
      <div className="drawing-header">
        <h1>Draw here</h1>
        <p>Click or drag to sketch on the canvas.</p>
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

function Dashboard() {
  return <DrawingCanvas />
}

function Chat() {
  return <h1 className="hero-text">Chat</h1>
}

function SpinningBox() {
  const meshRef = useRef(null)

  useFrame((_, delta) => {
    if (!meshRef.current) return
    meshRef.current.rotation.x += delta * 0.5
    meshRef.current.rotation.y += delta * 0.35
  })

  return (
    <mesh ref={meshRef} position={[0, 0.45, 0]}>
      <boxGeometry args={[0.9, 0.9, 0.9]} />
      <meshStandardMaterial color="#66ccff" roughness={0.3} metalness={0.2} />
    </mesh>
  )
}

function Space() {
  return (
    <section className="space-shell" aria-label="3D space">
      <div className="space-canvas-wrap">
        <Canvas camera={{ position: [2.6, 2.2, 4.2], fov: 50 }}>
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
          <SpinningBox />
          <Text position={[0, 1.7, 0]} fontSize={0.45} color="#ffffff" anchorX="center" anchorY="middle">
            XYZ space
          </Text>
          <OrbitControls enablePan enableZoom enableRotate />
        </Canvas>
      </div>
    </section>
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
