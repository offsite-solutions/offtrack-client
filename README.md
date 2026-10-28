# offtrack client

The Mac client of [offtrack](https://offtrack.offsite-solutions.com), the Offsite Solutions tracker for work done with Claude Code. Every Claude Code session reports its milestones, open branches, manual tasks and ideas on its own, and the map shows what is still open.

**Full install guide (English and Hungarian):** https://offtrack.offsite-solutions.com/install

```sh
npm install -g github:offsite-solutions/offtrack-client
offtrack install      # English by default; add --lang hu for Hungarian
offtrack login        # paste your client token (generate it on the install page)
offtrack whoami
```

Requirements: macOS, Claude Code, Node.js 22 or newer, git. Update by running the `npm install -g` command again; remove with `offtrack uninstall`, then `npm uninstall -g offtrack-client`.

This repository is a published copy of the `client/` folder of the offtrack project; changes are made there.

---

# offtrack kliens

Az [offtrack](https://offtrack.offsite-solutions.com) Mac-kliense. Az offtrack az Offsite Solutions feladatkövetője a Claude Code-dal végzett munkához: minden session magától jelenti a lezárt lépéseket, a nyitott ágakat, a kézi teendőket és az ötleteket, és a térképen látszik, mi van még nyitva.

**Részletes telepítési útmutató (magyarul és angolul):** https://offtrack.offsite-solutions.com/install

A telepítés a fenti parancsokkal megy, magyarul `offtrack install --lang hu`-val (a CLAUDE.md-blokk, a parancs, a skill és a szerver üzenetei is magyarok lesznek); a kliens-tokent a telepítési oldalon, belépve generálhatod. Frissítés: ugyanaz az `npm install -g` parancs; eltávolítás: `offtrack uninstall`, majd `npm uninstall -g offtrack-client`.

Licenc: MIT.
