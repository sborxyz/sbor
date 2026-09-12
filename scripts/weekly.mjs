name: SBOR weekly report

on:
  schedule:
    - cron: "30 11 * * 1"     # Mondays, just after the daily fixing
  workflow_dispatch:

permissions:
  contents: write

jobs:
  report:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"

      - name: Build weekly report
        run: node scripts/weekly.mjs

      - name: Commit if changed
        run: |
          git config user.name  "sbor-bot"
          git config user.email "actions@users.noreply.github.com"
          git add weekly.txt weekly.html
          if git diff --staged --quiet; then
            echo "No change."
          else
            git commit -m "weekly report $(date -u +%Y-%m-%d) [skip netlify]"
            git push
          fi

      - name: Notify on failure
        if: failure()
        env:
          TG_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TG_CHAT: ${{ secrets.TELEGRAM_CHAT_ID }}
        run: |
          if [ -z "$TG_TOKEN" ]; then exit 0; fi
          MSG=$(printf 'SBOR weekly report FAILED on %s.\n\nThere is no report to send this week. Check the run:\nhttps://github.com/sborxyz/sbor/actions' "$(date -u +%Y-%m-%d)")
          curl -sS -X POST "https://api.telegram.org/bot$TG_TOKEN/sendMessage" \
            --data-urlencode "chat_id=$TG_CHAT" \
            --data-urlencode "disable_web_page_preview=true" \
            --data-urlencode "text=$MSG" > /dev/null
