# Classement de la journée sportive

Application sans dépendance : Node 18+ suffit.

## Lancer

```bash
ORGA_PIN=choisis-un-code node server.js
```

- Joueurs : ouvrir l'adresse du serveur (lecture seule, mise à jour en direct).
- Organisateurs : bouton « Organisateur » en haut, puis le code (`ORGA_PIN`). Les scores se saisissent dans l'onglet Matchs et Finales.
- Les scores sont enregistrés dans `data/state.json`.
- Variables : `PORT` (3000 par défaut), `DATA_FILE`.

## Ce qui remplace le fichier Excel

| Excel | Application |
|---|---|
| Onglets TERRAIN 1 à 6 (saisie arbitre, « x / 5 validés ») | Onglet Matchs, filtre « Terrain n » : cases jaunes, compteur x / 5 |
| Onglet MATCHS (30 matchs, « x / 30 ») | Onglet Matchs, « Tous les matchs », matchs non saisis signalés « à encoder » |
| Onglet CLASSEMENT (MJ, V, N, D, BP, BC, Diff., Pts, Top 4) | Onglet Classement, mêmes colonnes et même départage |
| Égalité parfaite « à arbitrer par l'organisateur » | Signalée par « = » ; l'organisateur fixe l'ordre en confirmant les demi-finalistes |
| « À 14h10, vérifie les 30 scores avant de confirmer » | Onglet Finales : bouton « Confirmer les demi-finalistes » (alerte à 14h10) |
| « Prévoir une copie de sauvegarde » | Bouton « Sauvegarde (CSV) », ouvrable dans Excel |
| Tout le monde éditeur, pas d'accès sécurisé | Lecture seule pour tous, saisie avec le code organisateur |

En plus : demi-finales, finale et vainqueur, mise à jour en direct sur tous les téléphones.

## Sur le serveur Hetzner (déployé)

Deux classements indépendants (scores et codes séparés), même code, titre réglé par la variable `TITRE` :

| Activité | Adresse | Code organisateur |
|---|---|---|
| FitFive | **http://167.233.116.27:8090** | `/opt/classement/.env` |
| VUB | **http://167.233.116.27:8091** | `/opt/classement/.env.vub` |

FitFive a aussi les **jeux du matin** (`JEUX=1`) : 36 jeux de 10h00 à 12h00, une activité par terrain (basketball, uni-hockey, dodgeball, tennisfoot, flag football, volley-ball). Résultat sans score (victoire / nul / défaite, 3-1-0), sans départage ni phase finale, classement indépendant du tournoi. Le sélecteur « Jeux · matin / Tournoi · après-midi » s'ouvre sur les jeux avant 12h30, sur le tournoi ensuite ; la remise à zéro n'efface que la partie affichée.

HTTP simple par l'IP : le port 80 sert déjà Code F2M, le 8080 Dialogues NL.

- Dossier : `/opt/classement`, lancé avec Docker Compose (`Dockerfile`, `docker-compose.yml`).
- Codes organisateur : fichiers `.env` et `.env.vub` (`ORGA_PIN=...`), lisibles seulement par root.
- Scores : volumes Docker `classement_classement_data` et `classement_vub_data` (`/data/state.json` dans chaque conteneur), conservés aux redémarrages et mises à jour.

```bash
# voir les codes organisateur
ssh root@167.233.116.27 cat /opt/classement/.env /opt/classement/.env.vub
# mettre à jour après une modification locale
rsync -a --exclude data --exclude '.env*' ./ root@167.233.116.27:/opt/classement/
ssh root@167.233.116.27 'cd /opt/classement && docker compose up -d --build'
# journaux
ssh root@167.233.116.27 'cd /opt/classement && docker compose logs --tail 50'
```

Code administrateur (`ADMIN_PIN`, le même dans `.env` et `.env.vub`) : il fait tout ce que fait le code organisateur, et il est le seul à pouvoir remettre à zéro. Le bouton s'affiche seulement si on s'est connecté avec ce code (« Admin ✓ »). Sans `ADMIN_PIN`, le code organisateur suffit.

Sécurité du code : après 20 mauvais codes en 2 minutes depuis une même IP, les essais sont refusés pendant 2 minutes (court, car tout le wifi de la salle partage la même IP). En HTTP, le code circule en clair : à changer après la journée.
Derrière un reverse proxy, mettre `TRUST_PROXY=1` pour lire l'IP dans `X-Forwarded-For`.

Avant la journée : tester, puis « Tout remettre à zéro » en mode organisateur.

## Résultats de la journée

`resultats/classement.json` (FitFive : tournoi et jeux du matin) et `resultats/vub.json` : état final récupéré sur le serveur avant de le retirer. Pour rejouer une instance avec ces données, copier le fichier en `data/state.json` (ou `DATA_FILE=resultats/vub.json`).
