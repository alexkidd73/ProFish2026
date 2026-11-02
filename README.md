# 🎣 Carnet de Pêche

Application web statique (HTML / CSS / JS) pour enregistrer ses prises sur une carte.

## Fonctionnalités
- Carte OpenStreetMap (Leaflet) centrée sur votre position GPS
- Bouton « J'ai pêché un poisson » → modale de choix du poisson, puis taille, poids, photo, note
- Poisson absent de la liste : option « Autre… » pour créer un nouveau type
- Calques par type de poisson (affichage/masquage, compteur)
- Données stockées sur l'appareil (localStorage), export/import JSON
- Interface adaptée aux smartphones

## Déploiement sur GitHub Pages
1. Créez un dépôt et poussez `index.html`, `style.css`, `app.js`, `README.md`.
2. Settings → Pages → Source : branche `main`, dossier `/ (root)`.
3. Ouvrez `https://<utilisateur>.github.io/<depot>/` sur votre téléphone (HTTPS requis pour le GPS).

## Notes
- Les photos sont redimensionnées (800 px max) ; le localStorage est limité à ~5 Mo, pensez à exporter régulièrement.
