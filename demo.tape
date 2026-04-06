# srch demo tape
Output demo.gif
Set Shell "bash"
Set FontSize 14
Set Width 1000
Set Height 600
Set Padding 20
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

# Title
Type "# srch — local-first research CLI"
Enter
Sleep 1s
Ctrl+L

# 1. Show help
Type "search --help"
Enter
Sleep 3s
Ctrl+L

# 2. Web search
Type "search web bun sqlite wasm"
Enter
Sleep 4s
Ctrl+L

# 3. Web search with provider + JSON
Type "search web react compiler --provider brave --json | head -30"
Enter
Sleep 4s
Ctrl+L

# 4. Fetch a page
Type "search fetch https://clig.dev | head -20"
Enter
Sleep 4s
Ctrl+L

# 5. Fetch a GitHub repo
Type "search fetch https://github.com/tobi/qmd --json | head -20"
Enter
Sleep 5s
Ctrl+L

# 6. Docs index + search
Type "search docs index status --json"
Enter
Sleep 3s
Ctrl+L

# 7. Inspect tools
Type "search inspect tools --json | head -25"
Enter
Sleep 3s
Ctrl+L

# 8. Verbose mode
Type "search web sqlite wasm --verbose 2>&1 | head -20"
Enter
Sleep 4s
Ctrl+L

# 9. Config
Type "search config --json"
Enter
Sleep 2s

# Done
Sleep 2s
