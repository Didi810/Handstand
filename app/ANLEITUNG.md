# Handstand Battle – Anleitung

## Was ist das?
Eine Web-App, die im Handy-Browser läuft. Sie filmt euch von der Seite, erkennt mit KI (MediaPipe Pose) die Körperpunkte und bewertet jeden Handstand nach festen Regeln. Alles läuft auf dem Handy, es wird nichts hochgeladen.

## Ordner
- `index.html`, `styles.css`: Seite und Aussehen (nach dem Claude-Design v2)
- `js/main.js`: alle Bildschirme und der Battle-Ablauf
- `js/analysis.js`: misst Körperlinie, Beine, Ruhe, Handschritte und erkennt Fehler
- `js/scoring.js`: Punkte-Regeln (Gewichtung, Strenge, Haltezeit 10 s = 100)
- `js/pose.js`: KI-Körpererkennung und Demo-Simulation
- `js/recorder.js`: Videoaufnahme ohne Ton
- `js/store.js`: Speichern (Verlauf im Browser, Favoriten-Videos in IndexedDB)

## Am PC testen
```
python -m http.server 8080 --directory app
```
Danach `http://localhost:8080` öffnen. Mit `http://localhost:8080/?demo` läuft eine Simulation ohne Kamera.

## Aufs Handy
Handys erlauben die Kamera nur über **https**. Den Ordner `app` deshalb auf einen kostenlosen Hoster legen (z. B. GitHub Pages oder Netlify) und den Link auf dem Handy öffnen.
Tipp: Im Browser „Zum Startbildschirm hinzufügen“, dann sieht es aus wie eine echte App.

## Werte anpassen
In den Einstellungen „Messwerte anzeigen“ einschalten. Dann zeigt das Kamerabild die gemessenen Winkel. Die Grenzwerte für Fehler stehen oben in `js/analysis.js` (`ERR`), die Punkte-Formeln in `result()`.
