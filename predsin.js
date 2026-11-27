const state = document.getElementById('state');
const reverse = new URLSearchParams(location.search).get('foto') === 'P1194546';
const id = reverse ? 'P1194546' : 'P1194521';
const secret = new URLSearchParams(location.hash.slice(1)).get('k') || '';
if (reverse) document.getElementById('title').textContent = 'Předsíň z druhé strany · Moskevská';

async function load() {
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) {
    state.textContent = 'Otevřete celý sdílený odkaz.';
    return;
  }
  try {
    const bytes = Uint8Array.from(atob(secret.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0));
    const key = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['decrypt']);
    const manifest = await fetch('revize.json', { cache: 'no-store' });
    if (!manifest.ok) throw Error();
    const { photos } = await manifest.json();
    const version = photos.find(photo => photo.id === id)?.versions.at(-1);
    if (!version) throw Error();
    const response = await fetch('media/' + encodeURIComponent(version.image));
    if (!response.ok) throw Error();
    const data = new Uint8Array(await response.arrayBuffer());
    const clear = await crypto.subtle.decrypt({
      name: 'AES-GCM', iv: data.subarray(0,12), additionalData: new TextEncoder().encode(version.image)
    }, key, data.subarray(12));
    const url = URL.createObjectURL(new Blob([clear], { type: 'image/jpeg' }));
    const file = document.getElementById('file');
    const preview = document.getElementById('preview');
    file.href = preview.src = url;
    file.download = reverse ? 'Moskevska-predsin-opacny-pohled.jpg' : 'Moskevska-upravena-predsin.jpg';
    state.hidden = true;
    file.hidden = preview.hidden = false;
  } catch {
    state.textContent = 'Fotografii se nepodařilo načíst. Obnovte stránku a zkuste to znovu.';
  }
}

load();
