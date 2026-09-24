# Manual Browser Validation

Workspace ini tidak memasang E2E framework dan browser QA bukan automated test gate. Gunakan global `agent-browser` langsung ke domain production yang ditetapkan `APP_DOMAIN`.

```shell
SESSION="$(agent-browser session id --scope worktree --prefix manufacturing-information-system)"
agent-browser --session "$SESSION" open "https://${APP_DOMAIN}"
agent-browser --session "$SESSION" wait --load networkidle
agent-browser --session "$SESSION" snapshot -i
agent-browser --session "$SESSION" console
agent-browser --session "$SESSION" errors
agent-browser --session "$SESSION" a11y --json
agent-browser --session "$SESSION" screenshot --full tmp/browser-qa/smoke.png
agent-browser --session "$SESSION" close
```

Gunakan credential `.env` bagian `# Super User` hanya untuk flow yang diizinkan, jangan simpan auth state di repo, dan selalu tutup session setelah selesai.
