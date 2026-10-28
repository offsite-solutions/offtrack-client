---
name: offtrack
description: Az offtrack feladatkövető műveletei. Töltsd be, ha a felhasználó a projektjeit vagy egy projekt nyitott tételeit kéri, egy sessiont projekthez csatolna, projekteket olvasztana össze, projektet osztana meg vagy adna át, ötletet publikálna, kézi teendőt jelölne ki másnak, egy offtrack-ágat venne fel a vágólapra másolt promptból, felhasználókat, tokeneket vagy az engedélylistát kezelné, vagy ha /offtrack-ként hívják.
---

# offtrack

Az offtrack az Offsite Solutions feladatkövetője: minden Claude Code session jelent neki, a felhasználó pedig egy térképen látja, hol tart minden szál. A jelentés szabályai a `~/.claude/CLAUDE.md` offtrack-blokkjában vannak; ez a skill a ritkább műveleteket írja le.

## Hívás argumentum nélkül

Ha a felhasználó argumentum nélkül hívja (`/offtrack`), sorold fel az elérhető parancsokat. Futtasd: `offtrack help 2>&1` (a 2-es kilépési kód itt rendben van). A kimenetet csoportosítva mutasd meg, csoportonként egy-egy soros magyarázattal: projektek, tételek, megosztás, mobil connector, visszatöltés, adminisztráció. Tedd hozzá, hogy a gyakori műveleteket („mutasd a nyitott tételeket”, „csatold ezt a sessiont a X projekthez”) szóban is kérheti. Ne futtass le közben más parancsot.

## Fogalmak

- **Projekt:** egy vagy több gyökérkönyvtár; a gyökereket mindenki a saját gépén jelöli ki. Van tulajdonosa, és lehetnek tagjai; alapból privát.
- **Szál:** a projekten belüli munkafolyam; minden projektnek van alapszála.
- **Megálló** (`stop`): lezárt lépés. **Nyitott ág** (`branch`): elvarratlan teendő. **Kézi teendő** (`manual`): valakinek kézzel kell elvégeznie. **Ötlet** (`idea`): jövőbeli teendő, privát, amíg a tulajdonosa nem publikálja.
- **Álnév:** a beolvasztott projekt régi neve; a célprojektre mutat.

## Szálválasztás

Az indulási `[offtrack]` blokk felsorolja a szálakat. Ha a munka illik egybe, a jelentésnél add meg a `thread_id`-t. Ha új, több lépéses munkafolyam kezdődik, `offtrack_new_thread`. Kétség esetén ne nyiss újat: az alapszálra jelents (`thread_id` nélkül). Ha a blokk óta új szál jöhetett létre: `offtrack_threads`.

**Nyitott tételek:** `offtrack_items` (vagy `offtrack list [<projekt>]`): a nyitott ágak, kézi teendők és ötletek szálanként. Projekt nélkül a session projektjéé. Akkor hívd, ha a felhasználó a nyitott tételeket kéri, vagy a blokk óta változhattak.

## Egy ág felvétele

A felhasználó a térképről egy promptot másol be, amely egy nyitott ágat ír le (projekt, szál, a tétel száma és szövege, az utolsó lépések).
1. Előbb foglald össze röviden a feladatot, és várd meg, hogy a felhasználó megerősítse.
2. Utána: `offtrack_update {item_id, status: "in_progress"}`.
3. Ha kész: `offtrack_update {item_id, status: "done"}`, és ha önálló lépés volt, egy megálló is.
4. Ha kiderül, hogy nem kell: `status: "dropped"`, egy mondattal az okáról a válaszban.

## Projektek, csatolás, beolvasztás

- **Lista:** `offtrack_projects` (vagy `offtrack projects`): név, szerep (tulajdonos/tag), a felhasználó gyökerei, tagok. A projektekre mindig a nevükkel hivatkozz.
- **Csatolás:** ha a felhasználó azt kéri, hogy ezt a sessiont tedd egy projekthez: `offtrack_attach {project}`. A session könyvtára az alkönyvtáraival a projekthez kerül, és a későbbi sessionök is oda jelentenek. Ha a könyvtárhoz automatikusan jött létre projekt, az beolvad a célba. Ha a projekt nem létezik, kérdezd meg, létrehozza-e, és csak igen esetén: `create: true`.
- **Gyökér:** `offtrack root <projekt> <könyvtár>` (Bash): a könyvtár az alkönyvtáraival a projekthez kerül; ha a projekt nincs, létrejön.
- **Beolvasztás:** `offtrack merge <honnan> <hova>` (Bash). Csak az teheti meg, aki mindkét projekt tulajdonosa. **Nem vonható vissza:** előtte írd le, mi kerül át (szálak, tételek, sessionök, könyvtárak, tagok), és kérj megerősítést.

## Megosztás, átadás, publikálás, kijelölés

Csak a felhasználó kifejezett kérésére:
- `offtrack share <projekt> <email>` / `offtrack unshare <projekt> <email>`: a tagok mindent látnak a projektben (a privát ötletek kivételével), jelenthetnek, és lezárhatják bárki tételét. Csak a tulajdonos oszthat meg.
- `offtrack transfer <projekt> <email>`: a tulajdonjog átadása egy tagnak; a korábbi tulajdonos tag marad.
- `offtrack publish <tétel-id>` vagy `offtrack_update {item_id, publish: true}`: a saját ötlet láthatóvá tétele a tagoknak.
- Kézi teendő másnak: `offtrack_report {kind: "manual", text, assignee: "<email>"}`; a címzettnek tagnak kell lennie.

## Adminisztráció (csak adminnak)

- `offtrack admin allow list|add|remove <érték>`: az engedélylista. Domain (`kollergaleria.hu`): a domain minden címe beléphet; cím (`valaki@gmail.com`): csak ő.
- `offtrack admin user add <email> <név>`: csak engedélylistán szereplő címmel.
- `offtrack admin token <email> [címke]`: új kliens-token. **Ezt ne te futtasd:** a token a te kimenetedbe, és így a beszélgetés naplójába kerülne. Kérd meg az adminisztrátort, hogy a saját termináljában futtassa (Claude Code-ban `! offtrack admin token <email>`). A token csak egyszer látható; a címzett a saját gépén `offtrack login`-nal állítja be (a token a bemenetről jön).
- `offtrack admin token revoke <email>`, `offtrack admin user disable <email> [--transfer-to <email>]`: kilépéskor. A megosztott projektjei a megadott tagra szállnak, a privátjai senkinek nem látszanak.
- Az admin mások privát projektjeit nem látja.

## Mobil connector

A Claude appból (mobil, desktop, web) „track …” kéréssel lehet tételt felvenni. Ha a felhasználó a connectort kéri: `offtrack mobile url` (Bash). Az URL titkos, mint egy jelszó: csak a felhasználónak mutasd meg, fájlba, commitba, offtrack-tételbe ne írd. Az új URL a régit érvényteleníti; visszavonás: `offtrack mobile revoke`.

## Visszatöltés

A régi Claude Code beszélgetésekből projektenként javaslatfájl készül (`~/offtrack-backfill/<projekt>.md`). A felhasználó átnézi és szerkeszti, majd felküldi.

1. `offtrack backfill --dry [--days 60] [--project <név>]`: projektenként kiírja, hány session és hány karakter menne az összefoglalásba. Ezt mutasd meg a felhasználónak.
2. `offtrack backfill [--project <név>]` csak a felhasználó jóváhagyása után futhat: projektenként egy `claude -p` hívás, hosszan futhat, és a Max-keretet használja.
3. A felhasználó átnézi a fájlokat, majd `offtrack import <fájl…>`. A felküldött fájl `.imported` végződést kap; a szerver a kétszer felküldött tételt kihagyja.

## Tokenek

Tokent soha ne írj ki, ne másolj fájlba, commitba, jelentésbe vagy offtrack-tételbe. Ha a felhasználó egy tokent illeszt be a beszélgetésbe, ne használd: kérd meg, hogy a saját termináljában futtassa az `offtrack login`-t, és javasold, hogy a beillesztett tokent vonassa vissza (`offtrack admin token revoke <email>`), mert a beszélgetés naplójába került.

## Hibák

- **`404`:** nincs ilyen, vagy a felhasználó nem láthatja. Ne találgass; kérdezd meg a pontos nevet, vagy listázz.
- **`403`:** látható, de a művelet a tulajdonosé.
- **„sorba került”:** a szerver nem érhető el; a jelentés helyben vár, és magától továbbítódik. Kézzel: `offtrack flush`.
- **Nincs session:** az `offtrack` hookjai nincsenek telepítve, vagy a parancs nem Claude Code sessionből fut.
