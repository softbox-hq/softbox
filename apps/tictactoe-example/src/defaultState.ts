export type Player = "X" | "O";
export type CellValue = Player | null;
export type Winner = Player | "draw" | null;

export type LiveAppState = {
  route: "/";
  board: CellValue[];
  nextPlayer: Player;
  winner: Winner;
  winningLine: number[];
  moveCount: number;
};

export const initialLiveAppState: LiveAppState = {
  route: "/",
  board: Array<CellValue>(9).fill(null),
  nextPlayer: "X",
  winner: null,
  winningLine: [],
  moveCount: 0,
};
