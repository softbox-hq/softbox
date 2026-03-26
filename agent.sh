#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./agent.sh [options] "prompt"
  echo "prompt" | ./agent.sh [options] -

Options:
  -m, --model MODEL       Override the agent model
  -c, --command COMMAND   Override the agent command (default: $AGENT_COMMAND or codex)
  -C, --cd DIR            Working directory for the agent (default: current directory)
  -h, --help              Show this help

Examples:
  ./agent.sh -m gpt-5.4-mini "Explain this codebase"
  ./agent.sh "Move object A to the center"
  echo "Refactor the CRM header" | ./agent.sh -m gpt-5.4-mini -
EOF
}

agent_command="${AGENT_COMMAND:-codex}"
agent_model="${AGENT_MODEL:-}"
workdir="$(pwd)"
prompt=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -m|--model)
      [[ $# -ge 2 ]] || { echo "Missing value for $1" >&2; exit 1; }
      agent_model="$2"
      shift 2
      ;;
    -c|--command)
      [[ $# -ge 2 ]] || { echo "Missing value for $1" >&2; exit 1; }
      agent_command="$2"
      shift 2
      ;;
    -C|--cd)
      [[ $# -ge 2 ]] || { echo "Missing value for $1" >&2; exit 1; }
      workdir="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      prompt="${*:-}"
      break
      ;;
    -*)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
    *)
      prompt="${*:-}"
      break
      ;;
  esac
done

if [[ -z "$prompt" ]]; then
  echo "Missing prompt." >&2
  usage >&2
  exit 1
fi

args=()

if [[ "$agent_command" == "codex" || "$(basename "$agent_command")" == codex* ]]; then
  args+=(exec --sandbox workspace-write --skip-git-repo-check --color never --cd "$workdir")
  if [[ -n "$agent_model" ]]; then
    args+=(--model "$agent_model")
  fi

  if [[ "$prompt" == "-" ]]; then
    exec "$agent_command" "${args[@]}" -
  fi

  exec "$agent_command" "${args[@]}" "$prompt"
fi

if [[ -n "$agent_model" ]]; then
  args+=(--model "$agent_model")
fi

if [[ "$prompt" == "-" ]]; then
  exec "$agent_command" -p "$(cat)" --no-session-persistence --dangerously-skip-permissions --tools "Read,Glob,Grep,Edit,Write,Bash" "${args[@]}"
fi

exec "$agent_command" -p "$prompt" --no-session-persistence --dangerously-skip-permissions --tools "Read,Glob,Grep,Edit,Write,Bash" "${args[@]}"
