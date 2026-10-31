# offtrack client

The Mac client of [offtrack](https://offtrack.offsite-solutions.com), the Offsite Solutions tracker for work done with Claude Code. Every Claude Code session reports its milestones, open branches, manual tasks and ideas on its own, and the map shows what is still open. The “Your stats” page shows your own work in numbers.

**Full install guide (English and Hungarian):** https://offtrack.offsite-solutions.com/install
**User guide:** https://offtrack.offsite-solutions.com/guide

```sh
npm install -g github:offsite-solutions/offtrack-client
offtrack install      # English by default; add --lang hu for Hungarian
offtrack login        # paste your client token (generate it on the install page)
offtrack whoami
```

The skill alone installs with `npx skills add offsite-solutions/offtrack-client`, but it needs the client above; `offtrack install` replaces a linked copy with the client's own.

Requirements: macOS, Claude Code, Node.js 22 or newer, git. Update by running the `npm install -g` command again (`offtrack version` shows whether a newer [release](https://github.com/offsite-solutions/offtrack-client/releases) exists; sessions also mention it at startup); remove with `offtrack uninstall`, then `npm uninstall -g offtrack-client`.

License: MIT.

## What the client sends

Sessions send summaries of one to three sentences, never the conversation text. The client also sends the session ID, working directory path, client type, process ID, version and language.

If the working directory is a git repo with an `origin` remote, every session start also sends a salted SHA-256 fingerprint of the remote address and the relative location inside the repo. That is how offtrack recognises the same repo on another machine. The address, username and token never leave your machine. This is automatic and has no separate off switch. A fingerprint only matches among your own directories, so it never takes anyone into someone else's project.

This repository is a published copy of the `client/` folder of the offtrack project; changes are made there.

---

# offtrack kliens

Az [offtrack](https://offtrack.offsite-solutions.com) Mac-kliense. Az offtrack az Offsite Solutions feladatkövetője a Claude Code-dal végzett munkához: minden session magától jelenti a lezárt lépéseket, a nyitott ágakat, a kézi teendőket és az ötleteket, és a térképen látszik, mi van még nyitva. A Statisztikám oldal a saját munkádat mutatja számokban.

**Részletes telepítési útmutató (magyarul és angolul):** https://offtrack.offsite-solutions.com/install
**Használati útmutató:** https://offtrack.offsite-solutions.com/guide

A telepítés a fenti parancsokkal megy, magyarul `offtrack install --lang hu`-val (a CLAUDE.md-blokk, a parancs, a skill és a szerver üzenetei is magyarok lesznek); a kliens-tokent a telepítési oldalon, belépve generálhatod. Frissítés: ugyanaz az `npm install -g` parancs (az `offtrack version` megmutatja, van-e újabb [release](https://github.com/offsite-solutions/offtrack-client/releases); a sessionök indításkor is szólnak); eltávolítás: `offtrack uninstall`, majd `npm uninstall -g offtrack-client`.

Licenc: MIT.

## Mit küld a kliens

A sessionök egy-három mondatos összefoglalókat küldenek, a beszélgetés szövegét soha. A kliens elküldi a session azonosítóját, a munkakönyvtár útvonalát, a kliens típusát, a folyamat azonosítóját, a verziót és a nyelvet is.

Ha a munkakönyvtár git-repó `origin` remote-tal, minden session indulásakor elmegy a remote címéből számolt sózott SHA-256 lenyomat és a repón belüli relatív hely is. Ebből ismeri fel az offtrack ugyanazt a repót egy másik gépen. A cím, a felhasználónév és a token nem hagyja el a gépet. Ez automatikus, és külön nem kapcsolható ki. A lenyomat csak a saját könyvtáraid között illeszt, így senkit nem visz be más projektjébe.
