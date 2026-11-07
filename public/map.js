// ── Tile layers ──────────────────────────────────────────────────────────────
const TILES = {
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
    options: { subdomains: 'abcd', maxZoom: 19 },
    attr: '&copy; <a href="https://openstreetmap.org">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
  },
  osm: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: { subdomains: 'abc', maxZoom: 19 },
    attr: '&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }
};

// ── Init map ─────────────────────────────────────────────────────────────────
const northwest = L.latLng(43, 22.5);
const southeast = L.latLng(42.2, 24);
const bounds = L.latLngBounds(northwest, southeast);

// var crs = new L.Proj.CRS('EPSG:7801',
//   '+proj=lcc +lat_0=42.6678756833333 +lon_0=25.5 +lat_1=42 +lat_2=43.3333333333333 +x_0=500000 +y_0=4725824.3591 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs',
//   {
//     resolutions: [
//       8192, 4096, 2048, 1024, 512, 256, 128
//     ],
//     origin: [0, 0]
//   });

const map = L.map('map',
  { /* crs:crs,*/ zoomControl: true, center: [42.696, 23.321], zoom: 13, maxBounds: bounds, minZoom: 11 }
);

function makeTileLayer(key) {
  const t = TILES[key];
  return L.tileLayer(t.url, { attribution: t.attr, ...t.options });
}

let currentTileKey = 'dark';
let tileLayer = makeTileLayer('dark').addTo(map);

// band style state
const bandStyles = {
  '0-10':  { color: '#00ff00', opacity: 0.05 },
  '10-20': { color: '#00af00', opacity: 0.10 },
  '20-30': { color: '#008500', opacity: 0.15 },
  '30-45': { color: '#004d00', opacity: 0.20 },
  '45-60': { color: '#000546', opacity: 0.25 }
};

function getColor(cost_band) {
  return bandStyles[cost_band]?.color ?? '#800026';
}

function getOpacity(cost_band) {
  return bandStyles[cost_band]?.opacity ?? 1.0;
}

// ---- re-style the existing layer without re-querying ----
// requires: let heatmap = L.geoJSON(...).addTo(map);   (const -> let)
function refreshHeatmapStyle() {
  if (heatmaps.length == 0) return;

  heatmaps.forEach((heatmap) => {heatmap.setStyle(feature => ({
    fillColor:   getColor(feature.properties.cost_band),
    fillOpacity: getOpacity(feature.properties.cost_band)
  }))});
}

// ---- build the sidebar controls ----
function buildBandControls(container = document.getElementById('band-controls')) {
    container.innerHTML = '';

    for (const [band, style] of Object.entries(bandStyles)) {
        const row = document.createElement('div');
        row.className = 'band-row';

        const head = document.createElement('div');
        head.className = 'band-head';

        const name = document.createElement('span');
        name.className = 'band-name';
        name.textContent = `${band} min`;

        const right = document.createElement('div');
        right.className = 'band-controls-right';

        const color = document.createElement('input');
        color.type = 'color';
        color.value = style.color;
        color.addEventListener('input', () => {
            bandStyles[band].color = color.value;
            refreshHeatmapStyle();
        });

        const value = document.createElement('span');
        value.className = 'band-value';
        value.textContent = style.opacity.toFixed(2);

        right.append(color, value);
        head.append(name, right);

        const opacity = document.createElement('input');
        opacity.type = 'range';
        opacity.min = 0;
        opacity.max = 1;
        opacity.step = 0.01;
        opacity.value = style.opacity;
        opacity.addEventListener('input', () => {
            bandStyles[band].opacity = parseFloat(opacity.value);
            value.textContent = bandStyles[band].opacity.toFixed(2);
            refreshHeatmapStyle();
        });

        row.append(head, opacity);
        container.appendChild(row);
    }
}

buildBandControls();

// schedule 
const scheduleType = document.querySelector('input[name="schedule-type"]:checked').value; // mix | work | vac

// ── Markers ──────────────────────────────────────────────────────────────────
const markers = [];
let heatmaps = [];
const hiddeness = []

const customIcon = L.divIcon({
  className: '',
  html: `<div style="
    width:14px; height:14px;
    background:#5cffe4;
    border:2px solid #0d0f14;
    border-radius:50%;
    box-shadow:0 0 8px #5cffe4;
    opacity:.5;
  "></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
  popupAnchor: [0, -10]
});

async function addMarker(latlng) {
  const marker = L.marker(latlng, { icon: customIcon })
    .addTo(map)
    .bindPopup(`<b>${latlng.lat.toFixed(5)}</b><br>${latlng.lng.toFixed(5)}`);

  markers.push(marker);
  hiddeness.push(false);
  updateMarkerList();
  updateInfo();
  setStatus(`Marker placed at ${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`);

  const selected = document.querySelector('input[name="my-group"]:checked');
  let funcGeoApi;
  switch(selected?.value){
    case "byFoot":
      funcGeoApi = GeoApi.byFoot;
      break;
    case "withTransport":
      funcGeoApi = GeoApi.withTransport;
      break;
    case "withTransportWorkers":
      funcGeoApi = GeoApi.withTransportWorkers;
      break;
    default:
      console.log("Error in selection");
  }
  try {
    const starttime = `${document.getElementById('val-hours').textContent}:${document.getElementById('val-minutes').textContent}:00`;
    const time = parseFloat(document.getElementById('val-duration').textContent)
    const data = await funcGeoApi(latlng, time, starttime, scheduleType);  // e.latlng = { lat, lng }
    //console.log(data);
    // const dataRows = data.rows[0];
    // const dataMarker = L.marker(L.latLng(dataRows.stop_lat, dataRows.stop_lon), { icon: customIcon })
    //   .addTo(map)
    //   .bindPopup(`${dataRows.stop_name}`);

    // markers.push(dataMarker);
    // updateMarkerList();
    //updateInfo();
    //setStatus();
    const geojson = data.rows[0].featurecollection;
    console.log(geojson);
    const heatmap = L.geoJSON(geojson, {
      style: feature => ({
        fillColor: getColor(feature.properties.cost_band),
        fillOpacity: getOpacity(feature.properties.cost_band),
        color: '#f200ff',
        weight: 2
      })
    }).addTo(map);
    heatmaps.push(heatmap);
  } catch (err) {
    setStatus(err.message);
    heatmaps.push(null);
  }
}

map.on('click', e => addMarker(e.latlng));

// ── UI updates ────────────────────────────────────────────────────────────────
function updateInfo() {
  const c = map.getCenter();
  document.getElementById('info-center').textContent =
    `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}`;
  document.getElementById('info-zoom').textContent = map.getZoom();
  document.getElementById('info-marker-count').textContent = markers.length;
}

function updateMarkerList() {
  const list = document.getElementById('marker-list');
  list.innerHTML = '';
  markers.forEach((m, i) => {
    const ll = m.getLatLng();
    const el = document.createElement('div');
    el.className = 'marker-item';
    // old marker placer
    // el.innerHTML = `
    //   <span>${ll.lat.toFixed(3)}, ${ll.lng.toFixed(3)}</span>
    //   <button class="marker-interactable" data-index="${i}" title="Remove">✕</button>
    // `;
    el.innerHTML = `
      <span>Heatmap ${i}</span>\n` +
      (!hiddeness[i] ?
        `<button class="marker-interactable marker-invisible" data-index="${i}" title="Invisible">☼</button>\n` :
        `<button class="marker-interactable marker-invisible hidden" data-index="${i}" title="Invisible">☾︎</button>\n`
      ) +
      `<button class="marker-interactable marker-remove" data-index="${i}" title="Remove">✕</button>
    `;
    el.addEventListener('click', e => {
      if (!e.target.classList.contains('marker-interactable')) {
        map.setView(ll, Math.max(map.getZoom(), 8));
        m.openPopup();
      }
    });
    list.appendChild(el);
  });

  list.querySelectorAll('.marker-remove').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const idx = +btn.dataset.index;
      map.removeLayer(markers[idx]);
      if(heatmaps[idx]!== null)map.removeLayer(heatmaps[idx]);
      markers.splice(idx, 1);
      heatmaps.splice(idx,1);
      hiddeness.splice(idx,1);
      updateMarkerList();
      updateInfo();
      setStatus('Marker removed');
    });
  });

  list.querySelectorAll('.marker-invisible').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const idx = +btn.dataset.index;

      if (!hiddeness[idx]) {
        map.removeLayer(markers[idx]);
        if(heatmaps[idx]!== null)map.removeLayer(heatmaps[idx]);
        e.target.classList.add('hidden');
        hiddeness[idx] = true;
        e.target.innerHTML = '☾︎';
      } else {
        map.addLayer(markers[idx]);
        if(heatmaps[idx]!== null)map.addLayer(heatmaps[idx]);
        e.target.classList.remove('hidden');
        hiddeness[idx] = false;
        e.target.innerHTML = '☼';
      }

      updateInfo();
      setStatus('Marker invisble');
    });
  });
}

function setStatus(msg) {
  document.getElementById('last-action').textContent = msg;
}

// Live coordinate display
map.on('mousemove', e => {
  document.getElementById('coords-display').textContent =
    `${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)}`;
});

map.on('zoomend moveend', updateInfo);
map.on('zoom', () => {
  document.getElementById('zoom-display').textContent = `zoom ${map.getZoom()}`;
});

// ── Tile switcher ─────────────────────────────────────────────────────────────
document.querySelectorAll('.tile-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.tile;
    if (key === currentTileKey) return;
    map.removeLayer(tileLayer);
    tileLayer = makeTileLayer(key).addTo(map);
    currentTileKey = key;
    document.querySelectorAll('.tile-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    setStatus(`Switched to ${btn.textContent} tiles`);
  });
});

// ── Sidebar controls ──────────────────────────────────────────────────────────
document.getElementById('btn-locate').addEventListener('click', () => {
  setStatus('Locating…');
  map.locate({ setView: true, maxZoom: 13 });
});

map.on('locationfound', e => {
  addMarker(e.latlng);
  setStatus('Location found');
});

map.on('locationerror', () => setStatus('Location unavailable'));

document.getElementById('btn-clear-markers').addEventListener('click', () => {
  markers.forEach(m => map.removeLayer(m));
  markers.length = 0;
  heatmaps.forEach(h => {if(h !== null){map.removeLayer(h);}});
  heatmaps.length = 0;
  updateMarkerList();
  updateInfo();
  setStatus('All markers cleared');
});

document.getElementById('btn-fit').addEventListener('click', () => {
  if (markers.length === 0) { setStatus('No markers to fit'); return; }
  const group = L.featureGroup(markers);
  map.fitBounds(group.getBounds().pad(0.15));
  setStatus('Fitted to markers');
});
// Time dial
function pad(n) { return String(n).padStart(2, '0'); }

function closeAllDials() {
  document.querySelectorAll('.dial-trigger').forEach(t => t.classList.remove('open'));
  document.querySelectorAll('.dial-dropdown').forEach(d => d.classList.remove('open'));
}

function buildDial(triggerId, dropId, valId, max) {
  const trigger = document.getElementById(triggerId);
  const drop    = document.getElementById(dropId);
  const valEl   = document.getElementById(valId);

  for (let i = 0; i <= max; i++) {
    const opt = document.createElement('div');
    opt.className = 'dial-option';
    opt.textContent = pad(i);
    if (opt.textContent === valEl.textContent) opt.classList.add('selected');
    opt.addEventListener('click', () => {
      valEl.textContent = opt.textContent;
      drop.querySelectorAll('.dial-option').forEach(o => o.classList.toggle('selected', o === opt));
      closeAllDials();
    });
    drop.appendChild(opt);
  }

  trigger.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = trigger.classList.contains('open');
    closeAllDials();
    if (!isOpen) {
      trigger.classList.add('open');
      drop.classList.add('open');
      drop.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
    }
  });
}

buildDial('trigger-hours',   'drop-hours',   'val-hours',   26);
buildDial('trigger-minutes', 'drop-minutes', 'val-minutes', 59);
buildDial('trigger-duration', 'drop-duration', 'val-duration', 60);

document.addEventListener('click', closeAllDials);

// ── Init ──────────────────────────────────────────────────────────────────────
updateInfo();
