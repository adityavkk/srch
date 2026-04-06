#!/bin/bash
# Demo runner: types command character by character, runs it, lets output breathe

type_slow() {
  local cmd="$1"
  printf '\n\033[1;34m$\033[0m '
  for (( i=0; i<${#cmd}; i++ )); do
    printf '%s' "${cmd:$i:1}"
    sleep 0.05
  done
  sleep 0.4
  printf '\n\n'
}

run() {
  local cmd="$1"
  local pause="${2:-5}"
  type_slow "$cmd"
  eval "$cmd"
  sleep "$pause"
  printf '\n'
}

divider() {
  sleep 1
  printf '\033[2m────────────────────────────────────────\033[0m\n'
  sleep 0.5
}

clear
sleep 1

# 1. Web search — plain
run 'search web bun sqlite wasm' 6

divider

# 2. Web search — JSON
run 'search web react compiler --hq --json | head -20' 6

divider

# 3. Fetch a page
run 'search fetch https://clig.dev | head -12' 6

sleep 2
