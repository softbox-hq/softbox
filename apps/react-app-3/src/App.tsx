import { Canvas } from '@react-three/fiber'
import { Float, OrbitControls, Text } from '@react-three/drei'
import './App.css'

function App() {
  return (
    <main className="screen">
      <Canvas camera={{ position: [0, 0, 5], fov: 45 }} dpr={[1, 2]}>
        <color attach="background" args={['#000000']} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[3, 4, 5]} intensity={2} />
        <Float speed={1.5} rotationIntensity={1.2} floatIntensity={1.5}>
          <mesh>
            <icosahedronGeometry args={[1.2, 0]} />
            <meshStandardMaterial color="#ffffff" roughness={0.2} metalness={0.1} />
          </mesh>
        </Float>
        <Text position={[0, -2.2, 0]} fontSize={0.35} color="#ffffff" anchorX="center" anchorY="middle">
          React Three Fiber
        </Text>
        <OrbitControls enableZoom={false} enablePan={false} autoRotate autoRotateSpeed={1.2} />
      </Canvas>
    </main>
  )
}

export default App
