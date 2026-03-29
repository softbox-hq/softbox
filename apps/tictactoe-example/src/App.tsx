import { useEffect, useState } from "react";
import "./App.css";
import { useSoftboxRuntime } from "./adapter/runtime";
import {
  initialLiveAppState,
  type LiveAppState,
  type Player,
} from "./defaultState";

const WINNING_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
] as const;

const HUMAN_PLAYER: Player = "X";
const COMPUTER_PLAYER: Player = "O";

type GameResult = {
  winner: LiveAppState["winner"];
  winningLine: LiveAppState["winningLine"];
};

function evaluateBoard(board: LiveAppState["board"]): GameResult {
  for (const [a, b, c] of WINNING_LINES) {
    const cell = board[a];
    if (cell !== null && cell === board[b] && cell === board[c]) {
      return {
        winner: cell,
        winningLine: [a, b, c],
      };
    }
  }

  if (board.every((cell) => cell !== null)) {
    return {
      winner: "draw",
      winningLine: [],
    };
  }

  return {
    winner: null,
    winningLine: [],
  };
}

function getUrgentMove(
  board: LiveAppState["board"],
  player: Player,
): number | null {
  for (const line of WINNING_LINES) {
    const cells = line.map((index) => board[index]);
    const marks = cells.filter((cell) => cell === player).length;
    const emptyIndex = line.find((index) => board[index] === null);

    if (marks === 2 && emptyIndex !== undefined) {
      return emptyIndex;
    }
  }

  return null;
}

function chooseComputerMove(board: LiveAppState["board"]): number | null {
  const winningMove = getUrgentMove(board, COMPUTER_PLAYER);
  if (winningMove !== null) {
    return winningMove;
  }

  const blockingMove = getUrgentMove(board, HUMAN_PLAYER);
  if (blockingMove !== null) {
    return blockingMove;
  }

  if (board[4] === null) {
    return 4;
  }

  for (const index of [0, 2, 6, 8]) {
    if (board[index] === null) {
      return index;
    }
  }

  for (const index of [1, 3, 5, 7]) {
    if (board[index] === null) {
      return index;
    }
  }

  return null;
}

function createNextState(currentGame: LiveAppState, index: number): LiveAppState {
  const board = [...currentGame.board];
  board[index] = currentGame.nextPlayer;

  const result = evaluateBoard(board);

  return {
    route: "/",
    board,
    nextPlayer:
      result.winner === null
        ? currentGame.nextPlayer === HUMAN_PLAYER
          ? COMPUTER_PLAYER
          : HUMAN_PLAYER
        : initialLiveAppState.nextPlayer,
    winner: result.winner,
    winningLine: result.winningLine,
    moveCount: currentGame.moveCount + 1,
  };
}

function normalizeState(candidate: typeof initialLiveAppState): LiveAppState {
  const board =
    Array.isArray(candidate.board) && candidate.board.length === 9
      ? candidate.board.map((cell) => (cell === "X" || cell === "O" ? cell : null))
      : [...initialLiveAppState.board];

  const nextPlayer: Player = candidate.nextPlayer === "O" ? "O" : "X";
  const result = evaluateBoard(board);
  const moveCount = board.filter(Boolean).length;

  return {
    route: "/",
    board,
    nextPlayer:
      result.winner === null ? nextPlayer : initialLiveAppState.nextPlayer,
    winner: result.winner,
    winningLine: result.winningLine,
    moveCount,
  };
}

function App() {
  const { initialState, publishState } = useSoftboxRuntime();
  const [game, setGame] = useState<LiveAppState>(() => normalizeState(initialState));
  const isComputerThinking =
    game.winner === null && game.nextPlayer === COMPUTER_PLAYER;

  useEffect(() => {
    publishState(game);
  }, [game, publishState]);

  useEffect(() => {
    if (!isComputerThinking) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setGame((currentGame) => {
        if (
          currentGame.winner !== null ||
          currentGame.nextPlayer !== COMPUTER_PLAYER
        ) {
          return currentGame;
        }

        const move = chooseComputerMove(currentGame.board);
        if (move === null) {
          return currentGame;
        }

        return createNextState(currentGame, move);
      });
    }, 520);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [game.board, isComputerThinking]);

  const isHumanTurn =
    game.winner === null && game.nextPlayer === HUMAN_PLAYER && !isComputerThinking;

  const statusLabel =
    game.winner === "draw"
      ? "Nobody wins this round."
      : game.winner
        ? game.winner === HUMAN_PLAYER
          ? "You win the round."
          : "Computer wins the round."
        : isComputerThinking
          ? "Computer is thinking."
          : "Your turn.";

  const detailLabel =
    game.winner === null
      ? isComputerThinking
        ? "Waiting for O to answer your last move."
        : "Place your X on any open square."
      : "Press restart to clear the board and start another round.";

  function handleCellClick(index: number) {
    setGame((currentGame) => {
      if (
        currentGame.board[index] !== null ||
        currentGame.winner !== null ||
        currentGame.nextPlayer !== HUMAN_PLAYER
      ) {
        return currentGame;
      }

      return createNextState(currentGame, index);
    });
  }

  function handleRestart() {
    setGame(initialLiveAppState);
  }

  return (
    <main className="game-shell">
      <section className="game-panel">
        <p className="eyebrow">Softbox Mini Game</p>
        <h1>Tic-Tac-Toe</h1>
        <p className="intro">
          You play as X. After every mark, the computer answers as O and tries
          to win or block your line.
        </p>

        <div className="scoreboard" aria-live="polite">
          <div className="status-card">
            <span className="status-label">Status</span>
            <strong>{statusLabel}</strong>
            <p>{detailLabel}</p>
          </div>

          <div className="status-card compact">
            <span className="status-label">Moves</span>
            <strong>{game.moveCount}</strong>
            <p>Maximum 9 marks on the board.</p>
          </div>
        </div>

        <div className="board-frame">
          <div
            className="board-grid"
            role="grid"
            aria-label="Tic-tac-toe board"
            aria-busy={isComputerThinking}
          >
            {game.board.map((cell, index) => {
              const isWinningCell = game.winningLine.includes(index);
              const isDisabled = cell !== null || !isHumanTurn;

              return (
                <button
                  key={index}
                  type="button"
                  className={`board-cell ${cell ? `filled filled-${cell.toLowerCase()}` : ""} ${
                    isWinningCell ? "winning" : ""
                  }`.trim()}
                  role="gridcell"
                  aria-label={`Row ${Math.floor(index / 3) + 1}, column ${(index % 3) + 1}${
                    cell ? `, ${cell}` : ", empty"
                  }`}
                  disabled={isDisabled}
                  onClick={() => handleCellClick(index)}
                >
                  <span>{cell ?? ""}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="actions">
          <button type="button" className="reset-button" onClick={handleRestart}>
            Restart game
          </button>
          <p className="turn-note">
            You are <strong>X</strong>. The computer is <strong>O</strong>.
          </p>
        </div>
      </section>
    </main>
  );
}

export default App;
