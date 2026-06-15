
<a id="readme-top"></a>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/softbox-github-hero-logo-for-light-theme.svg">
    <img src="docs/assets/softbox-github-hero-logo-for-dark-theme.svg" alt="Softbox" width="500">
  </picture>
</p>

<p align="center"><strong>Operating system for dynamic user interfaces.</strong></p>

<p align="center">
  <a href="https://github.com/softbox-hq/softbox"><img src="https://img.shields.io/badge/repo-softbox--hq%2Fsoftbox-111827" alt="Repository"></a>
  <a href="https://github.com/softbox-hq/softbox"><img src="https://img.shields.io/badge/runtime-React%20%2B%20Vite-2563eb" alt="React and Vite"></a>
  <a href="https://www.convex.dev/"><img src="https://img.shields.io/badge/control%20plane-Convex-f97316" alt="Convex"></a>
  <a href="https://github.com/softbox-hq/softbox"><img src="https://img.shields.io/badge/storage-MinIO%20%2F%20R2-059669" alt="MinIO or Cloudflare R2"></a>
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a> ·
  <a href="#how-it-works">How It Works</a> ·
  <a href="#create-an-app">Create an App</a> ·
  <a href="#star-trek-interface">Star Trek Interface</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="./SETUP.md">Full Setup</a>
</p>

## What if apps were not fixed?

Most software ships with an interface someone designed ahead of time. Softbox explores a different model: apps that can change while you use them.

Ask for dark mode, a database, a different layout, or a new way to inspect your data. Softbox sends the request to an AI coding worker, builds a candidate version, lets you preview it, and only promotes it after health checks pass.

The mental model is closer to the computer in Star Trek than to a normal settings screen: describe what you need, and the interface adapts to the task.

## ELI5

- Softbox is like a computer desktop in your browser.
- You right-click the desktop, make a new app, and tell it what you want.
- Think of it as a sibling to bolt.new, v0, or Lovable, but with a different runtime model.
- If you do not like a button, want a new database, or need the app to behave differently, you tell OpenClaw and it edits the app for you.

## Quickstart

Use Claude Code, Codex, or another agentic CLI tool, and give it `SETUP.md` to install Softbox.

The agent will roughly follow this sequence:

```bash
pnpm install
pnpm run bootstrap
# fill .env.local using SETUP.md
pnpm run doctor
pnpm start
```

Once the agent is done installing, run `pnpm start` and open [`localhost:4173`](http://localhost:4173).

> [!NOTE]
> If you run into installation issues, ask your AI agent to inspect `/docs/` as a reference.

## How It Works

After installation, Softbox runs as a local desktop-like environment in your browser. From there, you create apps, prompt OpenClaw to edit them, preview generated versions, and promote the version you want to keep.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/github-softbox-main-screen.png">
    <img src="docs/assets/github-softbox-main-screen.png" alt="Softbox" width="1000">
  </picture>
</p>

## Create an App

Let's say you want to create a calendar application.

1. Right-click the desktop.
2. Click `Create app`.
3. Choose a name. In this case, use `Calendar`.
4. Choose a slug. This is the internal Softbox name for the Vite application.
5. In the description, explain what the app should do and how its icon should look.
6. Once the application is created, Softbox generates the default Vite boilerplate.
7. Prompt Softbox to generate the calendar app. For example: `create calendar app. basic stuff`

![Create and generate a new app from the Softbox desktop](docs/assets/github-create-new-app-flow.gif)

> Notice that the browser and prompt input do not reload. The prompt input wraps the Vite application, so you can keep interacting with the app while Softbox prepares the next version.

## Change the Interface

After generating the calendar app, let's say you do not like the background.

> [!TIP]
> You can think of Softbox as an interface that changes when you ask. Instead of waiting for developers to build a night theme, you can simply ask for one.

![Change the generated app interface from the Softbox desktop](docs/assets/github-create-new-app-theme.gif)

### Inspect mode

Click the prompt bar to enter inspect mode. From there, you can select elements to change or modify. For example, you might ask Softbox to move a sidebar into a modal instead of keeping it on the side.

![Use inspect mode to modify a generated app](docs/assets/github-create-new-app-modal-2.gif)

## Add Backend State

A calendar also needs a backend. Prompt Softbox to create a SQL database, and the app can store data across future runs. The data persists between sessions.

![Add backend state to a generated app](docs/assets/github-db.gif)

## Preview, Promote, and Roll Back

If you are not satisfied with a generated version, roll back with one click.

![Roll back a generated app version](docs/assets/github-rollback.gif)

## Switch Apps

When you want to switch applications, click `Back to desktop`.

![Move between Softbox applications](docs/assets/github-change-applications-2.gif)

## Change Wallpapers

You can also change the desktop background.

![Wallpapers](docs/assets/github-wallpapers.gif)

## Star Trek Interface

Dynamic interfaces make some applications feel closer to science fiction. In Star Trek, characters like Captain Picard or Geordi La Forge do not click through a fixed settings panel for every task. They ask the ship computer for the view, data, simulation, or adjustment they need, and the interface responds to the intent.

That is the mental model Softbox explores for normal software: instead of treating the interface as fixed, you describe the change you want and the app can be rewritten around that request.

Similar ideas show up across science fiction, from the Enterprise computer in Star Trek to ship computers in films like Alien. The important part is not the voice assistant. The important part is that the interface becomes something you can negotiate with.

For example, when you open the Space 3D app and say `lock my view to jupiter`, OpenClaw rewrites the app code and points the camera at Jupiter.

![Point the Space 3D app camera at Jupiter](docs/assets/github-jupiter.gif)

You can extend the same idea further. You might ask Softbox to show asteroids approaching Jupiter, zoom in on a specific asteroid, display its known orbital path, or add a panel for its mineral profile if the app has access to that data.

This means you do not need to hard-code every possible action, such as navigation, distance, camera movement, planet selection, asteroid overlays, or data panels. You can describe what you want, and Softbox can prepare a new version of the app.

This still has limitations. See [Limitations](#limitations).

## It Also Runs Doom

In `/apps/doom`, you will find `DOOM.WAD`, which is the open source Freedoom WAD.

To play the classic version of Doom, replace the Freedoom WAD with the original WAD. You need to purchase the original game separately.

![Doom](docs/assets/github-doom.gif)

## What Softbox Solves

Softbox is for exploring software that is not locked to one interface forever.

Traditional apps usually ask users to adapt to the product. Softbox explores the opposite direction: the app can adapt to the user by changing its own code, rebuilding, and shipping a new candidate version.

The generated result is still a real Vite application. Each app in Softbox is standalone-first, so it can be extracted from Softbox and run separately.

This repo is experimental. A basic generated calendar app will not replace a mature product like Google Calendar today. The point is to explore a different path: interfaces that can be negotiated, regenerated, previewed, and promoted as the user's needs change.

You can think of Softbox as:

- a builder app, similar to v0, bolt.new, or Lovable
- a novel and experimental runtime for dynamic interfaces

## Architecture

Softbox keeps the browser shell stable while app code changes underneath it. The shell records prompts and previews generated app versions. The worker asks OpenClaw to edit the selected app workspace, builds a candidate version, uploads the artifacts, and only promotes the candidate after health checks pass.

## Limitations

Model inference is currently slow. Most changes require a few minutes of waiting.

## Requirements

| Requirement | Notes |
| --- | --- |
| Node.js 20+ | Runtime for scripts, shell, and worker |
| pnpm | Use pnpm at the repo root; do not run `npm install` here |
| Docker | Recommended for local Redis and MinIO |
| Convex project | Control plane for jobs, apps, versions, runtime state |
| OpenClaw CLI | Authenticated locally; used by the worker to edit app code |
| MinIO or Cloudflare R2 | Artifact storage for built app bundles |

> As a human, there should not be too much to install manually. Your AI agent can manage most of it, but you may need to authenticate OpenClaw if you have not done so yet.

## Documentation

| Document | Use it for |
| --- | --- |
| [`SETUP.md`](./SETUP.md) | Full local installation and verification |
| [`AGENTS.md`](./AGENTS.md) | Repository instructions for coding agents |
| [`CLAUDE.md`](./CLAUDE.md) | Claude-specific repository instructions |
| [`skills/softbox-wrap-app/SKILL.md`](./skills/softbox-wrap-app/SKILL.md) | App onboarding and wrapper work |
| [`docs/shell-host-surface.md`](./docs/shell-host-surface.md) | Shell host surface notes |
| [`docs/openclaw/gateway-control.md`](./docs/openclaw/gateway-control.md) | OpenClaw gateway integration |
| [`docs/openclaw/softbox-ui-auth.md`](./docs/openclaw/softbox-ui-auth.md) | OpenClaw UI auth notes |
| [`docs/openclaw/ws.md`](./docs/openclaw/ws.md) | OpenClaw websocket notes |
| [`docs/r2/R2-bottleneck.md`](./docs/r2/R2-bottleneck.md) | R2 storage notes |


## License

[MIT](./LICENSE)

<p align="right">(<a href="#readme-top">back to top</a>)</p>
