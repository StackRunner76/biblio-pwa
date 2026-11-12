import {
  loadState, saveState, seed, nextId, today, catName, uniqueValues, countBy, cleanIsbn, validateBook,
  toCsv, importCsv, buildBackup, parseBackup, lookupIsbn, DASH_WIDGETS, normalizeLayout, isDefaultLayout,
} from '@biblio/core';
import { configureScanner, scan, stopScan, scanPhoto, beep, H5_URL } from './scanner.js';
import { initPwa, toast, pwaStatus, promptInstall, requestPersistence, checkForUpdate } from './pwa.js';

/* ───────── État ───────── */
const store = (() => { try { return window.localStorage; } catch (e) { return null; } })();
let S = loadState(store);
let F = { q: '', cat: '', aut: '', edi: '', lang: '', sort: 'titre' };

const save = () => {
  if (!store || !saveState(store, S)) toast('Enregistrement impossible : stockage plein ou bloqué. Exportez une sauvegarde JSON.', { ms: 8000 });
};
const el = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cat = (id) => catName(S, id);
const uniq = (k) => uniqueValues(S, k);
const cnt = (k) => countBy(S, k);
const hue = (s) => [...s].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;

/* ───────── Éléments d’interface ───────── */
const coverBg = (t) => `linear-gradient(135deg,hsl(${hue(t)} 55% 35%),#0f1b3d)`;
const cover = (b, c = 'h-44') =>
  b.cover
    ? `<img src="${esc(b.cover)}" class="${c} w-full object-cover rounded-xl" alt="Couverture de ${esc(b.titre)}" loading="lazy" data-t="${esc(b.titre)}" onerror="coverFail(this)">`
    : `<div class="${c} w-full rounded-xl flex items-end p-3 text-white font-bold text-sm overflow-hidden" style="background:${coverBg(b.titre)};overflow-wrap:anywhere">${esc(b.titre)}</div>`;
/* Couverture distante injoignable (hors ligne, lien mort) : on retombe sur la vignette colorée. */
function coverFail(i) {
  const d = document.createElement('div');
  d.className = i.className.replace('object-cover', '') + ' flex items-end p-3 text-white font-bold text-sm overflow-hidden';
  d.style.cssText = `background:${coverBg(i.dataset.t || '')};overflow-wrap:anywhere`;
  d.textContent = i.dataset.t || '';
  i.replaceWith(d);
}

const bars = (o) => {
  const e = Object.entries(o).sort((a, b) => b[1] - a[1]), m = Math.max(1, ...e.map((x) => x[1]));
  return e.map(([k, v]) => `<div class="mb-2 text-sm"><div class="flex justify-between"><span>${esc(k)}</span><b>${v}</b></div><div class="h-2 bg-slate-100 rounded"><div class="h-2 rounded bg-blue-500" style="width:${(v / m) * 100}%"></div></div></div>`).join('') || '<p class="text-slate-400">Aucune donnée</p>';
};

const navIcons = { dashboard: '🦉', catalogue: '📖', statistiques: '🔮', parametres: '⚙️' };
const pages = { dashboard: 'Tableau de bord', catalogue: 'Catalogue', statistiques: 'Statistiques', parametres: 'Paramètres' };

const isDark = () => document.documentElement.getAttribute('data-theme') === 'dark';
const tglInner = () => (isDark() ? '☀️<span class="hidden sm:inline"> Mode clair</span>' : '🌙<span class="hidden sm:inline"> Mode sombre</span>');
const themeBtn = () => `<button type="button" class="tgl tgl-side" onclick="toggleTheme()" title="${isDark() ? 'Passer en mode clair' : 'Passer en mode sombre'}" aria-label="Basculer entre mode clair et mode sombre" aria-pressed="${isDark()}">${tglInner()}</button>`;
function toggleTheme() {
  const t = isDark() ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('biblio_theme', t); } catch (e) {}
  document.querySelectorAll('.tgl').forEach((b) => {
    b.innerHTML = tglInner();
    b.title = isDark() ? 'Passer en mode clair' : 'Passer en mode sombre';
    b.setAttribute('aria-pressed', isDark());
  });
}

/* ───────── Routeur ───────── */
function route() {
  let p = location.hash.slice(1) || 'dashboard';
  let openAdd = false;
  if (p === 'ajouter') { // raccourci « Scanner un livre » de l’icône
    history.replaceState(null, '', '#catalogue');
    p = 'catalogue';
    openAdd = true;
  }
  if (!pages[p]) p = 'dashboard';
  const nav = Object.entries(pages).map(([k, v]) => `<a href="#${k}" class="${k === p ? 'on' : ''}">${navIcons[k] || ''} ${v}</a>`).join('');
  el('app').innerHTML = `<div class="md:flex min-h-screen"><aside class="md:w-60 md:min-h-screen p-3 md:p-4 text-white" style="background:#0f1b3d"><div class="flex justify-between items-center mb-3"><b class="text-lg">📚 ${esc(S.lib)}</b>${themeBtn()}</div><nav class="nav flex md:block gap-1 overflow-x-auto">${nav}</nav><div class="hidden md:block mt-8 text-xs text-blue-200"><button id="btn-install" class="btn2 w-full text-sm ${pwaStatus().canInstall ? '' : 'hidden'}" onclick="installApp()">📲 Installer l’application</button></div></aside><main class="flex-1 p-4 md:p-8 min-w-0"><div class="flex justify-between items-center mb-5 flex-wrap gap-2"><h2 class="text-2xl font-bold">${pages[p]}</h2>${p === 'catalogue' ? '' : `<input id="gs" class="inp sm:flex-1 sm:max-w-md order-last sm:order-none" placeholder="Rechercher un livre, un auteur, un ISBN… ( / )" onkeydown="if(event.key==='Enter')gsearch(this.value)">`}<button class="btn" onclick="openForm()">+ Ajouter un livre</button></div><div id="view"></div></main></div>`;
  ({ dashboard, catalogue, statistiques, parametres })[p]();
  if (openAdd) openForm();
}
addEventListener('hashchange', route);

function gsearch(v) { F.q = v.trim(); location.hash === '#catalogue' ? route() : (location.hash = 'catalogue'); }
function resetF() { F.q = F.cat = F.aut = F.edi = F.lang = ''; route(); }
function setF(k, v) { F[k] = v; renderList(); }

addEventListener('keydown', (e) => {
  const tg = (document.activeElement || {}).tagName;
  if (e.key === 'Escape') M('');
  else if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(tg) && !document.querySelector('#modal>div')) {
    const i = el('q_cat') || el('gs');
    if (i) { e.preventDefault(); i.focus(); }
  }
});

const V = (h) => (el('view').innerHTML = h);

/* ───────── Tableau de bord ───────── */
const fmtDate = (d) => {
  const t = new Date(d + 'T00:00:00');
  return isNaN(t) ? d : t.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
};

/** Blocs du tableau de bord : identifiant → { titre (pour l’accessibilité), taille, contenu }. */
const dashWidgets = () => {
  const stat = (id, label, n, href) => ({ titre: label, size: '', html: `<a href="#${href}" class="card p-5 block h-full hover:shadow-lg transition"><div class="text-slate-500 text-sm">${label}</div><div class="text-3xl font-bold text-blue-700">${n}</div></a>` });
  const rec = [...S.books].sort((a, b) => b.ajout.localeCompare(a.ajout)).slice(0, 6);
  return {
    livres: stat('livres', 'Livres', S.books.length, 'catalogue'),
    categories: stat('categories', 'Catégories', S.cats.length, 'parametres'),
    auteurs: stat('auteurs', 'Auteurs', uniq('auteur').length, 'parametres'),
    editeurs: stat('editeurs', 'Éditeurs', uniq('editeur').length, 'parametres'),
    'par-categorie': { titre: 'Par catégorie', size: 'dw-wide', html: `<div class="card p-5 h-full"><h3 class="font-bold mb-3 pr-8">Par catégorie</h3>${bars(cnt('cat'))}</div>` },
    'par-auteur': { titre: 'Par auteur', size: 'dw-wide', html: `<div class="card p-5 h-full"><h3 class="font-bold mb-3 pr-8">Par auteur</h3>${bars(cnt('auteur'))}</div>` },
    recents: {
      titre: 'Derniers ajouts',
      size: 'dw-full',
      html: `<div class="card p-5 h-full"><h3 class="font-bold mb-3 pr-8">Derniers ajouts</h3>${rec.length ? `<div class="rgrid">${rec.map((b) => `<button type="button" class="rc" onclick="detail(${b.id})" title="${esc(b.titre)}">${cover(b, 'ar-23')}<div class="font-bold text-sm leading-tight mt-2 clamp2">${esc(b.titre)}</div><div class="text-xs text-slate-500 clamp2">${esc(b.auteur)}</div><div class="text-xs text-slate-400 mt-1">${fmtDate(b.ajout)}</div></button>`).join('')}</div>` : '<p class="text-slate-400">Aucun livre pour le moment.</p>'}</div>`,
    },
  };
};

function dashboard() {
  const W = dashWidgets(), layout = normalizeLayout(S.layout);
  V(`<div class="flex justify-between items-center flex-wrap gap-2 mb-4"><p class="text-slate-500">Voici l’état de ${esc(S.lib)}. <span class="text-xs text-slate-400">Astuce : glissez un bloc par sa poignée ⠿ pour le déplacer.</span></p><button id="dreset" class="btn2 text-sm ${isDefaultLayout(layout) ? 'hidden' : ''}" onclick="resetLayout()">↺ Disposition d’origine</button></div><div id="dgrid" class="dgrid">${layout.map((id) => `<div class="dw ${W[id].size}" data-w="${id}">${W[id].html}<button type="button" class="dh" data-w="${id}" aria-label="Déplacer le bloc « ${esc(W[id].titre)} » (glisser, ou flèches du clavier)" title="Glisser pour déplacer">⠿</button></div>`).join('')}</div><div id="dlive" class="sr-only" aria-live="polite"></div>`);
  initDrag();
}

function resetLayout() { S.layout = [...DASH_WIDGETS]; save(); dashboard(); }

/** Enregistre l’ordre actuel des blocs (lu dans le DOM) et affiche/masque « Disposition d’origine ». */
function persistLayout() {
  const next = [...el('dgrid').children].map((d) => d.dataset.w);
  if (next.join() !== normalizeLayout(S.layout).join()) { S.layout = next; save(); }
  const r = el('dreset');
  if (r) r.classList.toggle('hidden', isDefaultLayout(next));
}

/** Anime les blocs vers leur nouvelle place après un changement d’ordre (technique « FLIP »). */
function flip(grid, mutate, skip) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const items = [...grid.children].filter((n) => n !== skip);
  const before = new Map(items.map((n) => [n, n.getBoundingClientRect()]));
  mutate();
  if (reduce) return;
  items.forEach((n) => {
    const a = before.get(n), b = n.getBoundingClientRect(), dx = a.left - b.left, dy = a.top - b.top;
    if (dx || dy) n.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: 180, easing: 'ease' });
  });
}

/**
 * Glisser-déposer des blocs (souris, tactile, stylet) via les Pointer Events, depuis la poignée ⠿.
 * Une copie « fantôme » suit le doigt ; le bloc d’origine, estompé, change de place au survol des autres.
 * Au clavier : poignée focalisée + flèches.
 */
function initDrag() {
  const grid = el('dgrid');
  if (!grid) return;
  const live = (w) => {
    const kids = [...grid.children], i = kids.indexOf(w);
    const l = el('dlive');
    if (l) l.textContent = `${w.querySelector('.dh').getAttribute('aria-label').match(/« (.*) »/)[1]} : position ${i + 1} sur ${kids.length}`;
  };

  grid.querySelectorAll('.dh').forEach((h) => {
    h.addEventListener('contextmenu', (e) => e.preventDefault());

    h.addEventListener('keydown', (e) => {
      const w = h.closest('.dw'), prev = ['ArrowUp', 'ArrowLeft'].includes(e.key), next = ['ArrowDown', 'ArrowRight'].includes(e.key);
      if (!prev && !next) return;
      e.preventDefault();
      const sib = prev ? w.previousElementSibling : w.nextElementSibling;
      if (!sib) return;
      flip(grid, () => (prev ? grid.insertBefore(w, sib) : grid.insertBefore(w, sib.nextSibling)), null);
      h.focus();
      persistLayout();
      live(w);
    });

    h.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.preventDefault();
      const w = h.closest('.dw'), r = w.getBoundingClientRect();
      const ox = e.clientX - r.left, oy = e.clientY - r.top;
      const ghost = w.cloneNode(true);
      ghost.classList.add('dw-ghost');
      ghost.removeAttribute('data-w');
      ghost.style.cssText = `width:${r.width}px;height:${r.height}px;left:${r.left}px;top:${r.top}px`;
      document.body.appendChild(ghost);
      w.classList.add('dw-src');
      document.body.classList.add('dragging');

      let px = e.clientX, py = e.clientY, last = 0, raf = 0;
      const place = () => {
        ghost.style.left = px - ox + 'px';
        ghost.style.top = py - oy + 'px';
        if (performance.now() - last < 140) return; // laisse la grille se stabiliser entre deux échanges
        const t = document.elementFromPoint(px, py);
        const over = t && t.closest && t.closest('.dw');
        if (!over || over === w || over.parentNode !== grid) return;
        last = performance.now();
        const after = w.compareDocumentPosition(over) & Node.DOCUMENT_POSITION_FOLLOWING; // le survolé est après le déplacé
        flip(grid, () => grid.insertBefore(w, after ? over.nextSibling : over), w);
      };
      const loop = () => { // défilement automatique près des bords de l’écran
        const m = 70, v = py < m ? -(m - py) / 4 : py > innerHeight - m ? (py - (innerHeight - m)) / 4 : 0;
        if (v) { scrollBy(0, Math.max(-24, Math.min(24, v))); place(); }
        raf = requestAnimationFrame(loop);
      };
      const move = (ev) => { if (ev.pointerId !== e.pointerId) return; px = ev.clientX; py = ev.clientY; ev.preventDefault(); place(); };
      const end = (ev) => {
        if (ev.pointerId !== e.pointerId) return;
        cancelAnimationFrame(raf);
        removeEventListener('pointermove', move);
        removeEventListener('pointerup', end);
        removeEventListener('pointercancel', end);
        ghost.remove();
        w.classList.remove('dw-src');
        document.body.classList.remove('dragging');
        persistLayout();
        live(w);
      };
      addEventListener('pointermove', move, { passive: false });
      addEventListener('pointerup', end);
      addEventListener('pointercancel', end);
      raf = requestAnimationFrame(loop);
    });
  });
}

/* ───────── Catalogue ───────── */
function renderList() {
  const f = F, q = f.q.toLowerCase();
  const r = S.books.filter((b) => (!q || [b.titre, b.auteur, b.isbn, b.editeur, cat(b.catId), b.genre, b.langue].join(' ').toLowerCase().includes(q)) && (!f.cat || b.catId == f.cat) && (!f.aut || b.auteur === f.aut) && (!f.edi || b.editeur === f.edi) && (!f.lang || b.langue === f.lang));
  r.sort((a, b) => (f.sort === 'ajout' ? b.ajout.localeCompare(a.ajout) : f.sort === 'auteur' ? a.auteur.localeCompare(b.auteur) : a.titre.localeCompare(b.titre)));
  el('cnt').innerHTML = `<span>${r.length} livre${r.length > 1 ? 's' : ''} sur ${S.books.length}</span>${F.q || F.cat || F.aut || F.edi || F.lang ? '<button class="underline" onclick="resetF()">Réinitialiser les filtres</button>' : ''}`;
  el('res').innerHTML = r.map((b) => `<div class="card p-3 cursor-pointer hover:shadow-lg" onclick="detail(${b.id})">${cover(b)}<div class="font-bold mt-2 leading-tight">${esc(b.titre)}</div><div class="text-sm text-slate-500">${esc(b.auteur)}</div><div class="text-xs text-slate-400 mt-1">${esc(b.editeur)} · ${esc(cat(b.catId))} · ${esc(b.langue)}</div><div class="text-xs text-slate-400">ISBN ${esc(b.isbn)}</div><div class="mt-2 flex gap-1 flex-wrap"><span class="text-xs px-2 py-0.5 rounded-full" style="background:#e3edcf;color:#35511a">${b.qte} ex.</span><span class="text-xs px-2 py-0.5 rounded-full" style="background:#f3e3b8;color:#5a3d0a">${esc(b.etat)}</span></div></div>`).join('') || '<div class="card p-8 text-center col-span-full"><div class="text-4xl mb-2">🔍</div><p class="font-bold">Aucun livre trouvé</p><p class="text-slate-500 text-sm mb-4">Essayez d’autres mots-clés ou retirez un filtre.</p><div class="flex gap-2 justify-center flex-wrap"><button class="btn2" onclick="resetF()">Réinitialiser les filtres</button><button class="btn" onclick="openForm()">Ajouter un livre</button></div></div>';
}
const sel = (key, opts, lbl) => `<select class="inp" aria-label="${esc(lbl)}" onchange="setF('${key}',this.value)"><option value="">${lbl}</option>${opts.map((o) => `<option value="${esc(o[0])}" ${F[key] == o[0] ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select>`;
function catalogue() {
  V(`<div class="card p-4 mb-4 grid sm:grid-cols-2 lg:grid-cols-6 gap-2"><input id="q_cat" class="inp lg:col-span-2" placeholder="Rechercher ( / ) titre, auteur, ISBN…" value="${esc(F.q)}" oninput="setF('q',this.value)">${sel('cat', S.cats.map((c) => [c.id, c.name]), 'Catégorie')}${sel('aut', uniq('auteur').map((x) => [x, x]), 'Auteur')}${sel('edi', uniq('editeur').map((x) => [x, x]), 'Éditeur')}${sel('sort', [['titre', 'Tri : titre'], ['ajout', 'Tri : date d’ajout'], ['auteur', 'Tri : auteur']], 'Trier')}</div><div id="cnt" class="text-sm text-slate-500 mb-3 flex justify-between"></div><div id="res" class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4"></div>`);
  renderList();
}

/* ───────── Fenêtre modale, fiche, suppression ───────── */
const M0 = (h) => (el('modal').innerHTML = h ? `<div class="fixed inset-0 bg-black/50 z-50 overflow-y-auto p-4" onclick="if(event.target===this)M()"><div class="card max-w-2xl mx-auto p-6 my-6" role="dialog" aria-modal="true">${h}</div></div>` : '');
const M = (h) => { try { stopScan(); } catch (e) {} return M0(h); };

function detail(id) {
  const b = S.books.find((x) => x.id == id);
  if (!b) return;
  M(`<div class="grid sm:grid-cols-3 gap-4"><div>${cover(b, 'h-56')}</div><div class="sm:col-span-2 text-sm"><h3 class="text-xl font-bold">${esc(b.titre)}</h3><p class="text-slate-500 mb-3">${esc(b.auteur)}</p>${[['ISBN', b.isbn], ['Éditeur', b.editeur], ['Publication', b.date], ['Catégorie', cat(b.catId)], ['Genre', b.genre], ['Langue', b.langue], ['Pages', b.pages], ['Emplacement', b.lieu], ['Quantité', b.qte], ['État', b.etat], ['Ajouté le', b.ajout]].map(([a, v]) => `<div><b>${a} :</b> ${esc(v)}</div>`).join('')}<p class="mt-3">${esc(b.desc)}</p>${b.quatrieme ? `<div class="mt-3 p-3 rounded-xl bg-slate-50"><b>Quatrième de couverture</b><p class="mt-1 whitespace-pre-line">${esc(b.quatrieme)}</p></div>` : ''}</div></div><div class="flex gap-2 mt-5"><button class="btn" onclick="openForm(${id})">Modifier</button><button class="btn2 text-red-600" onclick="del(${id})">Supprimer</button><button class="btn2 ml-auto" onclick="M()">Fermer</button></div>`);
}
function del(id) {
  if (confirm('Supprimer ce livre ?')) { S.books = S.books.filter((b) => b.id != id); save(); M(); route(); }
}

/* ───────── Formulaire livre ───────── */
function say(t) { const e = el('ferr'); if (e) { e.textContent = t; e.scrollIntoView({ block: 'nearest' }); } }
function showForm() {
  stopScan();
  const g = el('fgrid'), v = el('vbtn'), m = el('manrow');
  if (g) g.style.display = '';
  if (v) v.style.display = '';
  if (m) m.style.display = 'none';
}
function showManual() { showForm(); const i = el('f_isbn'); if (i) i.focus(); }

function openForm(id) {
  const b = S.books.find((x) => x.id == id) || { titre: '', auteur: '', isbn: '', editeur: '', date: '', catId: S.cats[0].id, genre: '', langue: 'fr', desc: '', cover: '', pages: '', lieu: '', qte: 1, etat: 'Bon' };
  const f = (k, l, t = 'text', c = '') => `<label class="text-sm ${c}">${l}<input id="f_${k}" type="${t}" class="inp" value="${esc(b[k])}"></label>`;
  M(`<h3 class="text-xl font-bold mb-4">${id ? 'Modifier' : 'Ajouter'} un livre</h3><div id="fgrid" ${id ? '' : 'style="display:none"'} class="grid sm:grid-cols-2 gap-3">${f('titre', 'Titre *')}${f('auteur', 'Auteur *')}<div class="flex gap-2 items-end">${f('isbn', 'ISBN *', 'text', 'flex-1')}<button class="btn2" onclick="scan()" title="Scanner le code-barres" aria-label="Scanner le code-barres">📷</button><button class="btn2" title="Remplir via Google Books" aria-label="Remplir via Google Books" onclick="lookup()">🔎</button></div>${f('editeur', 'Éditeur')}${f('date', 'Date de publication', 'date')}<label class="text-sm">Catégorie<select id="f_catId" class="inp">${S.cats.map((c) => `<option value="${c.id}" ${c.id == b.catId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>${f('genre', 'Genre littéraire')}${f('langue', 'Langue')}${f('pages', 'Pages', 'number')}${f('lieu', 'Emplacement')}${f('qte', 'Quantité', 'number')}<label class="text-sm">État<select id="f_etat" class="inp">${['Neuf', 'Bon', 'Usé', 'Abîmé'].map((e) => `<option ${e === b.etat ? 'selected' : ''}>${e}</option>`).join('')}</select></label>${f('cover', 'Image de couverture (URL ou fichier ci-dessous)', 'text', 'sm:col-span-2')}<div class="sm:col-span-2 flex gap-2 flex-wrap items-center"><label class="btn2 cursor-pointer">📁 Importer une image<input type="file" accept="image/*" hidden onchange="img(this)"></label><label class="btn2 cursor-pointer">📷 Photographier la couverture<input type="file" accept="image/*" capture="environment" hidden onchange="img(this)"></label><div id="pv">${b.cover ? `<img src="${esc(b.cover)}" class="h-32 rounded-lg" alt="">` : ''}</div></div><input type="hidden" id="f_desc" value="${esc(b.desc)}"><label class="text-sm sm:col-span-2">Quatrième de couverture<textarea id="f_quatrieme" class="inp" rows="5">${esc(b.quatrieme)}</textarea></label></div><div id="vbox" class="hidden mt-3 bg-black rounded overflow-hidden"><div id="reader" class="w-full"></div></div><div id="reader-file" style="display:none"></div>${id ? '' : '<div class="flex gap-2 flex-wrap mt-3" id="manrow"><button class="btn2 text-sm" onclick="scan()">📷 Relancer la caméra</button><button class="btn2 text-sm" onclick="showManual()">✍️ Saisir manuellement</button></div>'}<label class="btn2 cursor-pointer inline-block mt-2 text-sm">📸 Lire depuis une photo<input type="file" accept="image/*" capture="environment" hidden onchange="scanPhoto(this)"></label><p id="ferr" class="text-red-600 text-sm mt-2" role="alert"></p><div class="flex gap-2 mt-4"><button id="vbtn" ${id ? '' : 'style="display:none"'} class="btn" onclick="saveBook(${id || 0})">Valider</button><button class="btn2" onclick="M()">Annuler</button></div>`);
  if (!id) scan();
}

function img(i) {
  const f = i.files[0];
  if (!f) return;
  const im = new Image();
  im.onload = () => {
    const k = Math.min(1, 360 / im.width), c = document.createElement('canvas');
    c.width = im.width * k;
    c.height = im.height * k;
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    el('f_cover').value = c.toDataURL('image/jpeg', 0.8);
    prev();
  };
  im.src = URL.createObjectURL(f);
}
function prev() { const v = el('f_cover').value; el('pv').innerHTML = v ? `<img src="${esc(v)}" class="h-32 rounded-lg" alt="">` : ''; }

async function lookup() {
  const n = cleanIsbn(el('f_isbn').value);
  if (!n) return say('Saisissez d’abord un ISBN.');
  say('Recherche en cours…');
  const r = await lookupIsbn(n, { apiKey: S.gbkey || '' });
  if (!el('f_isbn')) return; // fenêtre fermée pendant la recherche
  ['titre', 'auteur', 'editeur', 'date', 'pages', 'langue', 'genre', 'cover', 'quatrieme'].forEach((k) => { if (r.fields[k]) el('f_' + k).value = r.fields[k]; });
  if (r.found) {
    prev();
    return say(el('f_quatrieme').value.trim() ? 'Fiche pré-remplie : vérifiez les champs puis validez.' : r.quota ? 'Fiche pré-remplie, mais le quota Google Books est atteint : ajoutez une clé API gratuite dans Paramètres, ou saisissez la quatrième de couverture à la main.' : 'Fiche pré-remplie, mais aucune quatrième de couverture en français trouvée : saisissez-la à la main.');
  }
  say(r.why === 'net' ? 'Connexion impossible : la recherche par ISBN nécessite Internet. Vous pouvez saisir la fiche à la main.' : 'Aucun résultat pour cet ISBN' + (r.why ? ' (' + r.why + ')' : '') + '.');
}

configureScanner({
  say,
  showForm,
  beepOn: () => S.beep !== false,
  onCode: (c) => {
    beep();
    showForm();
    el('f_isbn').value = c;
    say('ISBN lu : ' + c + '. Récupération des informations…');
    lookup();
  },
});

function saveBook(id) {
  const raw = {};
  ['titre', 'auteur', 'isbn', 'editeur', 'date', 'genre', 'langue', 'lieu', 'etat', 'desc', 'quatrieme', 'cover', 'catId', 'pages', 'qte'].forEach((k) => (raw[k] = el('f_' + k).value));
  const r = validateBook(raw, S.books, id);
  if (r.error) { el('ferr').textContent = r.error; return; }
  if (id) Object.assign(S.books.find((b) => b.id === id), r.book);
  else S.books.push({ ...r.book, id: nextId(S.books), ajout: today() });
  save(); M(); route();
}

/* ───────── Paramètres : catégories, auteurs, éditeurs ───────── */
function catsHTML() {
  const row = (c, d) => `<tr class="border-t"><td class="py-2" style="padding-left:${d * 20}px">${d ? '↳ ' : ''}${esc(c.name)}</td><td>${S.books.filter((b) => b.catId == c.id).length}</td><td class="text-right"><button class="btn2" onclick="renCat(${c.id})">Renommer</button> <button class="btn2 text-red-600" onclick="delCat(${c.id})">Suppr.</button></td></tr>`;
  return `<div class="card p-5 mb-4 flex gap-2 flex-wrap"><input id="nc" class="inp flex-1" placeholder="Nouvelle catégorie"><select id="np" class="inp sm:w-56"><option value="0">Catégorie principale</option>${S.cats.filter((c) => !c.parent).map((c) => `<option value="${c.id}">Sous-cat. de ${esc(c.name)}</option>`).join('')}</select><button class="btn" onclick="addCat()">Ajouter</button></div><div class="card p-5 overflow-x-auto"><table class="w-full text-sm"><tr class="text-left text-slate-500"><th>Nom</th><th>Livres</th><th></th></tr>${S.cats.filter((c) => !c.parent).map((c) => row(c, 0) + S.cats.filter((s) => s.parent == c.id).map((s) => row(s, 1)).join('')).join('')}</table></div>`;
}
function addCat() {
  const n = el('nc').value.trim();
  if (!n || S.cats.some((c) => c.name.toLowerCase() === n.toLowerCase())) return alert('Nom vide ou déjà utilisé.');
  S.cats.push({ id: nextId(S.cats), name: n, parent: +el('np').value });
  save(); route();
}
function renCat(id) {
  const c = S.cats.find((x) => x.id == id), n = prompt('Nouveau nom', c.name);
  if (n && n.trim()) { c.name = n.trim(); save(); route(); }
}
function delCat(id) {
  if (S.books.some((b) => b.catId == id) || S.cats.some((c) => c.parent == id)) return alert('Catégorie utilisée : réaffectez ses livres ou sous-catégories d’abord.');
  if (confirm('Supprimer ?')) { S.cats = S.cats.filter((c) => c.id != id); save(); route(); }
}
function peopleHTML(k, t) {
  const o = cnt(k), n1 = k === 'auteur' ? 'Nouvel auteur' : 'Nouvel éditeur';
  return `<div class="card p-5 mb-4 flex gap-2 flex-wrap"><input id="np_${k}" class="inp flex-1" placeholder="${n1}"><button class="btn" onclick="addP('${k}')">Ajouter</button></div><div class="card p-5 overflow-x-auto"><table class="w-full text-sm"><tr class="text-left text-slate-500"><th>${t}</th><th>Livres</th><th></th></tr>${uniq(k).map((n) => `<tr class="border-t"><td class="py-2">${esc(n)}</td><td>${o[n] || 0}</td><td class="text-right"><button class="btn2" onclick="renP('${k}',this.dataset.n)" data-n="${esc(n)}">Modifier</button> ${o[n] ? '' : `<button class="btn2 text-red-600" onclick="delP('${k}',this.dataset.n)" data-n="${esc(n)}">Suppr.</button>`}</td></tr>`).join('')}</table></div>`;
}
function addP(k) {
  const n = el('np_' + k).value.trim();
  if (!n || uniq(k).some((x) => x.toLowerCase() === n.toLowerCase())) return alert('Nom vide ou déjà utilisé.');
  S.extra = S.extra || { auteur: [], editeur: [] };
  (S.extra[k] = S.extra[k] || []).push(n);
  save(); route();
}
function renP(k, old) {
  const n = prompt('Nouveau nom', old);
  if (n && n.trim()) {
    S.books.forEach((b) => { if (b[k] === old) b[k] = n.trim(); });
    const e = (S.extra || {})[k];
    if (e) S.extra[k] = e.map((x) => (x === old ? n.trim() : x));
    save(); route();
  }
}
function delP(k, n) {
  if (S.books.some((b) => b[k] === n)) return alert('Utilisé par des livres.');
  if (confirm('Supprimer ?')) { S.extra[k] = (S.extra[k] || []).filter((x) => x !== n); save(); route(); }
}

/* ───────── Statistiques ───────── */
function statistiques() {
  const t = S.books.reduce((a, b) => a + b.qte, 0), p = Math.round(S.books.reduce((a, b) => a + b.pages, 0) / (S.books.length || 1));
  V(`<div class="grid grid-cols-3 gap-4 mb-4">${[['Exemplaires', t], ['Titres', S.books.length], ['Pages moy.', p]].map(([a, b]) => `<div class="card p-5"><div class="text-slate-500 text-sm">${a}</div><div class="text-2xl font-bold text-blue-700">${b}</div></div>`).join('')}</div><div class="grid md:grid-cols-3 gap-4">${[['Par langue', 'langue'], ['Par état', 'etat'], ['Par genre', 'genre']].map(([a, k]) => `<div class="card p-5"><h3 class="font-bold mb-3">${a}</h3>${bars(cnt(k))}</div>`).join('')}</div>`);
}

/* ───────── Paramètres généraux, application, import / export ───────── */
function paramGeneral() {
  return `<div class="card p-5 max-w-xl"><label class="text-sm">Nom de la bibliothèque<input id="ln" class="inp mb-4" value="${esc(S.lib)}" onchange="setLib(this.value)"></label><label class="text-sm flex items-center gap-2 mb-4"><input type="checkbox" ${S.beep === false ? '' : 'checked'} onchange="setBeep(this.checked)"> Bip sonore lors de la lecture d’un code-barres</label><label class="text-sm block mb-4">Clé API Google Books (optionnelle, gratuite)<input id="gk" class="inp" placeholder="AIza…" value="${esc(S.gbkey || '')}" oninput="setKey(this.value)"></label><div class="flex gap-2 flex-wrap"><button class="btn" onclick="exp()">Exporter CSV</button><label class="btn2 cursor-pointer">Importer CSV<input type="file" accept=".csv,text/csv" hidden onchange="imp(this)"></label><button class="btn" onclick="expJ()">Exporter JSON (complet)</button><label class="btn2 cursor-pointer">Importer JSON<input type="file" accept=".json,application/json" hidden onchange="impJ(this)"></label><button class="btn2 text-red-600" onclick="resetData()">Réinitialiser</button></div><p class="text-xs text-slate-500 mt-3">Le JSON sauvegarde toute la bibliothèque (livres, catégories, couvertures, nom) ainsi que les paramètres (dont la clé API Google Books) ; son import remplace les données et paramètres actuels. Attention : le fichier contient votre clé API, ne le partagez pas. CSV séparé par « ; » (ouvrable dans Excel). Les doublons d’ISBN sont ignorés à l’import.</p></div>`;
}
function appCard() {
  const st = pwaStatus();
  return `<div id="appcard" class="card p-5 max-w-xl mt-4"><h3 class="font-bold mb-2">Application</h3><p class="text-sm text-slate-500 mb-3">${st.offlineReady ? '✅ Prête pour une utilisation hors connexion.' : 'Le mode hors connexion s’active après le premier chargement (HTTPS requis).'} Vos données restent sur cet appareil${st.persisted ? ' (stockage protégé)' : ''} : exportez une sauvegarde JSON régulièrement, surtout avant de vider les données du navigateur.</p><div class="flex gap-2 flex-wrap">${st.canInstall ? '<button class="btn" onclick="installApp()">📲 Installer l’application</button>' : ''}<button class="btn2" onclick="checkUpdate()">Rechercher une mise à jour</button>${!st.persisted && navigator.storage && navigator.storage.persist ? '<button class="btn2" onclick="keepData()">🔒 Protéger mes données</button>' : ''}</div>${st.ios && !st.standalone ? '<p class="text-xs text-slate-500 mt-3">Sur iPhone / iPad : touchez Partager, puis « Sur l’écran d’accueil ».</p>' : ''}<p class="text-xs text-slate-400 mt-3">Version ${esc(st.version || '—')}</p></div>`;
}
function parametres() {
  const h = (s) => `<h3 class="font-bold text-lg mt-6 mb-2">${s}</h3>`;
  V(`${paramGeneral()}${appCard()}${h('Catégories')}${catsHTML()}${h('Auteurs')}${peopleHTML('auteur', 'Auteur')}${h('Éditeurs')}${peopleHTML('editeur', 'Éditeur')}`);
}
function setLib(v) { S.lib = v; save(); }
function setBeep(c) { S.beep = c; save(); if (c) beep(); }
function setKey(v) { S.gbkey = String(v || '').trim(); save(); }
function resetData() { if (confirm('Réinitialiser les données de démo ? Toute la bibliothèque actuelle sera perdue.')) { S = seed(); save(); route(); } }

function dl(name, data, type) {
  const u = URL.createObjectURL(new Blob([data], { type })), a = document.createElement('a');
  a.href = u; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 2000);
}
const stamp = () => new Date().toISOString().slice(0, 10);
function exp() { dl('catalogue-' + stamp() + '.csv', toCsv(S), 'text/csv;charset=utf-8'); }
function expJ() { dl('bibliotheque-' + stamp() + '.json', JSON.stringify(buildBackup(S), null, 2), 'application/json'); }

function imp(i) {
  const f = i.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    const { added, skipped } = importCsv(S, r.result);
    save();
    alert(added + ' ajouté(s), ' + skipped + ' ignoré(s).');
    route();
  };
  r.readAsText(f);
  i.value = '';
}
function impJ(i) {
  const f = i.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const n = parseBackup(JSON.parse(r.result), { lib: S.lib, gbkey: S.gbkey });
      if (!confirm('Remplacer toute la bibliothèque actuelle par ce fichier (' + n.books.length + ' livres, ' + n.cats.length + ' catégories) ?')) return;
      S = n;
      save(); route();
    } catch (e) {
      alert('Fichier JSON invalide : ce n’est pas une sauvegarde de la bibliothèque.');
    }
  };
  r.readAsText(f);
  i.value = '';
}

/* ───────── PWA ───────── */
async function installApp() { await promptInstall(); }
async function keepData() { const ok = await requestPersistence(); toast(ok ? 'Stockage protégé : le navigateur ne l’effacera pas automatiquement.' : 'Le navigateur n’a pas accordé la protection du stockage.'); }
function refreshPwaUi() {
  const b = el('btn-install');
  if (b) b.classList.toggle('hidden', !pwaStatus().canInstall);
  const c = el('appcard');
  if (c) c.outerHTML = appCard();
}

/* Les gestionnaires inline (onclick="…") du gabarit HTML s’appuient sur l’objet window. */
Object.assign(window, {
  toggleTheme, gsearch, resetF, setF, openForm, detail, del, M, scan, scanPhoto, lookup, showManual, saveBook, img,
  renCat, delCat, addCat, addP, renP, delP, exp, expJ, imp, impJ, setKey, setLib, setBeep, resetData,
  installApp, keepData, checkUpdate: checkForUpdate, coverFail, resetLayout,
});

initPwa({ onChange: refreshPwaUi, warmUrls: [H5_URL] });
route();
