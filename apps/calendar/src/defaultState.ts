export type LiveAppTheme = 'light' | 'dark'

export type LiveAppState = {
  route: string
  selection: null
  ui: {
    selectedDate: string | null
    view: 'month'
    theme: LiveAppTheme
  }
}

export const initialLiveAppState: LiveAppState = {
  route: '/',
  selection: null,
  ui: {
    selectedDate: null,
    view: 'month',
    theme: 'light',
  },
}
