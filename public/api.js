const BASE_URL = '/api';

async function request(path) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const GeoApi = {
  // pass a Leaflet latlng object directly: map.on('click', e => GeoApi.fromPoint(e.latlng))
  fromPoint: ({ lat, lng}, time, starttime ) =>
    request(`/geo?lat=${lat}&lng=${lng}`),
  byFoot:({lat,lng},time,starttime) =>
    request(`/byfoot?lat=${lat}&lng=${lng}&time=${time}`),
  withTransport:({lat,lng},time,starttime)=>
    request(`/withtransport?lat=${lat}&lng=${lng}&time=${time}&starttime=${starttime}`),
  withTransportWorkers:({lat,lng},time,starttime)=>
    request(`/withtransportworkers?lat=${lat}&lng=${lng}&time=${time}&starttime=${starttime}`)
};