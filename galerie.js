const el = id => document.getElementById(id);
const api = 'https://fd-moskevska-pripominky-1c7a.netlify.app/.netlify/functions/notes';
const encoder = new TextEncoder();
const fragment = new URLSearchParams(location.hash.slice(1));
const secret = fragment.get('k') || '';
const cache = new Map();
const stateNames = { new: 'Přijato', done: 'Hotovo', question: 'K upřesnění' };
const storeName = 'moskevska-predsin-draft-1';
let mediaKey, token, manifest, version, point = null, selecting = false, selectedId = null, pendingId = null;
let displayRequest = 0;

function message(text, error = false) {
  el('notice').classList.toggle('error', error);
  el('notice').textContent = text;
}
const b64 = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
async function photo(file) {
  if (!cache.has(file)) {
    const request = (async () => {
      const response = await fetch('media/' + encodeURIComponent(file));
      if (!response.ok) throw Error('Soubor se nepodařilo načíst.');
      const bytes = new Uint8Array(await response.arrayBuffer());
      const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0,12), additionalData: encoder.encode(file) }, mediaKey, bytes.subarray(12));
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
  el('leftTag').hidden = position < 8;
  el('rightTag').hidden = position > 92;
}
function relative(event) {
  const rect = el('figure').getBoundingClientRect();
  const norm = (v, side) => Math.max(0, Math.min(1000, Math.round(1000 * v / side)));
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
el('split').addEventListener('pointerup', event => {
  if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
});

function saveDraft() {
  try { localStorage.setItem(storeName, JSON.stringify({ text: el('text').value, point, id: pendingId, version })); } catch {}
}
function drawPoint(p) {
  el('marker').hidden = !p;
  if (p) {
    el('marker').style.left = p.x / 10 + '%';
    el('marker').style.top = p.y / 10 + '%';
  }
}
function selectionMode(active) {
  selecting = active;
  el('point').setAttribute('aria-pressed', String(active));
  el('point-label').textContent = active ? 'Klikněte na místo ve fotce' : point ? 'Změnit označené místo' : 'Označit místo ve fotce';
  el('drop-point').hidden = !point && !active;
  el('pick').hidden = !active;
  el('split').disabled = active;
}
function pick(p) {
  point = p; selectedId = null; pendingId = null;
  drawPoint(p); selectionMode(false); saveDraft(); el('text').focus();
}
el('point').addEventListener('click', () => {
  selectedId = null; selectionMode(!selecting);
  if (selecting) { el('figure').scrollIntoView({ block: 'nearest' }); el('pick').focus({ preventScroll: true }); }
});
el('pick').addEventListener('click', event => pick(event.detail ? relative(event) : { x: 500, y: 500 }));
el('drop-point').addEventListener('click', () => pick(null));
document.addEventListener('keydown', event => { if (event.key === 'Escape' && selecting) { selectionMode(false); el('point').focus(); } });
el('text').addEventListener('input', () => { pendingId = null; saveDraft(); });

function row(note) {
  const item = document.createElement('article'), text = document.createElement('p'), info = document.createElement('small');
  item.className = 'note';
  text.textContent = note.text;
  const stamp = new Date(note.created).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
  info.textContent = (stateNames[note.state] || 'Přijato') + ' · verze ' + (note.version || note.revision) + ' · ' + stamp;
  item.append(text, info);
  if (note.point) {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'text-action'; btn.textContent = 'Ukázat místo';
    btn.onclick = async () => {
      selectionMode(false);
      if (version !== note.revision && manifest.versions.some(v => v.revision === note.revision)) {
        try { await showVersion(note.revision); } catch { message('Verzi se nepodařilo načíst.', true); return; }
      }
      selectedId = note.id; drawPoint(note.point); el('figure').scrollIntoView({ block: 'nearest' });
    };
    item.append(btn);
  }
  if (note.answer) {
    const answer = document.createElement('p'); answer.className = 'answer'; answer.textContent = 'Studio · ' + note.answer;
    item.append(answer);
  }
  return item;
}
async function loadNotes() {
  try {
    const result = await notesAPI();
    if (result.notes.length) el('notes').replaceChildren(...result.notes.map(row));
    else { const blank = document.createElement('p'); blank.textContent = 'Zatím tu žádné nejsou.'; el('notes').replaceChildren(blank); }
    el('retry').hidden = true;
  } catch {
    if (!el('notes').querySelector('.note')) el('notes').textContent = 'Přehled se nepodařilo načíst.';
    el('retry').hidden = false;
  }
}
el('retry').addEventListener('click', loadNotes);

function setVersions() {
  const options = manifest.versions.map(v => new Option('Verze ' + v.revision, String(v.revision)));
  el('versions').replaceChildren(...options);
  el('versions').hidden = options.length === 1;
  el('version').hidden = options.length > 1;
  if (version) el('versions').value = String(version);
}
let checking = false;
async function refresh() {
  if (checking || document.hidden) return;
  checking = true;
  try {
    const response = await fetch('revize.json?t=' + Date.now(), { cache: 'no-store' });
    if (response.ok) {
      const next = await response.json();
      const previousLatest = manifest.versions.at(-1).revision;
      const latest = next.versions.at(-1).revision;
      if (latest > previousLatest) {
        manifest = next; setVersions();
        if (version === previousLatest && !el('text').value.trim() && !point && !el('submit').disabled) await showVersion(latest);
      }
    }
  } catch {} finally { await loadNotes(); checking = false; }
}

el('form').addEventListener('submit', async event => {
  event.preventDefault();
  const text = el('text').value.trim();
  if (!text || el('submit').disabled) { if (!text) el('text').focus(); return; }
  pendingId ||= crypto.randomUUID();
  const body = { action: 'add', id: pendingId, revision: version, text, point };
  saveDraft(); selectionMode(false);
  el('submit').disabled = el('text').disabled = el('point').disabled = el('drop-point').disabled = el('versions').disabled = true;
  message('Odesílám…');
  try {
    const result = await notesAPI(body);
    if (result.note?.id !== body.id) throw Error('Chybí potvrzení.');
    el('text').value = ''; point = selectedId = pendingId = null;
    drawPoint(null); selectionMode(false); saveDraft();
    message('Připomínka byla přijata ke zpracování.');
    await loadNotes();
  } catch { message('Přijetí se nepodařilo potvrdit. Text tu zůstává, zkuste jej odeslat znovu.', true); }
  finally { el('submit').disabled = el('text').disabled = el('point').disabled = el('drop-point').disabled = el('versions').disabled = false; }
});

async function showVersion(number) {
  const request = ++displayRequest;
  const record = manifest.versions.find(v => v.revision === number);
  const [before, after] = await Promise.all([photo(manifest.before), photo(record.image)]);
  if (request !== displayRequest) return;
  el('before').src = before; el('after').src = after;
  await Promise.all([el('before').decode(), el('after').decode()]);
  if (request !== displayRequest) return;
  version = number;
  el('version').textContent = 'Verze ' + number; el('versions').value = String(number);
  el('download').href = after; el('download').download = 'Moskevska-P1194521-v' + number + '.jpg'; el('download').hidden = false;
}
el('versions').addEventListener('change', async event => {
  const next = Number(event.target.value);
  try { await showVersion(next); pendingId = null; drawPoint(point); saveDraft(); }
  catch { el('versions').value = String(version); message('Verzi se nepodařilo načíst.', true); }
});
async function start() {
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) { el('access').textContent = 'Fotografie se otevírá přes celý sdílený odkaz.'; return; }
  try {
    const bytes = Uint8Array.from(atob(secret.replaceAll('-','+').replaceAll('_','/')), char => char.charCodeAt(0));
    mediaKey = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['decrypt']);
    token = b64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode('review:' + secret))));
    const response = await fetch('revize.json', { cache: 'no-store' });
    if (!response.ok) throw Error();
    manifest = await response.json();
    let draft;
    try { draft = JSON.parse(localStorage.getItem(storeName)); } catch {}
    const all = manifest.versions.map(v => v.revision);
    const initial = draft?.text?.trim() && all.includes(draft.version) ? draft.version : all.at(-1);
    setVersions();
    await showVersion(initial);
    if (draft?.text) { el('text').value = draft.text; point = draft.point || null; pendingId = draft.id || null; }
    drawPoint(point); selectionMode(false); split(33);
    el('access').hidden = true; el('workspace').hidden = false;
    await loadNotes();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    setInterval(refresh, 60000);
  } catch { el('access').textContent = 'Porovnání se nepodařilo otevřít. Zkontrolujte celý odkaz a zkuste stránku znovu načíst.'; }
}
start();
