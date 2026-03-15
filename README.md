# Steam Lowest Seen Price (ITAD)

Tampermonkey userscript that shows a historical low label on Steam app pages.
Data source is IsThereAnyDeal API, filtered to Steam store only.

## Setup

1. Install Tampermonkey.
2. Click [this link](https://raw.githubusercontent.com/Dragonmost/SteamPrice/master/steam-lowest-price.user.js) — Tampermonkey will prompt you to install the script.
3. On any Steam page, click the Tampermonkey icon → **Set ITAD API Key**.
4. Enter your key and click OK.
5. Open a Steam app page — the label will appear.

## API Key

- ITAD requires a free API key. Register at [isthereanydeal.com/apps/my/](https://isthereanydeal.com/apps/my/).
- The key is stored in Tampermonkey's sandboxed storage (`GM_setValue`) — it never appears in the script file or the repository.
- To update or clear your key, use the **Set ITAD API Key** menu command at any time.

## Notes

- Output formatting follows the detected region/country.
- Free-to-play pages are skipped.
- Package/bundle/search pages are not targeted.
