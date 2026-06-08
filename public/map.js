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

function getColor(cost_band) {
    const colors = {
        '0-10':  '#FFEDA0',
        '10-20': '#FEB24C',
        '20-30': '#FD8D3C',
        '30-45': '#FC4E2A',
        '45-60': '#E31A1C'
    };
    return colors[cost_band] ?? '#800026';
}

// ── Markers ──────────────────────────────────────────────────────────────────
const markers = [];
const heatmaps = [];

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
    case "withTransportHoliday":
      funcGeoApi = GeoApi.withTransportHoliday;
      break;
    default:
      console.log("Error in selection");
  }
  try {
    const data = await funcGeoApi(latlng);  // e.latlng = { lat, lng }
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
        fillOpacity: 0.1,
        color: '#fff',
        weight: 1
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
      <span>Heatmap ${i}</span>
      <button class="marker-interactable marker-invisible" data-index="${i}" title="Invisible">☼</button>
      <button class="marker-interactable marker-remove" data-index="${i}" title="Remove">✕</button>
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
      map.removeLayer(heatmaps[idx]);
      markers.splice(idx, 1);
      heatmaps.splice(idx,1);
      updateMarkerList();
      updateInfo();
      setStatus('Marker removed');
    });
  });

  list.querySelectorAll('.marker-invisible').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const idx = +btn.dataset.index;

      if (!e.target.classList.contains('hidden')) {
        map.removeLayer(markers[idx]);
        if(heatmaps[idx]!== null)map.removeLayer(heatmaps[idx]);
        e.target.classList.add('hidden');
        e.target.innerHTML = '☾︎';
      } else {
        map.addLayer(markers[idx]);
        if(heatmaps[idx]!== null)map.addLayer(heatmaps[idx]);
        e.target.classList.remove('hidden');
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

// ── Init ──────────────────────────────────────────────────────────────────────
updateInfo();
