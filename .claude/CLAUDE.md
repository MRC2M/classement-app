# Contexte du projet : classement de la journée sportive

Fichier de reprise : tout ce qu'il faut savoir pour reprendre le projet sans l'historique des conversations.
Langue du projet et des échanges : français. Préférence de l'utilisateur : changer le moins possible ce qui existe déjà.

## À quoi sert l'application

Classement en direct d'une journée sportive, sur téléphone, à la place d'un Google Sheets (un onglet par terrain pour les arbitres, plus MATCHS et CLASSEMENT).
Deux activités en parallèle, une instance chacune (scores et codes séparés, même code source) :

- **FitFive** (FitFive Laeken) : jeux du matin et tournoi de l'après-midi.
- **VUB** : tournoi de l'après-midi seulement.

La journée a eu lieu début novembre 2026. L'application a ensuite été retirée du serveur le 5 novembre 2026. Les résultats finaux sont dans `resultats/`.

## Règles

**Tournoi de l'après-midi (FitFive et VUB)**
- 12 équipes, 6 terrains, 5 créneaux de 10 min (13h00 → 14h10), soit 30 matchs de poule ; chaque équipe joue 5 matchs.
- Programme : constante `PROG` dans `public/index.html` (identique au fichier Excel d'origine).
- Barème : victoire 3, nul 1, défaite 0. Départage : points, puis différence de buts, puis buts marqués. Égalité parfaite : ordre provisoire par numéro d'équipe, signalé par « = », et l'organisateur tranche en confirmant les demi-finalistes.
- Phase finale : demi-finales à 14h15 (1er vs 4e, 2e vs 3e), finale à 14h30, débriefing à 14h45. À 14h10, l'organisateur confirme les 4 demi-finalistes (alerte dans l'onglet Finales). En cas de nul en finale, il choisit le vainqueur.

**Jeux du matin (FitFive seulement, variable `JEUX=1`)**
- 6 créneaux de 20 min (10h00 → 12h00), 36 jeux. Chaque terrain a son activité : 1 Basketball, 2 Uni-hockey, 3 Dodgeball, 4 Tennisfoot, 5 Flag football, 6 Volley-ball.
- Programme : constante `J_PROG` (tirée de l'affiche « Programme des matches »). Elle a été vérifiée : chaque équipe joue 6 fois, une fois par activité, et aucune affiche n'est en double.
- Pas de score : victoire, nul ou défaite (3 / 1 / 0). Pas de départage : même rang à égalité de points. Pas de phase finale. Classement indépendant du tournoi.

## Architecture

- `server.js` : Node 18+, **aucune dépendance**. Les données sont dans `data/state.json` (ou `DATA_FILE`), avec une écriture atomique (fichier tmp puis rename).
  - Format : `{ scores: { m1..m30, sf1, sf2, fin: {a, b, w?} }, semis?: [4 numéros d'équipe], jeux?: { j1..j36: 'a'|'n'|'b' } }`.
  - Routes : `GET /api/state` et `GET /api/events` (direct en SSE, ping toutes les 25 s). En écriture : `POST /api/auth`, `/api/score`, `/api/semis`, `/api/jeu` (si `JEUX=1`) et `/api/reset` (body `{part: 'jeux'|'tournoi'}`, sans `part` tout est effacé).
  - Pour écrire, il faut le code dans l'en-tête `x-pin`. `ORGA_PIN` donne la saisie. `ADMIN_PIN` donne la même chose, et il est le seul à pouvoir remettre à zéro (sinon le serveur répond 403). Sans `ADMIN_PIN`, le code organisateur suffit.
  - Anti-force brute : 20 échecs en 2 min par IP bloquent pendant 2 min (réponse 429). Le blocage est volontairement court, parce que tout le wifi de la salle partage la même IP. L'IP utilisée est celle de la connexion, et `X-Forwarded-For` n'est lu que si `TRUST_PROXY=1`.
  - `TITRE` : remplace `__TITRE__` dans la page. `JEUX` : remplace `__JEUX__`.
- `public/index.html` : une seule page mobile (testée en 360 px), avec du JS sans framework.
  - Style de la fiche Fit Five : bleu marine #12274A, jaune #F5C230, cadre bleu, cartes blanches, police Barlow Condensed (Google Fonts).
  - Onglets : Classement, Matchs (filtre « Terrain n » pour les arbitres, compteur x/5 ou x/6, « à encoder ») et Finales. Le sélecteur « Jeux · matin / Tournoi · après-midi » s'affiche si `JEUX=1`. Il ouvre les jeux avant 12h30 et le tournoi ensuite.
  - Le bouton « Organisateur » demande le code, qui est gardé dans localStorage. Il affiche « Orga ✓ », ou « Admin ✓ » avec le code admin. Le bouton de remise à zéro n'apparaît qu'en admin, et il n'efface que la partie affichée.
  - Une sauvegarde CSV, lisible dans Excel, contient le tournoi et les jeux.
- `Dockerfile` (node:22-alpine, utilisateur node, données dans `/data`) et `docker-compose.yml` : services `classement` (FitFive, port 8090, `.env`, `JEUX=1`) et `vub` (port 8091, `.env.vub`).

## Déploiement (historique et pour recommencer)

Le serveur Hetzner est `root@167.233.116.27` (Ubuntu 26.04). On y accède en SSH avec `~/.ssh/id_ed25519`. Node n'est pas installé : tout passe par Docker.

**Les autres apps du serveur, à ne pas toucher**
- Code F2M (`/opt/code-f2m`) : son Caddy tient les ports 80 et 443 (`code.cf2m.be`, plus l'accès par l'IP sur le port 80).
- Dialogues NL (`/root/dialogues-nl`) : son Caddy est sur le port 8080, avec un basic_auth.
- reunion-bot (`/opt/reunion-bot`).

**Choix faits**
- Pas de domaine : l'utilisateur n'a pas accès au DNS de cf2m.be. Les apps étaient donc servies en HTTP simple par l'IP : FitFive sur http://167.233.116.27:8090 et VUB sur http://167.233.116.27:8091.
- Les ports sont publiés par Docker. Attention : Docker contourne ufw.
- Pour avoir un jour du HTTPS : ajouter un bloc au Caddyfile de code-f2m, sans installer de second proxy.

**Pour redéployer**
```bash
rsync -a --exclude data --exclude '.env*' --exclude .git ./ root@167.233.116.27:/opt/classement/
ssh root@167.233.116.27
cd /opt/classement
umask 077
echo "ORGA_PIN=$(shuf -i 100000-999999 -n1)" > .env
echo "ORGA_PIN=$(shuf -i 100000-999999 -n1)" > .env.vub
A=$(shuf -i 10000000-99999999 -n1)
echo "ADMIN_PIN=$A" >> .env
echo "ADMIN_PIN=$A" >> .env.vub
docker compose up -d --build
```
Les codes ne sont jamais dans git (`.gitignore`). Pour les lire : `cat /opt/classement/.env /opt/classement/.env.vub`.
Pour repartir des résultats sauvegardés, copier `resultats/<instance>.json` dans `/data/state.json` du conteneur, ou utiliser `DATA_FILE`.

**Retrait du serveur (fait le 5 novembre 2026)**
- Commande : `docker compose down -v --rmi local` puis `rm -rf /opt/classement`.
- Avant le retrait, les données ont été copiées dans `resultats/`. Le cache de build Docker du serveur a aussi été vidé.

## Résultats sauvegardés (`resultats/`)

- `classement.json` (FitFive) : 30 scores du tournoi et 36 jeux. Les demi-finalistes n'ont pas été confirmés dans l'app, donc il n'y a ni demi-finales ni finale.
- `vub.json` : 5 scores du tournoi seulement.

## Dépôt

- https://github.com/MRC2M/classement-app, branche `main`. Le dépôt est **public** : ne jamais y mettre de code d'accès.
- Identité git locale : MRC2M.

## Idées non réalisées

- Un code par arbitre, limité à son terrain.
- Un écran à projeter (classement en grand).
- Des noms d'équipes à la place des numéros.
- Du HTTPS (via un domaine, ou via le Caddy existant).
