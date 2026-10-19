# Agenda: guida

PWA personale per iPhone. Frontend in `docs/` (pubblicato da GitHub Pages), Worker per le notifiche in `worker/`.
Dati solo sul telefono (localStorage). Il Worker conserva solo subscription push e orari.

## Struttura
- `docs/`: app (index.html, app.css, app.js, config.js, sw.js, manifest.json, icone/)
- `worker/`: Cloudflare Worker (src/index.js, src/push.js, wrangler.toml, vapid.js)
- `strumenti/server.js`: prova in locale, `node strumenti/server.js` → http://127.0.0.1:4190
- `strumenti/prova-push.mjs`: test di cifratura, firma VAPID e orari; con `--worker <url>` prova completa contro `wrangler dev`
- `strumenti/icone.js`: rigenera le icone

## Messa online (PowerShell, una volta sola)
Nei comandi si usa `npx.cmd` invece di `npx`, perché PowerShell spesso blocca gli script `.ps1`.

1. Account Cloudflare (gratis) su dash.cloudflare.com, poi:
   cd C:\Users\thetr\lavoro\agenda\worker
   npx.cmd wrangler login
2. Archivio KV:
   npx.cmd wrangler kv namespace create AGENDA
   Copia l'`id` che stampa al posto di `INSERISCI_ID_KV` in `wrangler.toml`.
3. Pubblica il Worker:
   npx.cmd wrangler deploy
   Prendi nota dell'indirizzo `https://agenda-notifiche.<tuo-sottodominio>.workers.dev`.
4. Chiave VAPID (la privata va direttamente a Cloudflare, nessun file):
   node vapid.js | npx.cmd wrangler secret put VAPID_PRIVATE_JWK
   Controllo: Invoke-RestMethod https://agenda-notifiche.<...>.workers.dev/vapid
5. Indirizzo del Worker nell'app: in `docs/config.js` metti `worker: 'https://agenda-notifiche.<...>.workers.dev'`.
6. GitHub: crea un repository pubblico vuoto `agenda` su github.com, poi:
   cd C:\Users\thetr\lavoro\agenda
   git init -b main
   git add .
   git commit -m "Agenda PWA"
   git remote add origin https://github.com/<utente>/agenda.git
   git push -u origin main
   Su GitHub: Settings → Pages → Branch `main`, cartella `/docs` → Save.
   L'app sarà su https://<utente>.github.io/agenda/
7. Restringi il Worker alla tua app: in `wrangler.toml` metti `ALLOWED_ORIGIN = "https://<utente>.github.io"`, poi `npx.cmd wrangler deploy`.

## iPhone
Safari → https://<utente>.github.io/agenda/ → Condividi → Aggiungi alla schermata Home → apri l'app dall'icona →
⚙︎ → Attiva notifiche → Consenti → Invia notifica di prova.

## Aggiornare l'app
Modifica i file in `docs/`, poi `git add . ; git commit -m "..." ; git push`. Dopo una modifica cambia `CACHE` in `docs/sw.js`
(es. `agenda-v3`): l'iPhone prende la versione nuova alla seconda apertura.

## Problemi
- Log del Worker in diretta: `npx.cmd wrangler tail`
- `BadJwtToken` da Apple: in `wrangler.toml` metti in `VAPID_SUBJECT` una tua mail (`mailto:...`) o `https://<utente>.github.io`, poi deploy.
- Cambiare la chiave VAPID annulla le iscrizioni: sull'iPhone serve di nuovo "Attiva notifiche".
- Limiti gratuiti: cron ogni minuto ≈ 1.440 letture KV al giorno su 100.000; scritture solo quando cambia qualcosa (limite 1.000 al giorno).
