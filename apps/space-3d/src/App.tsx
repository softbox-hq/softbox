import { Canvas, type ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { Html, Stars } from '@react-three/drei'
import { useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import './App.css'

type PlanetConfig = {
  name: string
  color: string
  size: number
  orbitRadius: number
  orbitSpeed: number
  rotationSpeed: number
  tilt?: number
  emissive?: string
  ring?: {
    color: string
    innerRadius: number
    outerRadius: number
    tilt?: number
  }
}

const planets: PlanetConfig[] = [
  {
    name: 'Mercury',
    color: '#b7a48b',
    size: 0.38,
    orbitRadius: 6,
    orbitSpeed: 1.6,
    rotationSpeed: 1.2,
  },
  {
    name: 'Venus',
    color: '#d6b57d',
    size: 0.62,
    orbitRadius: 8.5,
    orbitSpeed: 1.2,
    rotationSpeed: 0.45,
  },
  {
    name: 'Earth',
    color: '#4f8fd9',
    size: 0.68,
    orbitRadius: 11.5,
    orbitSpeed: 1,
    rotationSpeed: 2.4,
  },
  {
    name: 'Mars',
    color: '#b55b3c',
    size: 0.53,
    orbitRadius: 14.5,
    orbitSpeed: 0.8,
    rotationSpeed: 2,
  },
  {
    name: 'Jupiter',
    color: '#c9a27f',
    size: 1.7,
    orbitRadius: 20,
    orbitSpeed: 0.43,
    rotationSpeed: 3.2,
  },
  {
    name: 'Saturn',
    color: '#d7c08f',
    size: 1.45,
    orbitRadius: 26.5,
    orbitSpeed: 0.3,
    rotationSpeed: 2.9,
    ring: {
      color: '#c8b27f',
      innerRadius: 2,
      outerRadius: 3,
      tilt: 0.52,
    },
  },
  {
    name: 'Uranus',
    color: '#8fd7d7',
    size: 1.05,
    orbitRadius: 32,
    orbitSpeed: 0.22,
    rotationSpeed: 1.8,
    tilt: 1.2,
  },
  {
    name: 'Neptune',
    color: '#4878d6',
    size: 1,
    orbitRadius: 37,
    orbitSpeed: 0.18,
    rotationSpeed: 1.7,
  },
]

function App() {
  const [selectedPlanet, setSelectedPlanet] = useState<string>('Jupiter')

  return (
    <main className="app-shell">
      <div className="scene-wrap">
        <Canvas camera={{ position: [0, 8, 24], fov: 60 }}>
          <color attach="background" args={['#02030a']} />
          <fog attach="fog" args={['#02030a', 40, 110]} />
          <ambientLight intensity={0.5} />
          <pointLight position={[0, 0, 0]} intensity={250} distance={300} decay={2} />
          <directionalLight position={[20, 14, 20]} intensity={1.4} />
          <Stars radius={180} depth={100} count={9000} factor={5} saturation={0} fade speed={0.5} />
          <SolarSystem selectedPlanet={selectedPlanet} onPlanetSelect={setSelectedPlanet} />
          <FollowPlanetCamera planetName="Jupiter" />
        </Canvas>

        <div className="hud hud-top-left">
          <p className="eyebrow">Space 3D</p>
          <h1>Jupiter locked camera</h1>
          <p className="body-copy">
            The camera now tracks Jupiter continuously while the rest of the solar system moves around it.
          </p>
        </div>

        <div className="hud hud-top-right">
          <p className="eyebrow">Camera mode</p>
          <ul>
            <li><span>Jupiter</span><strong>locked target</strong></li>
            <li><span>Auto</span><strong>smooth follow</strong></li>
          </ul>
        </div>

        <div className="hud hud-bottom-left">
          <p className="eyebrow">Selected planet</p>
          <div className="selected-planet">{selectedPlanet}</div>
        </div>
      </div>
    </main>
  )
}

function SolarSystem({
  selectedPlanet,
  onPlanetSelect,
}: {
  selectedPlanet: string
  onPlanetSelect: (name: string) => void
}) {
  return (
    <group>
      <Sun />
      <gridHelper args={[120, 40, '#233047', '#111827']} position={[0, -4, 0]} />
      {planets.map((planet, index) => (
        <Planet
          key={planet.name}
          config={planet}
          index={index}
          selected={selectedPlanet === planet.name}
          onSelect={onPlanetSelect}
        />
      ))}
    </group>
  )
}

function Sun() {
  const ref = useRef<THREE.Mesh>(null)

  useFrame((_, delta) => {
    if (!ref.current) return
    ref.current.rotation.y += delta * 0.15
  })

  return (
    <group>
      <mesh ref={ref}>
        <sphereGeometry args={[2.8, 64, 64]} />
        <meshStandardMaterial color="#ffb347" emissive="#ff8c1a" emissiveIntensity={1.8} />
      </mesh>
      <mesh>
        <sphereGeometry args={[3.5, 48, 48]} />
        <meshBasicMaterial color="#ff9f43" transparent opacity={0.08} />
      </mesh>
    </group>
  )
}

function Planet({
  config,
  index,
  selected,
  onSelect,
}: {
  config: PlanetConfig
  index: number
  selected: boolean
  onSelect: (name: string) => void
}) {
  const orbitRef = useRef<THREE.Group>(null)
  const planetRef = useRef<THREE.Mesh>(null)
  const angleOffset = useMemo(() => index * 0.75, [index])

  useFrame(({ clock }, delta) => {
    const elapsed = clock.getElapsedTime()

    if (orbitRef.current) {
      orbitRef.current.rotation.y = elapsed * config.orbitSpeed * 0.18 + angleOffset
    }

    if (planetRef.current) {
      planetRef.current.rotation.y += delta * config.rotationSpeed
    }
  })

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    onSelect(config.name)
  }

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[config.orbitRadius - 0.04, config.orbitRadius + 0.04, 128]} />
        <meshBasicMaterial
          color={selected ? '#93c5fd' : '#2b3648'}
          transparent
          opacity={selected ? 0.85 : 0.45}
          side={THREE.DoubleSide}
        />
      </mesh>

      <group ref={orbitRef} name={`${config.name}-orbit`}>
        <group position={[config.orbitRadius, 0, 0]} name={config.name}>
          <mesh
            ref={planetRef}
            onClick={handleClick}
            rotation={[0, 0, config.tilt ?? 0]}
            scale={selected ? 1.14 : 1}
          >
            <sphereGeometry args={[config.size, 32, 32]} />
            <meshStandardMaterial
              color={config.color}
              emissive={selected ? '#1d4ed8' : config.emissive ?? '#000000'}
              emissiveIntensity={selected ? 0.55 : 0.15}
              roughness={0.95}
              metalness={0.05}
            />
          </mesh>

          {config.ring ? (
            <mesh rotation={[Math.PI / 2 + (config.ring.tilt ?? 0), 0, 0]}>
              <ringGeometry args={[config.ring.innerRadius, config.ring.outerRadius, 128]} />
              <meshStandardMaterial
                color={config.ring.color}
                transparent
                opacity={0.7}
                side={THREE.DoubleSide}
              />
            </mesh>
          ) : null}

          <Html position={[0, config.size + 1.2, 0]} center distanceFactor={14}>
            <div className={`planet-label ${selected ? 'is-selected' : ''}`}>{config.name}</div>
          </Html>
        </group>
      </group>
    </group>
  )
}

function FollowPlanetCamera({ planetName }: { planetName: string }) {
  const { camera, scene } = useThree()
  const planetPosition = useMemo(() => new THREE.Vector3(), [])
  const targetPosition = useMemo(() => new THREE.Vector3(), [])
  const followOffset = useMemo(() => new THREE.Vector3(0, 4.5, 11), [])

  useFrame((_, delta) => {
    const planet = scene.getObjectByName(planetName)
    if (!planet) return

    planet.getWorldPosition(planetPosition)
    targetPosition.copy(planetPosition).add(followOffset)

    camera.position.lerp(targetPosition, 1 - Math.exp(-delta * 2.4))
    camera.lookAt(planetPosition)
  })

  return null
}

export default App
