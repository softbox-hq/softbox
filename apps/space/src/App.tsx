import { OrbitControls, Grid, Stars as DreiStars } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type { Group, Mesh } from 'three'
import './App.css'

function Sun() {
  const ref = useRef<Mesh>(null)

  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.25
  })

  return (
    <mesh ref={ref}>
      <sphereGeometry args={[1.1, 48, 48]} />
      <meshStandardMaterial emissive="#ffb347" emissiveIntensity={2.2} color="#ff7a18" />
    </mesh>
  )
}

function Planet({
  radius,
  size,
  speed,
  color,
  inclination = 0,
}: {
  radius: number
  size: number
  speed: number
  color: string
  inclination?: number
}) {
  const ref = useRef<Group>(null)

  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * speed
  })

  return (
    <group ref={ref} rotation={[inclination, 0, 0]}>
      <mesh position={[radius, 0, 0]}>
        <sphereGeometry args={[size, 32, 32]} />
        <meshStandardMaterial color={color} roughness={0.9} metalness={0.05} />
      </mesh>
    </group>
  )
}

function Stars() {
  return <DreiStars radius={35} depth={50} count={3000} factor={4} fade speed={1} />
}

function App() {
  return (
    <main id="center" className="space-scene">
      <header className="scene-copy">
        <h1>Solar system</h1>
        <p>3D visualization powered by React Three Fiber.</p>
      </header>

      <div className="scene-frame" aria-label="3D solar system visualization">
        <Canvas camera={{ position: [0, 1.5, 4.5], fov: 50 }}>
          <color attach="background" args={["#050814"]} />
          <fog attach="fog" args={["#050814", 12, 40]} />
          <ambientLight intensity={0.25} />
          <pointLight position={[0, 0, 0]} intensity={120} color="#ffcc88" />
          <directionalLight position={[5, 4, 5]} intensity={0.8} color="#dbeafe" />
          <Grid
            infiniteGrid
            sectionSize={2}
            sectionColor="#38506f"
            cellSize={1}
            cellColor="#223047"
            position={[0, -1.75, 0]}
            fadeDistance={45}
            fadeStrength={1}
          />
          <OrbitControls makeDefault enableDamping dampingFactor={0.08} />
          <Stars />
          <Sun />
          <Planet radius={2.4} size={0.18} speed={1.6} color="#9ca3af" />
          <Planet radius={3.5} size={0.26} speed={1.1} color="#d97706" inclination={0.2} />
          <Planet radius={4.8} size={0.28} speed={0.8} color="#3b82f6" inclination={-0.15} />
          <Planet radius={6.1} size={0.22} speed={0.6} color="#ef4444" inclination={0.12} />
        </Canvas>
      </div>
    </main>
  )
}

export default App
