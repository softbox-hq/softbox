export type ChatMessage = {
  id: string
  role: 'user' | 'agent'
  body: string
  time: string
}

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
    body: 'Understood. I inspect, edit, verify, and report back in the same thread.',
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
