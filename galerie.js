const el = id => document.getElementById(id);
const api = 'https://fd-moskevska-pripominky-1c7a.netlify.app/.netlify/functions/notes';
const encoder = new TextEncoder();
const secret = new URLSearchParams(location.hash.slice(1)).get('k') || '';
const cache = new Map();
const thumbnails = new Map();
const stateNames = { new: 'Přijato', done: 'Hotovo', question: 'K upřesnění', approved: 'Schváleno' };
const draftKey = 'moskevska-predsin-draft-2';
let mediaKey, token, manifest, active, version, pendingId;
let point = null, selecting = false, loading = false, sending = false;
let records = [], notesReady = false, notesRequest = 0, refreshing = false;
let drafts = {};

const latest = entry => entry.versions.at(-1)?.revision ?? 0;
const versionName = number => number === 0 ? 'Originál' : 'Verze ' + number;
const slideKey = (id, number) => id + '@' + number;
const b64 = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const approved = (id, number) => records.some(note => note.photo === id && note.revision === number && note.state === 'approved');

function message(text, error = false) {
  el('notice').classList.toggle('error', error);
  el('notice').textContent = text;
}

async function photo(file) {
  if (!cache.has(file)) {
    const request = (async () => {
      const response = await fetch('media/' + encodeURIComponent(file));
      if (!response.ok) throw Error('Soubor se nepodařilo načíst.');
      const bytes = new Uint8Array(await response.arrayBuffer());
      const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12), additionalData: encoder.encode(file) }, mediaKey, bytes.subarray(12));
      return URL.createObjectURL(new Blob([clear], { type: 'image/jpeg' }));
    })();
    cache.set(file, request);
    request.catch(() => cache.delete(file));
  }
  return cache.get(file);
}

async function notesAPI(body) {
  const headers = { Authorization: 'Bearer ' + token };
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(api, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw Error('Připomínky se nepodařilo spojit se studiem.');
  return response.json();
}

function split(value) {
  const position = Math.max(0, Math.min(100, Math.round(value)));
  el('figure').style.setProperty('--split', position + '%');
  el('split').value = position;
  el('split').setAttribute('aria-valuetext', position + ' procent původní fotografie');
  el('leftTag').hidden = version === 0 || position < 8;
  el('rightTag').hidden = version === 0 || position > 92;
}

function relative(event) {
  const rect = el('figure').getBoundingClientRect();
  const norm = (value, size) => Math.max(0, Math.min(1000, Math.round(1000 * value / size)));
  return { x: norm(event.clientX - rect.left, rect.width), y: norm(event.clientY - rect.top, rect.height) };
}

el('split').addEventListener('input', event => split(event.target.value));
el('split').addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  event.preventDefault();
  event.currentTarget.focus({ preventScroll: true });
  event.currentTarget.setPointerCapture(event.pointerId);
  split(relative(event).x / 10);
});
el('split').addEventListener('pointermove', event => {
  if (event.currentTarget.hasPointerCapture(event.pointerId)) split(relative(event).x / 10);
});

function saveDraft() {
  if (!active) return;
  const text = el('text').value;
  const key = slideKey(active.id, version);
  if (text || point) drafts[key] = { text, point, id: pendingId };
  else delete drafts[key];
  try { localStorage.setItem(draftKey, JSON.stringify(drafts)); } catch {}
}

function drawPoint(value) {
  el('marker').hidden = !value;
  if (value) {
    el('marker').style.left = value.x / 10 + '%';
    el('marker').style.top = value.y / 10 + '%';
  }
}

function selectionMode(enabled) {
  selecting = enabled;
  el('point').setAttribute('aria-pressed', String(enabled));
  el('point-label').textContent = enabled ? 'Klikněte na místo ve fotce' : point ? 'Změnit označené místo' : 'Označit místo ve fotce';
  el('drop-point').hidden = !point && !enabled;
  el('pick').hidden = !enabled;
  el('split').disabled = enabled;
}

function pick(value) {
  point = value;
  pendingId = null;
  drawPoint(point);
  selectionMode(false);
  saveDraft();
  el('text').focus();
}

el('point').addEventListener('click', () => {
  selectionMode(!selecting);
  if (selecting) {
    el('figure').scrollIntoView({ block: 'nearest' });
    el('pick').focus({ preventScroll: true });
  } else drawPoint(point);
});
el('pick').addEventListener('click', event => pick(event.detail ? relative(event) : { x: 500, y: 500 }));
el('drop-point').addEventListener('click', () => pick(null));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && selecting) {
    selectionMode(false);
    el('point').focus();
  }
});
el('text').addEventListener('input', () => { pendingId = null; saveDraft(); });

function row(note) {
  const item = document.createElement('article');
  item.className = 'note';
  const body = document.createElement('p');
  body.textContent = note.text;
  body.classList.toggle('approved', note.state === 'approved');
  const info = document.createElement('small');
  const stamp = new Date(note.created).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
  info.textContent = (stateNames[note.state] || 'Přijato') + ' · ' + versionName(note.version ?? note.revision) + ' · ' + stamp;
  item.append(body, info);
  if (note.point) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'text-action';
    button.textContent = 'Ukázat místo';
    button.onclick = async () => {
      if (await showSlide(active, note.revision)) {
        drawPoint(note.point);
        el('figure').scrollIntoView({ block: 'nearest' });
      }
    };
    item.append(button);
  }
  if (note.answer) {
    const answer = document.createElement('p');
    answer.className = 'answer';
    answer.textContent = 'Studio · ' + note.answer;
    item.append(answer);
  }
  return item;
}

function syncControls() {
  if (!active) return;
  const locked = loading || sending;
  const accepted = approved(active.id, version);
  el('previous').disabled = locked || manifest.photos[0].id === active.id;
  el('next').disabled = locked || manifest.photos.at(-1).id === active.id;
  for (const id of ['submit', 'text', 'point', 'drop-point', 'versions', 'unapprove']) el(id).disabled = locked;
  el('approve').disabled = locked || !notesReady || accepted;
  el('approve').setAttribute('aria-pressed', String(accepted));
  el('approve-label').textContent = accepted ? 'OK · Schváleno' : 'OK · Schválit fotku';
  el('unapprove').hidden = !accepted || !notesReady;
}

function showRecords() {
  if (!active) return;
  const notes = records.filter(note => note.photo === active.id);
  if (notes.length) {
    el('notes').replaceChildren(...notes.map(row));
  } else {
    const blank = document.createElement('p');
    blank.textContent = notesReady ? 'Zatím tu žádné nejsou.' : 'Přehled se nepodařilo načíst.';
    el('notes').replaceChildren(blank);
  }
  let total = 0;
  for (const entry of manifest.photos) {
    const { button, mark } = thumbnails.get(entry.id);
    const accepted = approved(entry.id, latest(entry));
    mark.hidden = !accepted;
    total += Number(accepted);
    button.setAttribute('aria-label', entry.title + ' · ' + entry.id + (accepted ? ' · schváleno' : ''));
  }
  el('progress').hidden = !notesReady;
  el('progress').textContent = total + ' z ' + manifest.photos.length + ' schváleno';
  el('retry').hidden = notesReady;
  syncControls();
}

async function loadNotes() {
  const request = ++notesRequest;
  try {
    const data = await notesAPI();
    if (request !== notesRequest) return;
    records = data.notes.map(note => ({ ...note, photo: note.photo || manifest.defaultPhoto }));
    notesReady = true;
  } catch {
    if (request !== notesRequest) return;
    notesReady = false;
  }
  showRecords();
}
el('retry').addEventListener('click', loadNotes);

async function setApproval(accept, fromText = false) {
  if (loading || sending || !notesReady) {
    if (!notesReady) message('Schválení teď nelze ověřit. Zkuste načíst přehled znovu.', true);
    return;
  }
  sending = true;
  syncControls();
  const body = { action: accept ? 'approve' : 'unapprove', photo: active.id, revision: version };
  try {
    const result = await notesAPI(body);
    if (accept && (result.note?.state !== 'approved' || result.note.photo !== body.photo || result.note.revision !== body.revision)) throw Error();
    if (!accept && result.approved !== false) throw Error();
    records = records.filter(note => note.state !== 'approved' || note.photo !== body.photo || note.revision !== body.revision);
    if (accept) records.unshift(result.note);
    if (fromText) {
      el('text').value = '';
      pendingId = point = null;
      drawPoint(null);
      selectionMode(false);
      saveDraft();
    }
    message(accept ? 'OK bylo uloženo k této fotce.' : 'Schválení bylo zrušeno.');
    await loadNotes();
  } catch { message('Změnu schválení se nepodařilo potvrdit. Zkuste to znovu.', true); }
  finally { sending = false; syncControls(); }
}
el('approve').onclick = () => setApproval(true);
el('unapprove').onclick = () => setApproval(false);

el('form').addEventListener('submit', async event => {
  event.preventDefault();
  const text = el('text').value.trim();
  if (!text || loading || sending) return;
  if (/^ok[.!]?$/i.test(text)) { await setApproval(true, true); return; }
  pendingId ||= crypto.randomUUID();
  const body = { action: 'add', id: pendingId, photo: active.id, revision: version, text, point };
  saveDraft();
  selectionMode(false);
  sending = true;
  syncControls();
  message('Odesílám…');
  try {
    const result = await notesAPI(body);
    if (result.note?.id !== body.id || result.note.photo !== body.photo) throw Error('Chybí potvrzení.');
    el('text').value = '';
    point = pendingId = null;
    drawPoint(null);
    selectionMode(false);
    saveDraft();
    message('Připomínka byla přijata ke zpracování.');
    await loadNotes();
  } catch { message('Přijetí se nepodařilo potvrdit. Text tu zůstává, zkuste jej odeslat znovu.', true); }
  finally { sending = false; syncControls(); }
});

function buildThumbnails() {
  for (const [i, entry] of manifest.photos.entries()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'thumb';
    const img = new Image();
    img.alt = '';
    const title = document.createElement('span');
    title.textContent = (i + 1) + ' · ' + entry.title;
    const mark = document.createElement('span');
    mark.textContent = 'OK';
    mark.className = 'approved-mark';
    mark.hidden = true;
    button.append(img, title, mark);
    button.addEventListener('click', () => showSlide(entry));
    thumbnails.set(entry.id, { button, mark });
    el('thumbnails').append(button);
    photo(entry.thumbnail).then(url => { img.src = url; }).catch(() => {});
  }
}

function markActive() {
  const position = manifest.photos.findIndex(entry => entry.id === active.id);
  el('photo-title').textContent = active.title;
  el('photo-number').textContent = (position + 1) + ' / ' + manifest.photos.length + ' · ' + active.id;
  for (const [id, { button }] of thumbnails) {
    if (id === active.id) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  }
  const strip = el('thumbnails'), button = thumbnails.get(active.id).button;
  const buttonBox = button.getBoundingClientRect(), stripBox = strip.getBoundingClientRect();
  if (buttonBox.left < stripBox.left || buttonBox.right > stripBox.right) {
    strip.scrollLeft += buttonBox.left - stripBox.left - (stripBox.width - buttonBox.width) / 2;
  }
}

function setVersions() {
  const options = [0, ...active.versions.map(v => v.revision)].map(n => new Option(versionName(n), String(n)));
  el('versions').replaceChildren(...options);
  el('versions').hidden = options.length === 1;
  el('version').hidden = options.length > 1;
  el('version').textContent = versionName(version);
  el('versions').value = String(version);
}

async function decode(url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

async function showSlide(selection, number) {
  if (!selection || loading || sending) return false;
  const entry = manifest.photos.find(photo => photo.id === selection.id);
  number ??= latest(entry);
  if (active?.id === entry.id && version === number) return true;
  loading = true;
  syncControls();
  el('figure').setAttribute('aria-busy', 'true');
  try {
    const before = await photo(entry.before);
    const afterFile = entry.versions.find(v => v.revision === number)?.image;
    if (number !== 0 && !afterFile) throw Error();
    const after = afterFile ? await photo(afterFile) : before;
    const [base] = await Promise.all([decode(before), ...(afterFile ? [decode(after)] : [])]);
    active = entry;
    version = number;
    const draft = drafts[slideKey(active.id, version)];
    el('text').value = draft?.text || '';
    point = draft?.point ?? null;
    pendingId = draft?.id || null;
    el('before').src = before;
    el('before').alt = active.title + ' · před úpravou';
    el('before').hidden = !afterFile;
    el('after').src = after;
    el('after').alt = active.title + (afterFile ? ' · po úpravě' : ' · originál');
    el('figure').style.aspectRatio = base.naturalWidth + ' / ' + base.naturalHeight;
    el('split').hidden = el('divider').hidden = !afterFile;
    el('compare-help').textContent = afterFile ? 'Posuňte čáru pro porovnání.' : 'Zobrazen je originál.';
    el('download').href = after;
    el('download').download = 'Moskevska-' + active.id + (afterFile ? '-v' + number : '-original') + '.jpg';
    el('download').hidden = false;
    el('access').hidden = true;
    el('gallery-nav').hidden = el('workspace').hidden = false;
    drawPoint(point);
    selectionMode(false);
    split(33);
    markActive();
    setVersions();
    message('');
    showRecords();
    return true;
  } catch {
    if (active) {
      el('versions').value = String(version);
      message('Fotografii se nepodařilo načíst. Zkuste ji vybrat znovu.', true);
    }
    return false;
  } finally {
    loading = false;
    syncControls();
    el('figure').setAttribute('aria-busy', 'false');
  }
}

function move(delta) {
  const i = manifest.photos.findIndex(entry => entry.id === active.id);
  showSlide(manifest.photos[i + delta]);
}
el('previous').onclick = () => move(-1);
el('next').onclick = () => move(1);
el('versions').onchange = event => showSlide(active, Number(event.target.value));

async function loadManifest() {
  const response = await fetch('revize.json?t=' + Date.now(), { cache: 'no-store' });
  if (!response.ok) throw Error();
  return response.json();
}

async function refresh() {
  if (refreshing || document.hidden || !active) return;
  refreshing = true;
  try {
    const nextManifest = await loadManifest();
    if (loading || sending) return;
    const entry = nextManifest.photos.find(photo => photo.id === active.id);
    if (entry && latest(entry) > latest(active)) {
      const autoOpen = version === latest(active) && !el('text').value.trim() && !point;
      manifest = nextManifest;
      active = entry;
      setVersions();
      if (autoOpen) await showSlide(entry, latest(entry));
    } else {
      manifest = nextManifest;
    }
    await loadNotes();
  } catch {} finally { refreshing = false; }
}

async function start() {
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) {
    el('access').textContent = 'Fotografie se otevírají přes celý sdílený odkaz.';
    return;
  }
  try {
    const bytes = Uint8Array.from(atob(secret.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0));
    mediaKey = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['decrypt']);
    token = b64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode('review:' + secret))));
    manifest = await loadManifest();
    try {
      const saved = JSON.parse(localStorage.getItem(draftKey));
      const legacy = JSON.parse(localStorage.getItem('moskevska-predsin-draft-1'));
      drafts = saved || (legacy?.text ? { [slideKey(manifest.defaultPhoto, legacy.version)]: legacy } : {});
    } catch {}
    buildThumbnails();
    const entry = manifest.photos.find(photo => photo.id === manifest.defaultPhoto);
    if (!await showSlide(entry)) throw Error();
    await loadNotes();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    setInterval(refresh, 60000);
  } catch {
    el('access').textContent = 'Galerii se nepodařilo otevřít. Zkontrolujte celý odkaz a zkuste stránku znovu načíst.';
  }
}
start();
