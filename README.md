# PixelArena — Week 1 build

Neon arcade games portal. v1: portal shell + **Neon Rush** (endless runner).
Neon Snake card is a "coming soon" placeholder (Week 2).

## Play locally

```bash
cd pixelarena
python3 -m http.server 8080
# open http://localhost:8080
```

(A plain `file://` open works for the home page, but the service worker and
some features need `http://` — use the command above.)

## Deploy to GitHub Pages

1. Create a new repo named `pixelarena` on GitHub.
2. Push the contents of this folder to the repo's main branch.
3. Repo → Settings → Pages → Deploy from branch → `main` / `/ (root)`.
4. Live in ~1 minute at `https://<username>.github.io/pixelarena/`.

## Structure

```
index.html                  portal home
manifest.webmanifest        PWA manifest
sw.js                       service worker (offline play)
css/style.css               shared neon design system
js/home.js                  animated game-card previews
assets/logo.svg             logo · assets/icons/  PWA icons
games/neon-rush/            Neon Rush game (index.html + game.js)
```

## Adding a new game later

1. Create `games/<slug>/` with `index.html` + game JS (copy the neon-rush page as a template).
2. Add a game card in `index.html` (copy the Neon Rush card).
3. Add the new files to the `CORE` list in `sw.js` and bump the cache name.
