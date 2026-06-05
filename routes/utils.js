const pool = require('../db/pool');

async function heatmapByFoot(lat, lng, time) {
    const ongrid = await pool.query(
        `SELECT *
        FROM ped_edges_vertices_pgr pe 
        ORDER BY pe.the_geom  <-> ST_Transform(ST_SetSRID(ST_MakePoint($1, $2), 4326),7801)
        LIMIT 1;`,
        [lng, lat]);

    // call your data source here — database, third-party API, etc.
    const result = await pool.query(
        `    
        SELECT
            dd.node,
            dd.agg_cost,
            ST_AsGeoJSON(ST_Transform(pev.the_geom, 4326)) AS geojson
        FROM pgr_drivingDistance(
            'Select id,source, target, minutes as cost, -1 as reverse_cost 
            from ped_edges'::text,
            $1::bigint,   -- now accessible via LATERAL
            $2::decimal,
            false
        ) dd
        JOIN ped_edges_vertices_pgr pev ON dd.node = pev.id
        WHERE dd.edge != -1
        `,
        // `select pev1.the_geom, pev1.id,
        //     st_asgeojson(st_concavehull(st_collect(st_transform(pev.the_geom,4326)),0.1, true)) as geojson
        // from ped_edges_vertices_pgr pev1,
        //     lateral(
        //     SELECT * FROM pgr_drivingDistance(
        //             'Select id,source, target, minutes as cost, -1 as reverse_cost 
        //             from ped_edges',
        //             pev1.id,   -- now accessible via LATERAL
        //             60.0,
        //             false
        //         )
        //     ) t
        // JOIN ped_edges_vertices_pgr pev ON t.node = pev.id
        // where pev1.id=$1
        // group by pev1.id;`,
        [ongrid.rows[0].id, time]);
    return result;
}

// Step 2 — get available trips from a transit stop
async function getTripsFromStop(stopId,startTime, accumulatedCost,maxWalkCost, depth) {
    const { rows } = await pool.query(`
            SELECT DISTINCT
                sst.trip_id,
                sst.arrival_time,
                EXTRACT(EPOCH FROM (
                    sst.arrival_time - ($2::interval + ($3 || ' minutes')::interval)
                )) / 60.0 AS wait_minutes
            FROM spt_stop_times sst
            WHERE sst.stop_id = $1
              AND sst.arrival_time > ($2::interval + ($3 || ' minutes')::interval)
              and sst.arrival_time < ($2::interval + ($4 || ' minutes')::interval)
            ORDER BY sr.route_id, pe.arrival_time
        `, [stopId, startTime, accumulatedCost, maxWalkCost]);

    return rows.map(row => ({
        node: stopId,
        tripId: row.trip_id,
        accumulatedCost: accumulatedCost + parseFloat(row.wait_minutes),
        depth
    }));
}

// Step 3 — ride transit to next stop
async function rideToStop(stopId,maxWalkCost, tripId, accumulatedCost, depth) {
    const { rows } = await pool.query(`
            SELECT
                dd.node,
                dd.agg_cost,
                s.ogc_fid        AS stop_id,
                s.id_ped_vertex  AS ped_vertex
            FROM pgr_drivingDistance(
                'SELECT id, id_source AS source, id_target AS target,
                        EXTRACT(epoch FROM travel_time)/60.0 AS cost
                 FROM pt_edges
                 WHERE trip_id = ''' || $3 || '''',
                $1::bigint, $2::float,
                directed := true
            ) dd
            JOIN spt_stops s ON s.ogc_fid = dd.node
            WHERE dd.edge != -1
        `, [stopId, maxWalkCost - accumulatedCost, tripId]);

    return rows.map(row => ({
        stopId: row.stop_id,
        pedVertex: row.ped_vertex,
        accumulatedCost: accumulatedCost + parseFloat(row.agg_cost),
        depth: depth + 1
    }));
}

async function recursiveDrivingDistance(startNode, startTime, maxWalkCost, maxDepth = 5) {
    const visited = new Set();  // visited transit stops (ogc_fid)
    const walkVisited = new Set();  // visited ped vertices
    const results = new Map();  // node_id -> { node, totalCost }

    // Step 1 — walk from start ped vertex to nearby transit stops
    async function walkToStops(pedVertexId, accumulatedCost, depth) {
        const res = await pool.query(
        `    
        SELECT
            dd.node,
            dd.agg_cost
        FROM pgr_drivingDistance(
            'Select id,source, target, minutes as cost, -1 as reverse_cost 
            from ped_edges'::text,
            $1::bigint,   -- now accessible via LATERAL
            $2::float,
            false
        ) dd
        JOIN ped_edges_vertices_pgr pev ON dd.node = pev.id
        WHERE dd.edge != -1
        `,
        [pedVertexId, maxDepth-accumulatedCost]);
        
        for (const row of res.rows) {
            const totalCost = accumulatedCost + parseFloat(row.agg_cost);
            if (!results.has(row.node) || results.get(row.node).totalCost > totalCost) {
                results.set(row.node, { node: row.node, totalCost });
            }
        }

        const { rows } = await pool.query(`
            SELECT
                dd.node,
                dd.agg_cost,
                s.ogc_fid   AS stop_id,
                s.wkb_geometry
            FROM pgr_drivingDistance(
                'SELECT id, source, target, minutes as cost FROM ped_edges',
                $1::bigint, $2::float,
                false
            ) dd
            JOIN spt_stops s ON s.id_ped_vertex = dd.node
            WHERE dd.edge != -1
        `, [pedVertexId, maxWalkCost - accumulatedCost]);

        // store walk results

        return rows.map(row => ({
            stopId: row.stop_id,
            pedVertex: row.node,
            accumulatedCost: accumulatedCost + parseFloat(row.agg_cost),
            depth
        }));
    }
    // --- main loop ---

    // initial walk from start node
    let stopQueue = await walkToStops(startNode, 0, 0);

    while (stopQueue.length > 0) {
        const nextStopQueue = [];

        for (const { stopId, pedVertex, accumulatedCost, depth } of stopQueue) {
            if (visited.has(stopId) || depth >= maxDepth) continue;
            visited.add(stopId);

            // get available trips from this stop
            const trips = await getTripsFromStop(stopId, startTime,accumulatedCost, depth);

            for (const trip of trips) {
                // ride to reachable stops on this trip
                const arrivedStops = await rideToStop(
                    trip.node,
                    maxWalkCost,
                    trip.tripId,
                    trip.accumulatedCost,
                    depth + 1
                );

                for (const arrived of arrivedStops) {
                    if (visited.has(arrived.stopId)) continue;

                    // walk from arrived stop to nearby stops
                    if (arrived.pedVertex && !walkVisited.has(arrived.pedVertex)) {
                        walkVisited.add(arrived.pedVertex);

                        const newStops = await walkToStops(
                            arrived.pedVertex,
                            arrived.accumulatedCost,
                            depth + 1
                        );
                        nextStopQueue.push(...newStops);
                    }

                    nextStopQueue.push(arrived);
                }
            }
        }

        stopQueue = nextStopQueue;
    }

    // return array of { node, totalCost } pairs from all walk queries
    console.log({rows:[...results.values()].map(({node, totalCost}) => ({ node:node, agg_cost: totalCost }))});
    return {rows: [...results.values()].map(({node, totalCost}) => ({ node:node, agg_cost: totalCost }))};
}

async function getNextDeparture(nodeId, startTime, currentCost) {
    // Add currentCost (minutes) to startTime to get arrival time at this node
    const arrivalTime = await pool.query(`
        SELECT ($1::interval + ($2 || ' minutes')::interval)::time AS arrival_time
    `, [startTime, currentCost]);

    const arrival = arrivalTime.rows[0].arrival_time;

    const result = await pool.query(`
        SELECT DISTINCT ON (sr.route_id)
            t.trip_id,
            sr.route_short_name,
            pe.arrival_time,
            sr.route_id,
            pe.id_target,
            EXTRACT(EPOCH FROM (pe.arrival_time - $2::time)) / 60.0 AS wait_minutes
        FROM pt_edges pe
        JOIN spt_trips t  ON pe.trip_id = t.trip_id
        JOIN spt_routes sr ON t.route_id = sr.route_id
        WHERE pe.id_source = $1
          AND pe.arrival_time > $2::time
        ORDER BY sr.route_id, pe.arrival_time
    `, [nodeId, arrival]);

    if (result.rows.length === 0) return null;  // no more departures

    // Return updated queue entries — one per available route
    return result.rows.map(row => ({
        node: row.id_target,
        accumulatedCost: currentCost + parseFloat(row.wait_minutes),
        tripId: row.trip_id,
        route: row.route_short_name,
        departureTime: row.arrival_time
    }));
}

async function heatmapWithTransport(lat, lng, time, starttime) {
    const ongrid = await pool.query(
        `SELECT *
        FROM ped_edges_vertices_pgr pe 
        ORDER BY pe.the_geom  <-> ST_Transform(ST_SetSRID(ST_MakePoint($1, $2), 4326),7801)
        LIMIT 1;`,
        [lng, lat]);

    return recursiveDrivingDistance(ongrid.rows[0].id,starttime,time)
    
}

module.exports = { heatmapByFoot, heatmapWithTransport };