# 🎣 Carnet de Pêche

Application web statique (HTML / CSS / JS) pour enregistrer ses prises sur une carte.

## Fonctionnalités
- Carte OpenStreetMap (Leaflet) centrée sur votre position GPS
- Votre position est matérialisée par un petit bateau, « Le clown de Brescou », qui se retourne selon votre cap
- Bouton « J'ai pêché un poisson » → modale de choix du poisson, puis taille, poids, photo, note
- Poisson absent de la liste : option « Autre… » pour créer un nouveau type
- Liste de poissons adaptée à la zone : **eau douce** ou **mer / océan** (détection automatique de la position, modifiable à la main). Les poissons personnalisés sont rattachés à la zone où ils sont ajoutés.
- Liste de poissons modifiable : « ✏️ Modifier la liste » dans la fenêtre de prise pour retirer un poisson de la liste proposée (les prises déjà enregistrées sont conservées), « ↩️ Réafficher » pour le remettre.
- Leurre utilisé : type (Maidai, Tenya, Turluttes), couleur et poids en grammes. Pour ajouter un type de leurre, complétez la constante `LURES` dans `app.js`.
- Appât : gambas, calamars ou sardines (options du menu `#f-bait` dans `index.html`)
- Profondeur de la prise : saisie du sondeur, avec suggestion de la profondeur de la carte (EMODnet) quand elle est disponible
- **Conditions enregistrées avec chaque prise** (en arrière-plan) : vent, températures de l'air et de l'eau, courant, pression, marée (montante/descendante, délai depuis la pleine/basse mer) et phase de lune. Les anciennes prises (92 jours max) sont complétées automatiquement ; seule la lune est calculée pour les plus anciennes.
- **Marées & lune** (bouton 🌙) : phase de lune, lever/coucher du soleil, marée en cours, prochaines pleines/basses mers et courbe sur 36 h. Marée très faible détectée en Méditerranée (signalée, horaires non significatifs).
- **Prévisions météo marine sur une date** (bouton 📅) : 8 jours au choix, pour votre position ou le centre de la carte. Résumé du jour (vent, rafales, vagues, air, eau, pluie, pression), tableau heure par heure (vent, rafales, vagues et période, courant, pluie) avec repères de couleur indicatifs, marée du jour, lever/coucher du soleil et lune. Indicatif : ne remplace pas le bulletin Météo-France Marine.
- **Statistiques** (bouton 📊 dans « Mes prises ») : prises par leurre, couleur, poids de leurre, appât, profondeur, moment de la journée, lune, marée, vent et température de l'eau, avec filtre par espèce.
- **Modifier une prise** (✏️ dans la fiche de la carte ou dans « Mes prises ») : tous les champs (poisson, taille, poids, profondeur, leurre, appât, photo, note), la date et l'heure, et la position (choix en touchant la carte). Les conditions météo/marée sont recalculées si la date ou le lieu changent. Une nouvelle prise peut aussi être antidatée.
- Page **Mes prises** (bouton 📋) : toutes les prises de la plus récente à la plus ancienne, groupées par jour, avec détails, coordonnées GPS, copie des coordonnées, ouverture dans Maps, affichage sur la carte et filtre par poisson
- Calques par type de poisson (affichage/masquage, compteur)
- Fonds de carte : **Plan** (OpenStreetMap), **Marine** (OpenStreetMap + balisage OpenSeaMap), **Satellite** (Esri)
- Calques de **profondeur d'eau** (bathymétrie EMODnet : fonds marins en couleurs + isobathes), superposables à n'importe quel fond. Indicatif, ne pas utiliser pour la navigation.
- Calques météo en temps réel (Open-Meteo, sans clé API) : **vent** (nœuds), **température de l'air**, **température de l'eau**, **courant marin** (nœuds). Température de l'eau et courant n'existent qu'en mer.
- **Sauvegarde** (🗂️ → Sauvegarde) : fichier JSON complet (prises avec photos, poissons ajoutés, réglages), partage vers Drive/Fichiers/e-mail depuis le téléphone, restauration avec choix **Fusionner** (recommandé) ou **Remplacer** (une sauvegarde de l'état actuel est téléchargée avant). Rappel (point rouge sur 🗂️) si des prises ne sont pas sauvegardées depuis 7 jours ou dès 5 nouvelles prises. Les anciens fichiers d'export restent compatibles.
- **Mode hors ligne** (PWA) : service worker qui met en cache l'application, les cartes consultées et les dernières prévisions/marées (affichées avec la mention « hors ligne »). « 🗂️ → Hors ligne » : télécharger la carte de la zone affichée (~500 tuiles max, plan ou satellite), vider le cache, installer l'application sur l'écran d'accueil. Nécessite HTTPS (GitHub Pages) ou localhost ; les prises restent enregistrées sur l'appareil.
- Données stockées sur l'appareil (localStorage)
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
- Marées : modèle Open-Meteo d'environ 8 km, indicatif et peu précis près des côtes (ne remplace pas un annuaire des marées). Les coefficients ne sont pas disponibles.
- Hors ligne : le balisage OpenSeaMap et la bathymétrie ne sont mis en cache que s'ils ont été consultés ; les tuiles hors zone téléchargée s'affichent vides.
- Les données sont propres au navigateur et à l'origine (URL) utilisés.
