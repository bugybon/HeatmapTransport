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
  fromPoint: ({ lat, lng }) =>
    request(`/geo?lat=${lat}&lng=${lng}`),
  byFoot:({lat,lng}) =>
    request(`/byfoot?lat=${lat}&lng=${lng}&time=${20.0}`),
  withTransport:({lat,lng})=>
    request(`/withtransport?lat=${lat}&lng=${lng}&time=${20.0}&starttime=${"08:00:00"}`),
  withTransportWorkers:({lat,lng})=>
    request(`/withtransportworkers?lat=${lat}&lng=${lng}&time=${20.0}&starttime=${"08:00:00"}`)
};