# MUSE selbst hosten

MUSE ist eine statische Seite. Sie braucht keinen Anwendungsserver, keine
Datenbank und kein Konto – alles liegt im Browser. Der Server muss nur Dateien
ausliefern und **HTTPS sprechen**.

## Warum HTTPS nicht optional ist

Kamera und Mikrofon gibt es im Browser nur in einem *secure context*: HTTPS
oder `localhost`. Nichts anderes zählt – auch `http://192.168.1.42:3000` nicht.

Das ist kein Umweg, sondern der entscheidende Punkt für genau den Fall, um den
es hier geht: **Handy als Kamera und Mikro.** Ohne HTTPS gibt es nicht etwa eine
Fehlermeldung oder eine Nachfrage, sondern die Schnittstelle existiert schlicht
nicht. MUSE sagt das inzwischen ausdrücklich („Camera and microphone need
HTTPS"), statt „keine Kamera gefunden" zu melden und dich Hardware suchen zu
lassen.

Was ohne HTTPS trotzdem funktioniert: Pattern-Editor, Piano Roll, Arrangement,
Tone Map, Wiedergabe. Was nicht: Jam Room mit Stimme, Handtracking, Camera
Sequencer, Humming-Import.

## Bauen

```bash
npm install
npm run build          # Ergebnis: dist/
```

`dist/` ist vollständig eigenständig. Die SoundFont (`soundfonts/A320U.sf2`)
und die Schriften sind mitgebaut; im Betrieb wird **keine** externe Adresse
aufgerufen. Ein Server ohne Internetzugang reicht.

## Variante 1: Caddy (empfohlen)

Caddy besorgt und erneuert das Zertifikat selbst.

```bash
# deploy/Caddyfile: muse.example.com durch deine Adresse ersetzen
docker compose -f deploy/compose.yaml up -d --build
```

Das war es. Port 80 und 443 müssen erreichbar sein, damit Let's Encrypt das
Zertifikat ausstellen kann.

### Heimserver ohne öffentliche Domain

Wer den Server nur im eigenen Netz betreibt, hat keine öffentliche Domain und
damit kein Let's-Encrypt-Zertifikat. Caddy kann trotzdem eines ausstellen, über
seine eigene lokale CA:

```caddyfile
192.168.1.42.nip.io {
	tls internal
	root * /srv
	try_files {path} {path}.html /index.html
	file_server
}
```

`nip.io` löst jede IP-Adresse auf sich selbst auf, du brauchst also keinen
DNS-Eintrag. Das Wurzelzertifikat aus dem Caddy-Volume
(`/data/caddy/pki/authorities/local/root.crt`) einmal auf jedem Handy
installieren – danach ist die Seite vertrauenswürdig und Kamera und Mikro
funktionieren.

Auskommentiert steht dieser Block schon in `deploy/Caddyfile`.

## Variante 2: Vorhandener nginx

`deploy/nginx.conf` ist ein fertiger Serverblock. Der Inhalt von `dist/` gehört
nach `/var/www/muse`. Zwei Dinge macht die Konfiguration, die man leicht
vergisst:

- `try_files $uri $uri.html /index.html` – unbekannte Pfade gehören der App,
  nicht dem Dateisystem
- `assets/` und `soundfonts/` dauerhaft cachen, die App-Hülle dagegen nicht,
  sonst kommt ein Update nie an

## Variante 3: Irgendein Static-Hosting

`dist/` hochladen, fertig. Die Pfade sind relativ, MUSE läuft also auch unter
einem Unterpfad wie `https://example.com/muse/`. Nötig ist nur, dass unbekannte
Pfade auf `index.html` zeigen.

## Auf dem Handy einrichten

1. Die HTTPS-Adresse im Browser des Handys öffnen.
2. „Zum Startbildschirm hinzufügen". MUSE meldet sich als installierbare App an
   und startet danach ohne Browserleiste.
3. Beim ersten Antippen von **Drums**, **Theremin** oder **Hände** fragt der
   Browser nach Kamera und Mikrofon. Einmal erlauben genügt.

Nach dem ersten Laden liegt alles im Cache des Geräts, auch die SoundFont. Ein
zweites Kind auf einem zweiten Handy braucht denselben Weg – jedes Gerät hat
seinen eigenen Speicher, geteilt wird nichts.

## Was aufs Handy passt

| Ansicht | Handy |
| --- | --- |
| Jam Room | ja – Trommelzonen, Theremin, Aufnahme, Handtracking |
| Patterns | ja – Antippen und Ziehen funktioniert mit dem Finger |
| Camera | ja – braucht die Rückkamera und etwas Licht |
| Piano Roll, Arrangement | geht, ist aber für Maus und großen Schirm gedacht |
| Tone Map | für großen Schirm gedacht |

Die Navigationsleiste scrollt seitwärts, wenn die Tabs nicht nebeneinander
passen.

## Schlagzeug auf Papier

Im Jam Room liest **„Scan paper kit"** ein gemaltes Schlagzeug aus einem
Kamerabild ein.

So funktioniert es: Ein gemaltes Becken ist eine **geschlossene Linie**.
Interessant ist deshalb nicht die Tinte, sondern das **Loch, das sie
umschließt**. MUSE flutet den Hintergrund vom Bildrand her; alles, was
dabei nicht erreicht wird, ist von Tinte umgeben – also eine gemalte Fläche.
Das trägt krumme Kreise, Ovale, Vierecke, was Kinder eben malen, und braucht
kein Modell.

Was hilft:

- **Ganz zumalen.** Eine offene Linie umschließt nichts und wird ignoriert –
  richtigerweise, sonst wäre jeder Kringel ein Becken.
- Dunkler Stift auf hellem Papier. Ungleichmäßiges Licht ist eingeplant, die
  Schwelle wird lokal berechnet.
- **Rückkamera** einschalten (Knopf daneben). Das Papier liegt auf dem Tisch,
  nicht vor dem Gesicht.
- Größe entscheidet die Zuordnung: die größte Fläche wird Kick, dann Snare,
  Hi-Hat, Tom, Clap.

Danach ist jede gemalte Fläche eine Trommelzone in genau der Größe, in der sie
gemalt wurde. Getroffen wird sie mit **Hände** (Handtracking) oder mit dem
Finger auf dem Schirm.

## Song Maker auf dem Handy

Unter **Patterns** gibt es zwei Ansichten derselben Daten: **Grid** und
**Canvas**. Auf einem Handy startet MUSE im Grid – das ist die
Song-Maker-Oberfläche: Zeit nach rechts, Tonhöhe nach oben, antippen setzt
einen Ton, nochmal antippen nimmt ihn weg, seitwärts ziehen hält ihn über
mehrere Schritte.

Das Raster ist tonleitergebunden (Grundton und Dur/Moll oben einstellbar), es
gibt also keinen falschen Ton. Die Erweiterungen bleiben erhalten: mehrere
Instrumentenebenen, freie Pattern-Länge, gehaltene Töne, Hüllkurven pro
Ereignis – die feineren davon über den **…**-Knopf und die Canvas-Ansicht.

### Ebenen wie in Photoshop

Über dem Raster liegt die Ebenenleiste: links das Instrument, rechts eine
Marke je Ebene mit Auge und Farbe.

- **Ein anderes Instrument legt eine neue Ebene an.** Was schon gespielt ist,
  bleibt auf seiner Ebene und behält seinen Klang. Wer zum Klavier zurückgeht,
  landet wieder auf der Klavierebene – es entsteht keine zweite leere.
- **Alle melodischen Ebenen liegen übereinander**, in einem Raster: die Ebene,
  auf der du gerade bist, ist voll deckend, die anderen scheinen durch. So
  spielst du die zweite Stimme gegen die erste, die du noch siehst.
- **Jede Ebene hat ihr eigenes Auge.** Ausblenden nimmt nichts weg – die Töne
  bleiben gespeichert und klingen weiter; sie sind nur nicht im Weg. Eine
  ausgeblendete Ebene, auf die du wieder etwas setzt, taucht von selbst wieder
  auf, damit der neue Ton nicht ins Unsichtbare fällt.
- **Antippen malt immer auf der aktiven Ebene**, auch dort, wo eine andere
  Ebene schon einen Ton hat. Die Marke antippen wechselt die aktive Ebene.

Trommeln bleiben eine Zeile pro Sound – sie haben keine Tonhöhe, überlagern
sich also nicht.

## Klavier und Aufnahme

Unter dem Raster liegt ein Klavier. Am großen Schirm ist es vollständig: sieben
Oktaven, alle Tasten gleichzeitig erreichbar, mit dem Buchstaben der
Computertaste auf jeder Taste. Am Handy sind es zwei Oktaven mit
fingergroßen Tasten und den Knöpfen **−** und **+**, um den Ausschnitt zu
verschieben – der Umfang wird kleiner, das Instrument nicht.

Gespielt wird auf vier Wegen, alle gleichwertig:

- **Maus oder Finger** auf den Tasten. Über die Tasten ziehen spielt sie der
  Reihe nach; wie weit unten die Taste getroffen wird, entscheidet die Lautstärke.
- **Computertastatur.** Die untere Buchstabenreihe ist eine Oktave weiße Tasten,
  die Reihe darüber die schwarzen, ab `Q` dasselbe eine Oktave höher. Die
  Zuordnung hängt an der *physischen* Taste, ist auf QWERTZ also dieselbe
  Handhaltung wie auf QWERTY.
- **MIDI-Keyboard.** Wird angeschlossen und spielt sofort – mit dem Instrument
  der Ebene, in die aufgenommen wird.
- **Ausgedrucktes Tastenfeld**, siehe unten.

Der rote Punkt in der Kopfleiste ist die Aufnahme. Er startet die Schleife, und
alles Gespielte landet in der aktiven Ebene, wahlweise aufs Raster gefangen
(**Snap recording**). Ein Ton, der über das Schleifenende hinaus gehalten wird,
bleibt ein gehaltener Ton; eine Taste, die beim Stoppen noch unten ist, wird
trotzdem zu einem Ton.

**Der wichtigste Teil:** das Raster bleibt die ganze Zeit sichtbar. Verspielt man
sich, tippt man den falschen Ton weg und den richtigen hin – die Aufnahme muss
nicht wiederholt werden. Jeder aufgenommene Ton ist außerdem ein eigener
Undo-Schritt.

## Tastenfeld auf Papier

Neben **Piano** steht **Paper keys**: dieselbe Idee wie beim Schlagzeug, nur für
eine Klaviatur. Ein gemaltes oder ausgedrucktes Tastenfeld wird einmal
eingelesen, danach werden die Hände verfolgt und ein Fingertipp auf eine Taste
spielt sie.

Erkannt wird die **Reihe**: viele geschlossene Kästen nebeneinander, alle etwa
gleich hoch. Ein einzelner Kringel daneben gehört nicht dazu und fällt raus.

Welche Taste C ist, verraten die schwarzen Tasten – aber nicht dadurch, dass
nach schwarzen Flächen gesucht wird (die verschmelzen beim Ausdruck mit den
Linien). Stattdessen verrät es die Form der weißen Tasten selbst: eine Taste,
der oben rechts eine schwarze Taste fehlt, hat rechts weniger Fläche, ihr
Schwerpunkt liegt links. Aus links/mittig/rechts über die Reihe fällt
`C D E` und `F G A B` heraus.

Steht auf dem Papier **keine** schwarze Taste, ist nichts verankert. Dann wird
die linke Taste zu C erklärt – und MUSE sagt das ausdrücklich
(„Oktave nicht sicher"), statt eine geratene Tonart als Tatsache auszugeben.

Was hilft: dunkler Stift auf hellem Papier, Tasten **ganz zumalen** (eine offene
Linie umschließt nichts), **Rückkamera**, und mindestens fünf Tasten.

## Bekannte Grenzen

- **iOS**: Audio startet erst nach einer Berührung – das erste Antippen von
  Play oder einer Trommelzone schaltet den Ton frei. Das ist eine Regel von
  Safari, kein Fehler von MUSE.
- **Handtracking** lädt sein Modell von einem CDN. Ohne Internet bleiben Drums,
  Theremin und Aufnahme nutzbar, das Handtracking nicht.
- **Mehrere Geräte gleichzeitig** spielen nicht zusammen: jedes Handy ist eine
  eigene MUSE-Instanz. Ein gemeinsames Jam über mehrere Geräte gibt es nicht.
- Die Projekte liegen im Browser des jeweiligen Geräts. Zum Weitergeben die
  Datei exportieren.
