const el = id => document.getElementById(id);
const frame = el('frame'), slider = el('slider'), statusText = el('status');
let key, photos, selected = 0, revision = 0;
const tiles = [], assets = new Map();
function asset(id, variant) {
  const file = 'media/' + id + '-' + variant + '.bin';
  if (!assets.has(file)) assets.set(file, (async () => {
    const response = await fetch(file);
    if (!response.ok) throw Error('fetch');
    const bytes = new Uint8Array(await response.arrayBuffer());
    const data = await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12)}, key, bytes.slice(12));
    return URL.createObjectURL(new Blob([data], {type:'image/jpeg'}));
  })().catch(error => { assets.delete(file); throw error; }));
  return assets.get(file);
}
function setSlider(value) {
  slider.value = value;
  frame.style.setProperty('--pos', value + '%');
}
slider.addEventListener('input', () => setSlider(slider.value));
async function show(i, scroll = false) {
  if (!photos || i < 0 || i >= photos.length) return;
  const token = ++revision;
  selected = i;
  if (scroll) document.querySelector('.toolbar').scrollIntoView({block:'start'});
  el('prev').disabled = i === 0;
  el('next').disabled = i === photos.length - 1;
  el('count').textContent = (i+1) + ' / ' + photos.length;
  el('label').textContent = photos[i].label;
  tiles.forEach((tile,n) => tile.setAttribute('aria-current', n === i ? 'true' : 'false'));
  frame.hidden = true;
  el('hint').hidden = true;
  statusText.hidden = false;
  statusText.textContent = 'Načítám záběr…';
  try {
    const [a,b] = await Promise.all([asset(i,'a'),asset(i,'b')]);
    if (token !== revision) return;
    el('before').src = a;
    el('after').src = b;
    await Promise.all([el('before').decode(),el('after').decode()]);
    if (token !== revision) return;
    setSlider(50);
    frame.hidden = false;
    el('hint').hidden = false;
    statusText.hidden = true;
  } catch {
    if (token === revision) statusText.textContent = 'Záběr se nepodařilo načíst. Otevři celý odkaz ze zprávy ještě jednou.';
  }
}
el('prev').onclick = () => show(selected-1);
el('next').onclick = () => show(selected+1);
async function init() {
  try {
    const raw = new URLSearchParams(location.hash.slice(1)).get('k');
    if (!raw || !/^[A-Za-z0-9_-]{43}$/.test(raw)) throw Error('key');
    key = await crypto.subtle.importKey('raw',Uint8Array.from(atob(raw.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0)),{name:'AES-GCM'},false,['decrypt']);
    const response = await fetch('photos.json');
    if (!response.ok) throw Error('index');
    photos = await response.json();
    let group = '', grid;
    const observer = new IntersectionObserver(entries => entries.filter(e=>e.isIntersecting).forEach(({target})=>{
      observer.unobserve(target);
      asset(target.dataset.id,'t').then(url=>target.src=url).catch(()=>{});
    }),{rootMargin:'250px'});
    photos.forEach(({label,group:g},i)=>{
      if (group !== g) {
        group = g;
        const heading = document.createElement('h2');
        heading.textContent = g === 'Dron' ? 'Drony' : 'Interiéry';
        grid = document.createElement('div'); grid.className = 'grid';
        el('groups').append(heading,grid);
      }
      const tile = document.createElement('button'), preview = document.createElement('img'), name = document.createElement('span');
      tile.className = 'tile'; preview.alt = ''; preview.dataset.id = i;
      name.textContent = label; tile.append(preview,name); grid.append(tile);
      tiles.push(tile); tile.onclick = () => show(i,true); observer.observe(preview);
    });
    await show(0);
  } catch { statusText.textContent = 'Pro otevření galerie použij celý odkaz ze zprávy.'; }
}
init();
