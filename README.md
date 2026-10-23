# offtrack client

The Mac client of [offtrack](https://offtrack.offsite-solutions.com), the Offsite Solutions tracker for work done with Claude Code. Every Claude Code session reports its milestones, open branches, manual tasks and ideas on its own, and the map shows what is still open.

**Full install guide (English and Hungarian):** https://offtrack.offsite-solutions.com/install

```sh
git clone https://github.com/offsite-solutions/offtrack-client.git
cd offtrack-client && npm install
node install.mjs install
offtrack login        # paste your client token (generate it on the install page)
offtrack whoami
```

Requirements: macOS, Claude Code, Node.js 22 or newer. Keep the folder name `offtrack-client`: the installer recognises its own hooks by it. Update with `git pull`; remove with `node install.mjs uninstall`.

This repository is a published copy of the `client/` folder of the offtrack project; changes are made there.

---

# offtrack kliens

Az [offtrack](https://offtrack.offsite-solutions.com) Mac-kliense. Az offtrack az Offsite Solutions feladatkövetője a Claude Code-dal végzett munkához: minden session magától jelenti a lezárt lépéseket, a nyitott ágakat, a kézi teendőket és az ötleteket, és a térképen látszik, mi van még nyitva.

**Részletes telepítési útmutató (magyarul és angolul):** https://offtrack.offsite-solutions.com/install

A telepítés a fenti parancsokkal megy; a kliens-tokent a telepítési oldalon, belépve generálhatod. A mappa neve maradjon `offtrack-client`: a telepítő erről ismeri fel a saját hookjait. Frissítés: `git pull`; eltávolítás: `node install.mjs uninstall`.

Licenc: MIT.
