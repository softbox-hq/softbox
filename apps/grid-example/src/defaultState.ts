export const defaultGridConfig = {
  columns: 100,
  rows: 100,
  cellSize: 10,
};

export const initialLiveAppState = {
  route: "/",
  selection: null,
  ui: {
    grid: defaultGridConfig,
  },
};
