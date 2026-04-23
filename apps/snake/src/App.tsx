import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

type Point = {
  x: number
  y: number
}

type Direction = 'up' | 'down' | 'left' | 'right'
type Phase = 'ready' | 'playing' | 'game-over'

const GRID_SIZE = 16
const APPLE_TARGET = 25
const TICK_MS = 150

const DIRECTION_VECTORS: Record<Direction, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}

const OPPOSITES: Record<Direction, Direction> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
}

function keyForPoint({ x, y }: Point) {
  return `${x}:${y}`
}

function createInitialSnake(): Point[] {
  const mid = Math.floor(GRID_SIZE / 2)
  return [
    { x: mid, y: mid },
    { x: mid - 1, y: mid },
    { x: mid - 2, y: mid },
  ]
}

function createApples(snake: Point[], count: number): Point[] {
  const occupied = new Set(snake.map(keyForPoint))
  const available: Point[] = []

  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      const point = { x, y }
      if (!occupied.has(keyForPoint(point))) {
        available.push(point)
      }
    }
  }

  const apples: Point[] = []
  const max = Math.min(count, available.length)

  while (apples.length < max) {
    const index = Math.floor(Math.random() * available.length)
    const [picked] = available.splice(index, 1)
    apples.push(picked)
  }

  return apples
}

function topUpApples(snake: Point[], apples: Point[]) {
  const occupied = new Set([...snake, ...apples].map(keyForPoint))
  const available: Point[] = []

  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      const point = { x, y }
      if (!occupied.has(keyForPoint(point))) {
        available.push(point)
      }
    }
  }

  if (apples.length >= APPLE_TARGET || available.length === 0) {
    return apples
  }

  const nextApples = [...apples]
  const needed = Math.min(APPLE_TARGET - apples.length, available.length)

  for (let i = 0; i < needed; i += 1) {
    const index = Math.floor(Math.random() * available.length)
    const [picked] = available.splice(index, 1)
    nextApples.push(picked)
  }

  return nextApples
}

function App() {
  const [snake, setSnake] = useState<Point[]>(() => createInitialSnake())
  const [apples, setApples] = useState<Point[]>(() =>
    createApples(createInitialSnake(), APPLE_TARGET),
  )
  const [direction, setDirection] = useState<Direction>('right')
  const [queuedDirection, setQueuedDirection] = useState<Direction>('right')
  const [phase, setPhase] = useState<Phase>('ready')
  const [score, setScore] = useState(0)
  const [bestScore, setBestScore] = useState(0)
  const [speed, setSpeed] = useState(TICK_MS)
  const boardRef = useRef<HTMLDivElement | null>(null)

  const resetGame = useCallback((nextPhase: Phase = 'ready') => {
    const nextSnake = createInitialSnake()
    setSnake(nextSnake)
    setApples(createApples(nextSnake, APPLE_TARGET))
    setDirection('right')
    setQueuedDirection('right')
    setPhase(nextPhase)
    setScore(0)
    setSpeed(TICK_MS)
  }, [])

  const beginGame = useCallback(() => {
    setPhase((current) => (current === 'ready' ? 'playing' : current))
    boardRef.current?.focus()
  }, [])

  const changeDirection = useCallback(
    (nextDirection: Direction) => {
      setQueuedDirection((currentQueued) => {
        if (
          OPPOSITES[direction] === nextDirection ||
          OPPOSITES[currentQueued] === nextDirection
        ) {
          return currentQueued
        }
        return nextDirection
      })
      setPhase((current) => (current === 'ready' ? 'playing' : current))
      boardRef.current?.focus()
    },
    [direction],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const keyToDirection: Record<string, Direction> = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
        w: 'up',
        s: 'down',
        a: 'left',
        d: 'right',
      }

      const nextDirection = keyToDirection[event.key]
      if (nextDirection) {
        event.preventDefault()
        changeDirection(nextDirection)
        return
      }

      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault()
        if (phase === 'game-over') {
          resetGame('playing')
        } else {
          setPhase((current) => (current === 'ready' ? 'playing' : current))
        }
        boardRef.current?.focus()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [changeDirection, phase, resetGame])

  useEffect(() => {
    if (phase !== 'playing') {
      return
    }

    const interval = window.setInterval(() => {
      setSnake((currentSnake) => {
        const activeDirection =
          OPPOSITES[direction] === queuedDirection ? direction : queuedDirection
        const vector = DIRECTION_VECTORS[activeDirection]
        const head = currentSnake[0]
        const nextHead = {
          x: head.x + vector.x,
          y: head.y + vector.y,
        }

        setDirection(activeDirection)

        const hitWall =
          nextHead.x < 0 ||
          nextHead.x >= GRID_SIZE ||
          nextHead.y < 0 ||
          nextHead.y >= GRID_SIZE

        const ateApple = apples.some(
          (apple) => apple.x === nextHead.x && apple.y === nextHead.y,
        )
        const bodyToCheck = ateApple ? currentSnake : currentSnake.slice(0, -1)
        const hitSelf = bodyToCheck.some(
          (segment) => segment.x === nextHead.x && segment.y === nextHead.y,
        )

        if (hitWall || hitSelf) {
          setPhase('game-over')
          setBestScore((currentBest) => Math.max(currentBest, score))
          return currentSnake
        }

        const nextSnake = [nextHead, ...currentSnake]
        if (!ateApple) {
          nextSnake.pop()
        } else {
          setScore((currentScore) => {
            const nextScore = currentScore + 1
            setBestScore((currentBest) => Math.max(currentBest, nextScore))
            return nextScore
          })
          setSpeed((currentSpeed) => Math.max(75, currentSpeed - 2))
          setApples((currentApples) => {
            const remaining = currentApples.filter(
              (apple) => apple.x !== nextHead.x || apple.y !== nextHead.y,
            )
            return topUpApples(nextSnake, remaining)
          })
        }

        return nextSnake
      })
    }, speed)

    return () => window.clearInterval(interval)
  }, [apples, direction, phase, queuedDirection, score, speed])

  useEffect(() => {
    if (phase === 'ready') {
      setApples((currentApples) => topUpApples(snake, currentApples))
    }
  }, [phase, snake])

  const appleKeys = useMemo(() => new Set(apples.map(keyForPoint)), [apples])
  const snakeKeys = useMemo(() => new Set(snake.map(keyForPoint)), [snake])
  const headKey = keyForPoint(snake[0])

  return (
    <main className="game-shell">
      <div className="hud" aria-label="Game HUD">
        <div className="hud__cluster hud__cluster--score">
          <div className="hud__label">Score</div>
          <div className="hud__value">{score.toString().padStart(3, '0')}</div>
        </div>

        <div className="hud__center">
          <div className="hud__title">Snake</div>
          <div className="hud__status">
            {phase === 'playing'
              ? 'Run live'
              : phase === 'game-over'
                ? 'Game over'
                : 'Press any arrow key'}
          </div>
        </div>

        <div className="hud__cluster hud__cluster--meta">
          <div className="hud__pill">
            <span className="hud__pill-label">Best</span>
            <strong>{bestScore.toString().padStart(3, '0')}</strong>
          </div>
          <div className="hud__pill">
            <span className="hud__pill-label">Apples</span>
            <strong>{apples.length}</strong>
          </div>
        </div>
      </div>

      <div
        ref={boardRef}
        className="board"
        role="application"
        aria-label="Snake game board"
        tabIndex={0}
        style={{
          gridTemplateColumns: `repeat(${GRID_SIZE}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${GRID_SIZE}, minmax(0, 1fr))`,
        }}
        onClick={beginGame}
      >
        {Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, index) => {
          const x = index % GRID_SIZE
          const y = Math.floor(index / GRID_SIZE)
          const pointKey = keyForPoint({ x, y })
          const isHead = pointKey === headKey
          const isSnake = snakeKeys.has(pointKey)
          const isApple = appleKeys.has(pointKey)

          return (
            <div
              key={pointKey}
              className={[
                'cell',
                isSnake ? 'cell--snake' : '',
                isHead ? 'cell--head' : '',
                isApple ? 'cell--apple' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            />
          )
        })}

        {phase !== 'playing' && (
          <div className="board__overlay">
            <div className="board__card">
              <div className="board__card-kicker">
                {phase === 'game-over' ? 'Run ended' : 'Arcade mode'}
              </div>
              <h1 className="board__card-title">
                {phase === 'game-over' ? 'Try again' : 'Ready?'}
              </h1>
              <p className="board__card-copy">
                {phase === 'game-over'
                  ? 'Space resets. Arrow keys steer. Keep the board full of fruit.'
                  : 'Hit start or press an arrow key to launch the run.'}
              </p>
              <button
                type="button"
                className="overlay-button"
                onClick={
                  phase === 'game-over'
                    ? () => {
                        resetGame('playing')
                        boardRef.current?.focus()
                      }
                    : beginGame
                }
              >
                {phase === 'game-over' ? 'Restart run' : 'Start run'}
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}

export default App
