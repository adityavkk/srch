# srch demo
Output demo.gif
Set Shell "bash"
Set FontSize 14
Set Width 1000
Set Height 600
Set Padding 20
Set Theme "Catppuccin Mocha"
Set TypingSpeed 50ms

# 1. Web search
Type "search web bun sqlite wasm"
Enter
Sleep 8s
Ctrl+L

# 2. Web search JSON
Type "search web react compiler --json | head -25"
Enter
Sleep 8s
Ctrl+L

# 3. Code search
Type "search code 'react suspense cache' | head -20"
Enter
Sleep 8s
Ctrl+L

# 4. Fetch a page
Type "search fetch https://clig.dev | head -15"
Enter
Sleep 8s

Sleep 2s
