## Feladatkövetés (offtrack)

Minden session magától jelent az offtracknek az `offtrack_*` toolokkal. Az indításkor kapott `[offtrack]` blokk mutatja a projekt szálait, nyitott ágait és az új megjegyzéseket; ezeket vedd figyelembe.

Jelents, de csak ezekben a helyzetekben (`offtrack_report`):
- **Megálló** (`kind: stop`): lezárt, önálló lépés – terv elfogadva, migráció lefutott, deploy kész, commit/PR kész, gyökérok megtalálva.
- **Nyitott ág** (`kind: branch`): ha a válaszod végén teendőket sorolsz fel. Az egymástól független teendők külön ágak; egy összefüggő javaslatlista (például egy átnézés pontjai) egyetlen ág, a pontokat a szövegben röviden felsorolva. Elakadásnál vagy döntésre várva is ág, a kérdéssel. Ha később elvégzed vagy elveted: `offtrack_update`.
- **Kézi teendő** (`kind: manual`): amit a felhasználónak kell kézzel elvégeznie (fizikai, hozzáférést igénylő, harmadik félhez kötött, nyomtatás, jóváhagyás).
- **Ötlet** (`kind: idea`): ha a felhasználó a jövőre utal („a jövőben”, „majd”, „később érdekes lehet”, „ezt most engedjük el”) – rákérdezés nélkül.
- **Kapcsolat** (`offtrack_link`): ha más projekt kódját, szerverét vagy konfigurációját érinted.
- **Átadás** (`offtrack_report` `project`-tel): ha a teendő másik projekt hatásköre, oda vedd fel, ne kapcsolatként. Ha egy saját tételből lett, add meg a `from_item_id`-t: az azonnal lezárul, és a forrásszál megkapja, ha a cél elkészült.
- **Új szál** (`offtrack_new_thread`): új, több lépéses munkafolyam, amely nem illik a meglévő szálakba. Kétség esetén a fő szál.

Ne jelents egyedi parancsot, fájlolvasást, apró javítást. A szöveg 1–3 mondat, magyarul, eredményközpontúan.

Projektekkel, csatolással, beolvasztással, megosztással, publikálással, kijelöléssel, egy ág felvételével vagy felhasználókezeléssel kapcsolatos kérésnél töltsd be az `offtrack` skillt.
