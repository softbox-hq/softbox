import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

type Point = {
  x: number
  y: number
}

type Direction = {
  x: number
  y: number
}

const BOARD_SIZE = 20
const INITIAL_SNAKE: Point[] = [
  { x: 10, y: 10 },
  { x: 9, y: 10 },
  { x: 8, y: 10 },
]
const INITIAL_DIRECTION: Direction = { x: 1, y: 0 }
const INITIAL_FOOD: Point = { x: 14, y: 10 }
const TICK_MS = 130

const DIRECTIONS: Record<string, Direction> = {
  w: { x: 0, y: -1 },
  a: { x: -1, y: 0 },
  s: { x: 0, y: 1 },
  d: { x: 1, y: 0 },
}

const isSamePoint = (a: Point, b: Point) => a.x === b.x && a.y === b.y

function makeRandomFood(snake: Point[]) {
  for (let i = 0; i < 200; i += 1) {
    const candidate = {
      x: Math.floor(Math.random() * BOARD_SIZE),
      y: Math.floor(Math.random() * BOARD_SIZE),
    }

    if (!snake.some((segment) => isSamePoint(segment, candidate))) {
      return candidate
    }
  }

  return { x: 0, y: 0 }
}

function App() {
  const [snake, setSnake] = useState(INITIAL_SNAKE)
  const [direction, setDirection] = useState(INITIAL_DIRECTION)
  const [nextDirection, setNextDirection] = useState(INITIAL_DIRECTION)
  const [food, setFood] = useState(INITIAL_FOOD)
  const [score, setScore] = useState(0)
  const [gameOver, setGameOver] = useState(false)
  const directionRef = useRef(direction)
  const nextDirectionRef = useRef(nextDirection)

  useEffect(() => {
    directionRef.current = direction
  }, [direction])

  useEffect(() => {
    nextDirectionRef.current = nextDirection
  }, [nextDirection])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      const requested = DIRECTIONS[key]

      if (!requested) {
        return
      }

      event.preventDefault()

      const current = nextDirectionRef.current
      const isReverse = current.x + requested.x === 0 && current.y + requested.y === 0

      if (isReverse) {
        return
      }

      setNextDirection(requested)
      nextDirectionRef.current = requested
    }

    window.addEventListener('keydown', handleKeyDown, { passive: false })
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    if (gameOver) {
      return
    }

    const interval = window.setInterval(() => {
      setDirection((currentDirection) => {
        const activeDirection = nextDirectionRef.current
        const head = snake[0]
        const nextHead = {
          x: head.x + activeDirection.x,
          y: head.y + activeDirection.y,
        }

        const hitWall =
          nextHead.x < 0 ||
          nextHead.x >= BOARD_SIZE ||
          nextHead.y < 0 ||
          nextHead.y >= BOARD_SIZE
        const hitSelf = snake.some((segment) => isSamePoint(segment, nextHead))

        if (hitWall || hitSelf) {
          setGameOver(true)
          return currentDirection
        }

        const ateFood = isSamePoint(nextHead, food)
        const nextSnake = [nextHead, ...snake]

        if (ateFood) {
          setScore((currentScore) => currentScore + 1)
          const nextFood = makeRandomFood(nextSnake)
          setFood(nextFood)
        } else {
          nextSnake.pop()
        }

        setSnake(nextSnake)
        directionRef.current = activeDirection
        return activeDirection
      })
    }, TICK_MS)

    return () => window.clearInterval(interval)
  }, [food, gameOver, snake])

  const cells = useMemo(() => {
    const occupied = new Map<string, 'snake' | 'snake-head' | 'food'>()

    snake.forEach((segment, index) => {
      occupied.set(`${segment.x}:${segment.y}`, index === 0 ? 'snake-head' : 'snake')
    })
    occupied.set(`${food.x}:${food.y}`, 'food')

    return Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, index) => {
      const x = index % BOARD_SIZE
      const y = Math.floor(index / BOARD_SIZE)
      const kind = occupied.get(`${x}:${y}`)

      return (
        <div
          key={`${x}-${y}`}
          className={`cell${kind ? ` ${kind}` : ''}`}
          aria-hidden="true"
        />
      )
    })
  }, [food, snake])

  const restart = () => {
    const resetSnake = INITIAL_SNAKE
    const resetDirection = INITIAL_DIRECTION

    setSnake(resetSnake)
    setDirection(resetDirection)
    setNextDirection(resetDirection)
    directionRef.current = resetDirection
    nextDirectionRef.current = resetDirection
    setFood(INITIAL_FOOD)
    setScore(0)
    setGameOver(false)
  }

  return (
    <main className="app-shell">
      <section className="hud" aria-label="Score and controls">
        <div>
          <p className="eyebrow">Snake Game</p>
          <h1>WASD to play</h1>
        </div>

        <div className="scoreboard">
          <span className="score-label">Score</span>
          <span className="score-value" aria-live="polite">
            {score}
          </span>
        </div>
      </section>

      <section className="game-shell" aria-label="Snake board">
        <div className="board" role="grid" aria-label="Snake board">
          {cells}
        </div>

        <div className="overlay">
          <p>{gameOver ? 'Game over' : 'Eat the food and stay alive'}</p>
          <p>Controls: W A S D</p>
          <button type="button" onClick={restart}>
            Restart
          </button>
        </div>
      </section>
    </main>
  )
}

export default App
