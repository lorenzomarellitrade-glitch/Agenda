'use strict';

const CHIAVE = 'agenda-v2';
const FUSO = 'Europe/Rome';
const WORKER = ((window.AGENDA_CONFIG && window.AGENDA_CONFIG.worker) || '').replace(/\/+$/, '');
const $ = (id) => document.getElementById(id);

const STATI = [
  { id: 'nuova', nome: 'Nuova' },
  { id: 'valutare', nome: 'Da valutare' },
  { id: 'realizzare', nome: 'Realizzare' },
  { id: 'scartata', nome: 'Scartata' },
];
const ORDINE_STATI = { nuova: 0, valutare: 1, realizzare: 2, scartata: 3 };

// ---------- Date (sempre ora di Roma) ----------
function dataDi(d) {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-GB', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d)) p[x.type] = x.value;
  return `${p.year}-${p.month}-${p.day}`;
}
const oggi = () => dataDi(new Date());
function spostaGiorni(data, n) {
  const d = new Date(data + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const domani = () => spostaGiorni(oggi(), 1);
const giornoUTC = (data) => new Date(data + 'T12:00:00Z');
const fmtGiorno = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const fmtBreve = new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const fmtNota = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: FUSO });
function nomeGiorno(data) {
  if (data === oggi()) return 'oggi';
  if (data === domani()) return 'domani';
  return fmtGiorno.format(giornoUTC(data));
}

// ---------- Dati ----------
const nuovoId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
const vuoto = () => ({
  versione: 2,
  aree: ['Trading', 'IB', 'Investimenti', 'Personale'].map((nome, i) => ({ id: 'a' + (i + 1), nome })),
  routine: [],
  routineFatte: { data: '', ids: [] },
  task: [],
  idee: [],
  note: [],
  revisione: { attiva: true, ora: '20:00' },
});

function carica() {
  try {
    const d = JSON.parse(localStorage.getItem(CHIAVE));
    if (d && d.versione === 2) return Object.assign(vuoto(), d);
  } catch (e) { /* dati assenti o rovinati: si riparte vuoti */ }
  return vuoto();
}
let S = carica();

function salva() {
  try { localStorage.setItem(CHIAVE, JSON.stringify(S)); } catch (e) { avviso('Salvataggio non riuscito'); }
  disegna();
  pianificaSync();
}

const routineFatteOggi = () => (S.routineFatte.data === oggi() ? S.routineFatte.ids : []);
const nomeArea = (id) => { const a = S.aree.find((x) => x.id === id); return a ? a.nome : ''; };

// ---------- Utilità di disegno ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const spunta = (azione) => `<button class="spunta" data-azione="${azione}" aria-label="Spunta"><i><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></i></button>`;
const tag = (area) => (nomeArea(area) ? `<span class="tag">${esc(nomeArea(area))}</span>` : '');
const perOra = (a, b) => (a.ora || '99:99').localeCompare(b.ora || '99:99') || (a.creata || 0) - (b.creata || 0);
const contiene = (testo, cerca) => !cerca || testo.toLowerCase().includes(cerca);

function rigaTask(t, extra = '') {
  const sotto = [tag(t.area), extra].filter(Boolean).join('');
  return `<li class="voce${t.fatta ? ' fatta' : ''}" data-id="${t.id}">
    ${spunta('spunta-task')}
    <span class="testo" data-azione="modifica-task">${esc(t.testo)}${sotto ? `<span class="sotto">${sotto}</span>` : ''}</span>
    ${t.ora ? `<span class="ora mono">${t.ora}</span>` : ''}
    <button class="btn-riga" data-azione="elimina-task" aria-label="Elimina">×</button></li>`;
}

function disegnaOggi() {
  const g = oggi();
  const fatte = routineFatteOggi();
  $('lista-routine-oggi').innerHTML = S.routine.length
    ? S.routine.map((r) => `<li class="voce${fatte.includes(r.id) ? ' fatta' : ''}" data-id="${r.id}">
        ${spunta('spunta-routine')}<span class="testo" data-azione="spunta-routine">${esc(r.testo)}${r.area ? `<span class="sotto">${tag(r.area)}</span>` : ''}</span>
        ${r.ora ? `<span class="ora mono">${r.ora}</span>` : ''}</li>`).join('')
    : '<li class="vuota">Nessuna routine. Aggiungila dalla scheda Routine.</li>';
  $('routine-conto').textContent = S.routine.length ? `${S.routine.filter((r) => fatte.includes(r.id)).length}/${S.routine.length}` : '';

  const task = S.task.filter((t) => t.data === g).sort(perOra);
  $('lista-task').innerHTML = task.length ? task.map((t) => rigaTask(t)).join('') : '<li class="vuota">Nessuna task per oggi. Usa il + per aggiungerne.</li>';
  $('task-conto').textContent = task.length ? `${task.filter((t) => t.fatta).length}/${task.length}` : '';

  const ieri = spostaGiorni(g, -1);
  const indietro = S.task.filter((t) => t.data && t.data < g && !t.fatta).sort((a, b) => b.data.localeCompare(a.data) || perOra(a, b));
  $('sezione-ieri').hidden = !indietro.length;
  $('lista-ieri').innerHTML = indietro.map((t) => `<li class="voce" data-id="${t.id}">
      <span class="testo" data-azione="modifica-task">${esc(t.testo)}<span class="sotto">${tag(t.area)}${t.data !== ieri ? `<span class="mono">${fmtBreve.format(giornoUTC(t.data))}</span>` : ''}</span></span>
      <button class="btn-riga testo-btn" data-azione="porta-task">Porta a oggi</button>
      <button class="btn-riga" data-azione="elimina-task" aria-label="Elimina">×</button></li>`).join('');

  const prossime = S.task.filter((t) => t.data > g && !t.fatta).sort((a, b) => a.data.localeCompare(b.data) || perOra(a, b));
  $('sezione-prossimi').hidden = !prossime.length;
  let html = '';
  let giorno = '';
  for (const t of prossime) {
    if (t.data !== giorno) {
      if (giorno) html += '</ul>';
      giorno = t.data;
      html += `<p class="gruppo-data">${esc(nomeGiorno(t.data))}</p><ul class="lista">`;
    }
    html += rigaTask(t);
  }
  $('lista-prossimi').innerHTML = html + (giorno ? '</ul>' : '');
}

const filtri = { tipo: 'tutte', stato: '', area: '', cerca: '' };

function disegnaInbox() {
  const cerca = filtri.cerca.trim().toLowerCase();
  const voArea = (v) => !filtri.area || (filtri.area === '-' ? !v.area : v.area === filtri.area);
  const voStato = (v) => !filtri.stato || (filtri.stato === 'revisione' ? ['nuova', 'valutare'].includes(v.stato) : v.stato === filtri.stato);
  const task = filtri.tipo === 'idea' || filtri.stato ? [] : S.task.filter((t) => !t.data && voArea(t) && contiene(t.testo, cerca)).map((t) => ({ ...t, genere: 'task' }));
  const idee = filtri.tipo === 'task' ? [] : S.idee.filter((i) => voStato(i) && voArea(i) && contiene(i.testo, cerca)).map((i) => ({ ...i, genere: 'idea' }));
  const peso = (v) => (v.genere === 'task' ? (v.fatta ? 3 : 0) : v.stato === 'scartata' ? 4 : 1);
  const voci = [...task, ...idee].sort((a, b) => peso(a) - peso(b) || b.creata - a.creata);

  $('lista-inbox').innerHTML = voci.length
    ? voci.map((v) => (v.genere === 'task' ? `<li class="voce-inbox" data-id="${v.id}">
          <div class="voce${v.fatta ? ' fatta' : ''}">
            ${spunta('spunta-task')}
            <span class="testo" data-azione="modifica-task">${esc(v.testo)}${v.area ? `<span class="sotto">${tag(v.area)}</span>` : ''}</span>
            <span class="tipo">Task</span>
          </div>
          <div class="azioni-voce">
            <button data-azione="porta-task">Porta a oggi</button>
            <button data-azione="pianifica-task">Pianifica</button>
            <button data-azione="elimina-task" class="pericolo">Elimina</button>
          </div></li>`
      : `<li class="voce-inbox${v.stato === 'scartata' ? ' scartata' : ''}" data-id="${v.id}">
          <div class="voce${v.stato === 'scartata' ? ' scartata' : ''}">
            <span class="testo" data-azione="modifica-idea">${esc(v.testo)}${v.area ? `<span class="sotto">${tag(v.area)}</span>` : ''}</span>
            <span class="tipo">Idea</span>
          </div>
          <div class="stati">${STATI.map((s) => `<button data-azione="stato-idea" data-stato="${s.id}" class="${s.id}${v.stato === s.id ? ' attivo' : ''}">${s.nome}</button>`).join('')}</div>
          <div class="azioni-voce">
            <button data-azione="idea-task">In task</button>
            <button data-azione="idea-nota">Trasforma in nota</button>
            <button data-azione="elimina-idea" class="pericolo">Elimina</button>
          </div></li>`)).join('')
    : `<li class="vuota">${S.task.some((t) => !t.data) || S.idee.length ? 'Niente con questi filtri.' : 'Inbox vuota. Usa il + per catturare un\'idea o una cosa da fare.'}</li>`;
}

function disegnaFiltroAree() {
  const sel = $('filtro-area');
  sel.innerHTML = '<option value="">Tutte le aree</option>' + S.aree.map((a) => `<option value="${a.id}">${esc(a.nome)}</option>`).join('') + '<option value="-">Senza area</option>';
  if (![...sel.options].some((o) => o.value === filtri.area)) filtri.area = '';
  sel.value = filtri.area;
}

function disegnaRoutine() {
  const n = S.routine.length;
  $('lista-routine').innerHTML = n
    ? S.routine.map((r, i) => `<li class="voce" data-id="${r.id}">
        <span class="testo" data-azione="modifica-routine">${esc(r.testo)}${r.area ? `<span class="sotto">${tag(r.area)}</span>` : ''}</span>
        <span class="ora mono">${r.ora || '—'}</span>
        <button class="btn-riga" data-azione="su" aria-label="Sposta su"${i === 0 ? ' disabled' : ''}>↑</button>
        <button class="btn-riga" data-azione="giu" aria-label="Sposta giù"${i === n - 1 ? ' disabled' : ''}>↓</button></li>`).join('')
    : '<li class="vuota">Nessuna voce. Aggiungi la prima qui sopra.</li>';
}

let cercaNote = '';
function disegnaNote() {
  const c = cercaNote.trim().toLowerCase();
  const note = S.note.filter((n) => contiene(n.titolo + '\n' + n.testo, c)).sort((a, b) => b.modificata - a.modificata);
  $('lista-note').innerHTML = note.length
    ? note.map((n) => {
      const riga = n.testo.trim().split('\n').find(Boolean) || '';
      return `<li><button class="voce-nota" data-azione="apri-nota" data-id="${n.id}">
        <span class="anteprima">${esc(n.titolo || riga || 'Senza titolo')}</span>
        ${n.titolo && riga && riga !== n.titolo ? `<span class="seconda">${esc(riga)}</span>` : ''}
        <span class="sotto">${tag(n.area)}${fmtNota.format(new Date(n.modificata))}</span></button></li>`;
    }).join('')
    : `<li class="vuota">${S.note.length ? 'Nessun appunto trovato.' : 'Nessun appunto.'}</li>`;
}

let vista = 'oggi';
const TITOLI = { oggi: 'Oggi', inbox: 'Inbox', routine: 'Routine', appunti: 'Appunti' };
let giornoDisegnato = '';

function disegna() {
  giornoDisegnato = oggi();
  $('sottotitolo').textContent = fmtGiorno.format(giornoUTC(giornoDisegnato));
  disegnaOggi();
  disegnaFiltroAree();
  disegnaInbox();
  disegnaRoutine();
  disegnaNote();
  if ($('foglio-impostazioni').open) disegnaAree();
}

function mostraVista(v) {
  vista = v;
  document.querySelectorAll('.vista').forEach((el) => el.classList.toggle('attiva', el.id === 'vista-' + v));
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('attivo', b.dataset.vista === v));
  $('titolo').textContent = TITOLI[v];
  window.scrollTo(0, 0);
  try { localStorage.setItem('agenda-vista', v); } catch (e) { /* non importante */ }
}

function impostaFiltri(nuovi) {
  Object.assign(filtri, nuovi);
  $('inbox-tipo').querySelectorAll('button').forEach((b) => b.classList.toggle('attivo', b.dataset.tipo === filtri.tipo));
  $('filtro-stato').value = filtri.stato;
  $('filtro-stato').disabled = filtri.tipo === 'task';
  $('filtro-area').value = filtri.area;
  $('inbox-cerca').value = filtri.cerca;
  disegnaInbox();
}

// ---------- Avviso con annulla ----------
let timerAvviso;
let ripristino = null;
function avviso(testo, annullabile = false) {
  $('avviso-testo').textContent = testo;
  $('avviso-annulla').hidden = !annullabile;
  $('avviso').classList.add('visibile');
  clearTimeout(timerAvviso);
  timerAvviso = setTimeout(() => { $('avviso').classList.remove('visibile'); ripristino = null; }, annullabile ? 5000 : 2500);
}
function conAnnulla(testo, cambia) {
  ripristino = JSON.stringify(S);
  cambia();
  salva();
  avviso(testo, true);
}
$('avviso-annulla').addEventListener('click', () => {
  if (!ripristino) return;
  S = JSON.parse(ripristino);
  ripristino = null;
  salva();
  $('avviso').classList.remove('visibile');
});

// ---------- Foglio voce: cattura rapida e modifica ----------
// modo: 'nuova' (task o idea), 'task', 'idea', 'routine'
let foglio = null;

function chipsAree(contenitore, scelta) {
  contenitore.innerHTML = ['<button type="button" data-area="">Nessuna</button>', ...S.aree.map((a) => `<button type="button" data-area="${a.id}">${esc(a.nome)}</button>`)].join('');
  contenitore.querySelectorAll('button').forEach((b) => b.classList.toggle('attivo', b.dataset.area === (scelta || '')));
}

function aggiornaFoglio() {
  const f = foglio;
  const conData = f.modo === 'task' || (f.modo === 'nuova' && f.tipo === 'task');
  $('voce-tipo').hidden = f.modo !== 'nuova';
  $('voce-tipo').querySelectorAll('button').forEach((b) => b.classList.toggle('attivo', b.dataset.tipo === f.tipo));
  $('voce-riga-data').hidden = !conData;
  $('voce-riga-ora').hidden = !(conData || f.modo === 'routine');
  $('voce-riga-stato').hidden = f.modo !== 'idea';
  chipsAree($('voce-aree'), f.area);
  const g = oggi();
  const d = domani();
  $('voce-date').querySelectorAll('button').forEach((b) => {
    const valore = b.dataset.data === 'oggi' ? g : b.dataset.data === 'domani' ? d : '';
    b.classList.toggle('attivo', valore === f.data);
  });
  const altra = f.data && f.data !== g && f.data !== d;
  $('voce-data').value = altra ? f.data : '';
  $('voce-data').classList.toggle('attivo', altra);
  $('voce-stati').innerHTML = STATI.map((s) => `<button type="button" data-stato="${s.id}" class="${s.id}${f.stato === s.id ? ' attivo' : ''}">${s.nome}</button>`).join('');
  $('voce-testo').placeholder = f.modo === 'nuova' && f.tipo === 'idea' ? "Scrivi l'idea" : 'Cosa ti serve ricordare?';
}

function apriVoce(opzioni) {
  foglio = { tipo: 'task', area: '', data: '', ora: '', stato: 'nuova', testo: '', ...opzioni };
  $('voce-titolo').textContent = foglio.titolo;
  $('voce-testo').value = foglio.testo;
  $('voce-ora').value = foglio.ora;
  $('voce-elimina').hidden = !foglio.elimina;
  aggiornaFoglio();
  $('foglio-voce').showModal();
  if (foglio.modo === 'nuova') $('voce-testo').focus();
}

$('voce-tipo').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tipo]');
  if (b) { foglio.tipo = b.dataset.tipo; aggiornaFoglio(); }
});
$('voce-aree').addEventListener('click', (e) => {
  const b = e.target.closest('[data-area]');
  if (b) { foglio.area = b.dataset.area; aggiornaFoglio(); }
});
$('voce-date').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-data]');
  if (!b) return;
  foglio.data = b.dataset.data === 'oggi' ? oggi() : b.dataset.data === 'domani' ? domani() : '';
  aggiornaFoglio();
});
$('voce-data').addEventListener('change', () => { foglio.data = $('voce-data').value; aggiornaFoglio(); });
$('voce-stati').addEventListener('click', (e) => {
  const b = e.target.closest('[data-stato]');
  if (b) { foglio.stato = b.dataset.stato; aggiornaFoglio(); }
});
$('voce-togli-ora').addEventListener('click', () => { $('voce-ora').value = ''; });
$('voce-annulla').addEventListener('click', () => $('foglio-voce').close());
$('voce-elimina').addEventListener('click', () => { $('foglio-voce').close(); foglio.elimina(); });
$('form-voce').addEventListener('submit', (e) => {
  e.preventDefault();
  const testo = $('voce-testo').value.trim();
  if (!testo) return $('voce-testo').focus();
  const valori = { testo, tipo: foglio.tipo, area: foglio.area, data: foglio.data, ora: $('voce-ora').value, stato: foglio.stato };
  // Un orario senza data vale per oggi.
  if (valori.ora && !valori.data && (foglio.modo === 'task' || (foglio.modo === 'nuova' && valori.tipo === 'task'))) valori.data = oggi();
  $('foglio-voce').close();
  foglio.salva(valori);
});

function dove(t) {
  if (!t.data) return 'Salvata in Inbox';
  if (t.data === oggi()) return 'Aggiunta a oggi';
  return 'Pianificata per ' + nomeGiorno(t.data);
}

function cattura() {
  apriVoce({
    modo: 'nuova', titolo: 'Cattura rapida', data: vista === 'oggi' ? oggi() : '',
    salva: (v) => {
      if (v.tipo === 'idea') {
        S.idee.push({ id: nuovoId(), testo: v.testo, area: v.area, stato: 'nuova', creata: Date.now() });
        salva();
        avviso('Idea salvata in Inbox');
      } else {
        const t = { id: nuovoId(), testo: v.testo, area: v.area, data: v.data, ora: v.ora, fatta: false, creata: Date.now() };
        S.task.push(t);
        salva();
        avviso(dove(t));
      }
    },
  });
}
$('fab').addEventListener('click', cattura);

function trasformaInTask(idea) {
  apriVoce({
    modo: 'task', titolo: 'Trasforma in task', testo: idea.testo, area: idea.area, data: oggi(),
    salva: (v) => {
      const t = { id: nuovoId(), testo: v.testo, area: v.area, data: v.data, ora: v.ora, fatta: false, creata: Date.now() };
      S.task.push(t);
      togli('idee', idea.id);
      salva();
      avviso('Idea trasformata: ' + dove(t).toLowerCase());
    },
  });
}

// ---------- Azioni sulle liste ----------
const trova = (lista, id) => lista.find((x) => x.id === id);
function togli(nome, id) { S[nome] = S[nome].filter((x) => x.id !== id); }

function modificaTask(t, titolo = 'Task', data = t.data) {
  apriVoce({
    modo: 'task', titolo, testo: t.testo, area: t.area, data, ora: t.ora,
    salva: (v) => { Object.assign(t, { testo: v.testo, area: v.area, data: v.data, ora: v.ora }); salva(); },
    elimina: () => AZIONI['elimina-task'](t.id),
  });
}

const AZIONI = {
  'spunta-routine'(id) {
    const g = oggi();
    if (S.routineFatte.data !== g) S.routineFatte = { data: g, ids: [] };
    const ids = S.routineFatte.ids;
    S.routineFatte.ids = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
    salva();
  },
  'spunta-task'(id) { const t = trova(S.task, id); t.fatta = !t.fatta; salva(); },
  'modifica-task'(id) { modificaTask(trova(S.task, id)); },
  'pianifica-task'(id) { modificaTask(trova(S.task, id), 'Pianifica', domani()); },
  'elimina-task'(id) { conAnnulla('Task eliminata', () => togli('task', id)); },
  'porta-task'(id) { trova(S.task, id).data = oggi(); salva(); avviso('Portata a oggi'); },
  'porta-tutte'() {
    const g = oggi();
    S.task.forEach((t) => { if (t.data && t.data < g && !t.fatta) t.data = g; });
    salva();
  },

  'stato-idea'(id, el) {
    const idea = trova(S.idee, id);
    idea.stato = el.dataset.stato;
    salva();
    if (idea.stato === 'realizzare') trasformaInTask(idea);
  },
  'modifica-idea'(id) {
    const idea = trova(S.idee, id);
    apriVoce({
      modo: 'idea', titolo: 'Idea', testo: idea.testo, area: idea.area, stato: idea.stato,
      salva: (v) => {
        const prima = idea.stato;
        Object.assign(idea, { testo: v.testo, area: v.area, stato: v.stato });
        salva();
        if (idea.stato === 'realizzare' && prima !== 'realizzare') trasformaInTask(idea);
      },
      elimina: () => AZIONI['elimina-idea'](id),
    });
  },
  'idea-task'(id) { trasformaInTask(trova(S.idee, id)); },
  'idea-nota'(id) {
    const idea = trova(S.idee, id);
    conAnnulla('Trasformata in nota', () => {
      const titolo = idea.testo.length > 60 ? idea.testo.slice(0, 57) + '…' : idea.testo;
      S.note.push({ id: nuovoId(), titolo, testo: idea.testo, area: idea.area, creata: idea.creata, modificata: Date.now() });
      togli('idee', id);
    });
  },
  'elimina-idea'(id) { conAnnulla('Idea eliminata', () => togli('idee', id)); },

  'modifica-routine'(id) {
    const r = trova(S.routine, id);
    apriVoce({
      modo: 'routine', titolo: 'Routine', testo: r.testo, area: r.area, ora: r.ora,
      salva: (v) => { Object.assign(r, { testo: v.testo, area: v.area, ora: v.ora }); salva(); },
      elimina: () => conAnnulla('Voce eliminata', () => togli('routine', id)),
    });
  },
  su(id) { sposta(id, -1); },
  giu(id) { sposta(id, 1); },

  'apri-nota'(id) { apriNota(trova(S.note, id)); },
};

function sposta(id, verso) {
  const i = S.routine.findIndex((r) => r.id === id);
  const j = i + verso;
  if (i < 0 || j < 0 || j >= S.routine.length) return;
  [S.routine[i], S.routine[j]] = [S.routine[j], S.routine[i]];
  salva();
}

document.querySelector('main').addEventListener('click', (e) => {
  const el = e.target.closest('[data-azione]');
  if (!el) return;
  const riga = el.closest('[data-id]');
  const f = AZIONI[el.dataset.azione];
  if (f) f(el.dataset.id || (riga && riga.dataset.id), el);
});

document.querySelectorAll('.tabbar button').forEach((b) => b.addEventListener('click', () => mostraVista(b.dataset.vista)));

// ---------- Filtri Inbox ----------
$('inbox-tipo').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tipo]');
  if (b) impostaFiltri({ tipo: b.dataset.tipo, stato: b.dataset.tipo === 'task' ? '' : filtri.stato });
});
$('filtro-stato').addEventListener('change', (e) => impostaFiltri({ stato: e.target.value, tipo: e.target.value && filtri.tipo === 'tutte' ? 'idea' : filtri.tipo }));
$('filtro-area').addEventListener('change', (e) => impostaFiltri({ area: e.target.value }));
$('inbox-cerca').addEventListener('input', (e) => { filtri.cerca = e.target.value; disegnaInbox(); });

// ---------- Routine ----------
function campoOra(input) {
  const aggiorna = () => input.parentElement.classList.toggle('vuoto', !input.value);
  input.addEventListener('input', aggiorna);
  input.addEventListener('change', aggiorna);
  return aggiorna;
}
const aggiornaOraRoutine = campoOra($('routine-ora'));
const aggiornaOraRevisione = campoOra($('revisione-ora'));

$('form-routine').addEventListener('submit', (e) => {
  e.preventDefault();
  const testo = $('routine-testo').value.trim();
  if (!testo) return;
  S.routine.push({ id: nuovoId(), testo, ora: $('routine-ora').value, area: '' });
  $('routine-testo').value = '';
  $('routine-ora').value = '';
  aggiornaOraRoutine();
  salva();
});

// ---------- Appunti ----------
let notaAperta = null;
let areaNota = '';
function apriNota(nota) {
  notaAperta = nota || null;
  areaNota = nota ? nota.area || '' : '';
  $('nota-titolo').value = nota ? nota.titolo || '' : '';
  $('nota-testo').value = nota ? nota.testo : '';
  $('nota-data').textContent = fmtNota.format(new Date(nota ? nota.modificata : Date.now()));
  $('nota-elimina').hidden = !nota;
  chipsAree($('nota-aree'), areaNota);
  $('foglio-nota').showModal();
  if (!nota) $('nota-titolo').focus();
}
$('nota-aree').addEventListener('click', (e) => {
  const b = e.target.closest('[data-area]');
  if (b) { areaNota = b.dataset.area; chipsAree($('nota-aree'), areaNota); }
});
$('nuova-nota').addEventListener('click', () => apriNota(null));
$('note-cerca').addEventListener('input', (e) => { cercaNote = e.target.value; disegnaNote(); });
$('form-nota').addEventListener('submit', (e) => {
  e.preventDefault();
  const titolo = $('nota-titolo').value.trim();
  const testo = $('nota-testo').value;
  $('foglio-nota').close();
  if (notaAperta) {
    if (titolo !== (notaAperta.titolo || '') || testo !== notaAperta.testo || areaNota !== (notaAperta.area || '')) {
      Object.assign(notaAperta, { titolo, testo, area: areaNota, modificata: Date.now() });
      salva();
    }
  } else if (titolo || testo.trim()) {
    S.note.push({ id: nuovoId(), titolo, testo, area: areaNota, creata: Date.now(), modificata: Date.now() });
    salva();
  }
});
$('nota-annulla').addEventListener('click', () => $('foglio-nota').close());
$('nota-elimina').addEventListener('click', () => {
  const id = notaAperta.id;
  $('foglio-nota').close();
  conAnnulla('Nota eliminata', () => togli('note', id));
});

// ---------- Aree ----------
function disegnaAree() {
  $('lista-aree').innerHTML = S.aree.map((a) => `<li class="voce voce-area" data-id="${a.id}">
      <input class="campo" value="${esc(a.nome)}" aria-label="Nome area" enterkeyhint="done">
      <button class="btn-riga" data-elimina-area="${a.id}" aria-label="Elimina area">×</button></li>`).join('');
}
$('lista-aree').addEventListener('change', (e) => {
  const li = e.target.closest('[data-id]');
  const nome = e.target.value.trim();
  const a = li && trova(S.aree, li.dataset.id);
  if (!a) return;
  if (nome) { a.nome = nome; salva(); } else e.target.value = a.nome;
});
$('lista-aree').addEventListener('click', (e) => {
  const b = e.target.closest('[data-elimina-area]');
  if (b) conAnnulla('Area eliminata', () => togli('aree', b.dataset.eliminaArea));
});
$('form-area').addEventListener('submit', (e) => {
  e.preventDefault();
  const nome = $('area-nome').value.trim();
  if (!nome) return;
  S.aree.push({ id: nuovoId(), nome });
  $('area-nome').value = '';
  salva();
});

// ---------- Revisione settimanale ----------
$('revisione-attiva').addEventListener('change', (e) => { S.revisione.attiva = e.target.checked; salva(); });
$('revisione-ora').addEventListener('change', (e) => { if (e.target.value) { S.revisione.ora = e.target.value; salva(); } });

// ---------- Backup ----------
$('esporta').addEventListener('click', async () => {
  const nome = `agenda-backup-${oggi()}.json`;
  const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
  const file = new File([blob], nome, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: nome }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
});

$('importa').addEventListener('click', () => $('importa-file').click());
$('importa-file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!d || d.versione !== 2 || !Array.isArray(d.task) || !Array.isArray(d.routine)) throw new Error('formato');
    if (!confirm('Importare il backup? I dati attuali verranno sostituiti.')) return;
    S = Object.assign(vuoto(), d);
    salva();
    avviso('Backup importato');
  } catch (err) {
    avviso('File non valido');
  }
});

// ---------- Notifiche ----------
const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const installata = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const pushPossibile = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function dispositivo() {
  let id = localStorage.getItem('agenda-dispositivo');
  if (!id) { id = nuovoId(); localStorage.setItem('agenda-dispositivo', id); }
  return id;
}

function b64uDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function iscrizione() {
  if (!pushPossibile()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

function statoNotifiche(testo) { $('notifiche-stato').textContent = testo; }

async function aggiornaStatoNotifiche() {
  $('prova-notifica').hidden = true;
  if (!WORKER) return statoNotifiche('Server delle notifiche non configurato (config.js).');
  if (!pushPossibile()) {
    return statoNotifiche(iOS && !installata()
      ? "Per le notifiche installa l'app: in Safari tocca Condividi → Aggiungi alla schermata Home, poi aprila dall'icona."
      : 'Questo browser non supporta le notifiche push.');
  }
  if (Notification.permission === 'denied') return statoNotifiche('Notifiche bloccate. Riattivale da Impostazioni → Notifiche → Agenda.');
  const sub = await iscrizione();
  if (sub && Notification.permission === 'granted') {
    $('prova-notifica').hidden = false;
    $('attiva-notifiche').textContent = 'Riattiva notifiche';
    return statoNotifiche('Notifiche attive su questo dispositivo. Orari in ora italiana.');
  }
  $('attiva-notifiche').textContent = 'Attiva notifiche';
  statoNotifiche('Notifiche non attive.');
}

$('attiva-notifiche').addEventListener('click', async () => {
  if (!WORKER || !pushPossibile()) return aggiornaStatoNotifiche();
  const bottone = $('attiva-notifiche');
  bottone.disabled = true;
  try {
    // Su iOS il permesso va chiesto subito, dentro il tocco.
    const permesso = await Notification.requestPermission();
    if (permesso !== 'granted') return aggiornaStatoNotifiche();
    statoNotifiche('Collegamento al server…');
    const reg = await navigator.serviceWorker.ready;
    const { chiave, errore } = await (await fetch(WORKER + '/vapid')).json();
    if (!chiave) throw new Error(errore || 'chiave mancante');
    let sub = await reg.pushManager.getSubscription();
    if (sub && localStorage.getItem('agenda-vapid') !== chiave) { await sub.unsubscribe(); sub = null; }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uDecode(chiave) });
    localStorage.setItem('agenda-vapid', chiave);
    localStorage.removeItem('agenda-sync');
    await sincronizza(sub);
    avviso('Notifiche attive');
  } catch (err) {
    statoNotifiche('Attivazione non riuscita: ' + err.message);
    return;
  } finally {
    bottone.disabled = false;
  }
  aggiornaStatoNotifiche();
});

$('prova-notifica').addEventListener('click', async () => {
  try {
    await sincronizza();
    const r = await (await fetch(WORKER + '/prova', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: dispositivo() }) })).json();
    avviso(r.ok ? 'Notifica inviata' : 'Errore: ' + (r.errore || r.dettaglio || r.stato));
  } catch (err) {
    avviso('Server non raggiungibile');
  }
});

// Manda al Worker subscription, orari e voci spuntate oggi (solo se qualcosa è cambiato).
async function sincronizza(sub) {
  if (!WORKER) return;
  sub = sub || (await iscrizione());
  if (!sub) return;
  const g = oggi();
  const voci = [
    ...S.routine.filter((r) => r.ora).map((r) => ({ id: r.id, testo: r.testo, ora: r.ora, tipo: 'routine' })),
    ...S.task.filter((t) => t.ora && t.data >= g && !t.fatta).map((t) => ({ id: t.id, testo: t.testo, ora: t.ora, data: t.data, tipo: 'task' })),
  ];
  if (S.revisione.attiva && S.revisione.ora) {
    voci.push({ id: 'revisione', testo: 'Idee nuove e da valutare: smistale.', ora: S.revisione.ora, giorno: 0, tipo: 'revisione', url: './?vista=inbox&revisione=1' });
  }
  const corpo = JSON.stringify({ id: dispositivo(), sub: sub.toJSON(), voci, fatte: { data: g, ids: routineFatteOggi() } });
  if (localStorage.getItem('agenda-sync') === corpo) return;
  const r = await fetch(WORKER + '/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corpo });
  if (!r.ok) throw new Error('sync ' + r.status);
  localStorage.setItem('agenda-sync', corpo);
}

let timerSync;
function pianificaSync() {
  clearTimeout(timerSync);
  timerSync = setTimeout(() => sincronizza().catch(() => { /* si riprova alla prossima apertura */ }), 1500);
}

// ---------- Impostazioni ----------
$('apri-impostazioni').addEventListener('click', () => {
  aggiornaStatoNotifiche();
  $('revisione-attiva').checked = S.revisione.attiva;
  $('revisione-ora').value = S.revisione.ora;
  aggiornaOraRevisione();
  disegnaAree();
  $('foglio-impostazioni').showModal();
});
$('chiudi-impostazioni').addEventListener('click', () => $('foglio-impostazioni').close());

// Tocco sullo sfondo scuro chiude i fogli.
document.querySelectorAll('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

// ---------- Apertura da notifica ----------
function apriDaIndirizzo(cerca) {
  const p = new URLSearchParams(cerca);
  if (!TITOLI[p.get('vista')]) return false;
  mostraVista(p.get('vista'));
  if (p.get('revisione')) impostaFiltri({ tipo: 'idea', stato: 'revisione', area: '', cerca: '' });
  return true;
}
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.apri) apriDaIndirizzo(new URL(e.data.apri, location.href).search);
  });
}

// ---------- Avvio ----------
function alRitorno() {
  if (oggi() !== giornoDisegnato) disegna();
  pianificaSync();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) alRitorno(); });
window.addEventListener('online', pianificaSync);
setInterval(() => { if (!document.hidden && oggi() !== giornoDisegnato) disegna(); }, 60000);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

disegna();
if (apriDaIndirizzo(location.search)) {
  history.replaceState(null, '', location.pathname);
} else {
  try { const v = localStorage.getItem('agenda-vista'); if (TITOLI[v]) vista = v; } catch (e) { /* default Oggi */ }
  mostraVista(vista);
}
pianificaSync();
