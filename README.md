# 🎣 Carnet de Pêche

Application web statique (HTML / CSS / JS) pour enregistrer ses prises sur une carte.

## Fonctionnalités
- Carte OpenStreetMap (Leaflet) centrée sur votre position GPS
- Bouton « J'ai pêché un poisson » → modale de choix du poisson, puis taille, poids, photo, note
- Poisson absent de la liste : option « Autre… » pour créer un nouveau type
- Calques par type de poisson (affichage/masquage, compteur)
- Fonds de carte : **Plan** (OpenStreetMap), **Marine** (OpenStreetMap + balisage OpenSeaMap), **Satellite** (Esri)
- Calques météo en temps réel (Open-Meteo, sans clé API) : **vent** (nœuds), **température de l'air**, **température de l'eau**, **courant marin** (nœuds). Température de l'eau et courant n'existent qu'en mer.
- Données stockées sur l'appareil (localStorage), export/import JSON
- Interface adaptée aux smartphones

## Lancer avec Docker

```bash
docker compose up -d --build
# puis ouvrir http://localhost:8080
```

Sans Compose :

```bash
docker build -t profish2026 .
docker run -d --name carnet-peche -p 8080:80 profish2026
```

> ⚠️ Le GPS des navigateurs exige **HTTPS** (sauf sur `localhost`). Depuis un smartphone, `http://<ip-du-serveur>:8080` n'autorise pas la géolocalisation : placez le conteneur derrière un reverse proxy HTTPS (Caddy, Traefik, nginx…) ou utilisez GitHub Pages.

## Déploiement sur GitHub Pages
1. Settings → Pages → Source : branche `main`, dossier `/ (root)`.
2. Ouvrez `https://<utilisateur>.github.io/<depot>/` sur votre téléphone (HTTPS fourni).

## Notes
- Les photos sont redimensionnées (800 px max) ; le localStorage est limité à ~5 Mo, pensez à exporter régulièrement.
- Les données sont propres au navigateur et à l'origine (URL) utilisés.
