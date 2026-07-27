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
