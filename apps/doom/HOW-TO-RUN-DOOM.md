# How to Run Doom Here

This app ships with **Freedoom** as the default bundled IWAD.

Why?
Because **Freedoom is open-source and redistributable**, while the original Doom game data is **not** something this repo can legally include.

## What this means

- `DOOM.WAD` in this app can safely contain **Freedoom**
- if you own the original Doom game, you can use **your own legally obtained IWAD** instead
- this project does **not** include or distribute the commercial Doom data files for you

## If you want to run the real Doom

You need your own valid Doom IWAD, usually something like:

- `DOOM.WAD` — registered / Ultimate Doom
- `DOOM2.WAD` — Doom II

### Option 1: Replace the bundled WAD

If you want the app to boot your own Doom copy by default:

1. Get your own legally obtained Doom IWAD
2. Copy it into `apps/doom/`
3. Rename or replace it as `DOOM.WAD`
4. Rebuild / reseed the app so Softbox picks up the new bundled asset - just put into the text input "ping" so that the whole app rebuilds.

## Important licensing note

Do **not** commit or publish commercial Doom WADs into a public repo unless you have the rights to do that.

Freedoom is included as the safe default because it is legal to redistribute.
The original Doom files are your responsibility to provide.

## Troubleshooting

If you replaced `DOOM.WAD` but still see Freedoom:

1. make sure you replaced the file in `apps/doom/DOOM.WAD`
2. make sure the file is actually your Doom IWAD, not another copy of Freedoom
3. rebuild / reseed the app so the new asset gets bundled
4. reload the app after the rebuild finishes

## In short

- want a legal default in the repo? use **Freedoom**
- want the original game? provide **your own IWAD** and replace or load it locally
