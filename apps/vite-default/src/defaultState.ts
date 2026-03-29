export type ChatMessage = {
  id: string
  role: 'user' | 'agent'
  body: string
  time: string
  variant?: 'default' | 'runlog' | 'file'
}

export const firstReadFilePath = 'apps/vite-default/AGENTS.md'

export const firstReadFileContent = `# vite-default Agent Guide

Read this file before editing the app.

Also read the repo root AGENTS.md for overall Softbox rules.

App root:

- apps/vite-default

Main editing targets:

- src/App.tsx or src/app.tsx for UI and behavior
- src/index.css and src/App.css for styling
- src/defaultState.ts for seeded runtime state

Softbox runtime bridge:

- src/entry.tsx
- src/adapter/runtime.tsx
- src/adapter/shellAdapter.tsx

Rules:

- Keep this app runnable as a normal React + Vite app.
- Keep the Softbox wrapper thin.
- Prefer app-local changes over shell changes.
- Do not change softbox.config.json unless template/runtime wiring really changed.`

export const firstReadFileMessage = `FIRST FILE READ
${firstReadFilePath}

${firstReadFileContent}`

export const initialConversation: ChatMessage[] = [
  {
    id: 'agent-intro',
    role: 'agent',
    body: 'I am here. Tell me what to change, where it lives, and what constraints matter.',
    time: '09:41',
  },
  {
    id: 'user-context',
    role: 'user',
    body: 'Keep the interface direct. I want it to feel like a workspace between us.',
    time: '09:42',
  },
  {
    id: 'agent-loop',
    role: 'agent',
    variant: 'file',
    body: firstReadFileMessage,
    time: '09:42',
  },
]

export const initialLiveAppState = {
  route: '/',
  selection: null,
  ui: {
    messages: initialConversation,
    composerPlaceholder: 'Tell me what to change, where it lives, and any constraints.',
  },
}
