Softbox human notes

What this project does

Softbox is a stable shell around a mutable app.

The shell stays up.
The inner app can be rewritten by an agent, rebuilt, previewed, checked, and only then promoted live.

The rough flow is:

user writes prompt
worker picks up job
agent changes app code
worker builds new version
artifacts are uploaded
shell previews that version
health check passes
version becomes live

What /apps means

The /apps folder is where app source code lives.

But putting a folder into /apps does not automatically make it a Softbox app.

That is the important part.

If you drop a normal app into /apps, Softbox still does not know how to host it safely inside the shell.

What still needs to happen

The app usually needs to be wrapped for the Softbox runtime.

That means an agent will usually need to add a thin shell adapter around the app.

The wrapper is what lets Softbox:

mount the app
unmount the app
pass initial state in
receive state updates
receive healthy/error signals

In practice, the app usually needs:

src/entry.tsx
src/defaultState.ts
a thin wrapper that connects the app to the shell runtime
softbox.config.json
runtime setup so the shell and worker can actually use it

Simple rule

If the app is only a standalone app, no wrapper is needed yet.

If the app should work inside Softbox, the wrapper is needed.

Good mental model

Think of it like this:

your app is the product
Softbox is the host runtime
the wrapper is the bridge between them

Without the bridge, the app may run alone, but Softbox cannot mount it in the live workflow.

What to ask the agent to do

If you add a new app to /apps, ask the agent to:

1. inspect the app
2. create the Softbox wrapper
3. add the runtime entry files
4. create softbox.config.json
5. explain what changed

There is also a repo skill for this:

skills/softbox-wrap-app

That skill is the repo-specific guide for wrapping a new app for Softbox.

Suggested prompt

"I added a new app under /apps/<name>. Please wrap it for Softbox, register it, and explain the integration."

There is also a command for supported apps:

pnpm wrap-app -- --path apps/<name> --id <template-id>

That command is for browser-first React/Vite apps.
It does not automatically make Next.js or server-heavy apps work inside Softbox.

One more practical note

The best pattern is:

standalone app first
thin Softbox wrapper second

That keeps the app understandable and keeps the shell integration small.
