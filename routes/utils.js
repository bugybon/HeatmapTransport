const pool = require('../db/pool');
const { Worker } = require('node:worker_threads');
const path = require('node:path');

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
async function getTripsFromStop(stopId, startTime, accumulatedCost, maxWalkCost, depth) {
    const { rows } = await pool.query(`
            SELECT DISTINCT
                sst.trip_id,
                sst.arrival_time,
                EXTRACT(EPOCH FROM (
                    sst.arrival_time - ($2::interval + ($3::float || ' minutes')::interval)
                )) / 60.0 AS wait_minutes
            FROM spt_stop_times sst
            join spt_stops ss on ss.stop_id = sst.stop_id
            WHERE ss.ogc_fid = $1::int
              AND sst.arrival_time > ($2::interval + ($3::float || ' minutes')::interval)
              and sst.arrival_time < ($2::interval + ($4::float || ' minutes')::interval)
            ORDER BY sst.arrival_time
        `, [stopId, startTime, accumulatedCost, maxWalkCost]);

    return rows.map(row => ({
        node: stopId,
        tripId: row.trip_id,
        accumulatedCost: accumulatedCost + parseFloat(row.wait_minutes),
        depth
    }));
}

// Step 3 — ride transit to next stop
async function rideToStop(stopId, maxWalkCost, tripId, accumulatedCost, depth) {
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
        depth: depth
    }));
}

async function recursiveDrivingDistance(startNode, startTime, maxWalkCost, maxDepth = 5) {
    const visited = new Set();  // visited transit stops (ogc_fid)
    const walkVisited = new Set();  // visited ped vertices
    const results = new Map();  // node_id -> { node, totalCost }

    // Step 1 — walk from start ped vertex to nearby transit stops

    async function walkToStops(pedVertexId, accumulatedCost, depth) {
        const { rows } = await pool.query(`
            SELECT
                dd.node,
                dd.agg_cost,
                s.ogc_fid        AS stop_id,   -- null if no stop at this vertex
                s.wkb_geometry   AS stop_geom
            FROM pgr_drivingDistance(
                'SELECT id, source, target, minutes AS cost, -1 AS reverse_cost
                FROM ped_edges'::text,
                $1::bigint,
                $2::decimal,
                false
            ) dd
            LEFT JOIN spt_stops s ON s.id_ped_vertex = dd.node  -- left join keeps all vertices
            WHERE dd.edge != -1
        `, [pedVertexId, maxWalkCost - accumulatedCost]);

        // update walk results map (all vertices)
        for (const row of rows) {
            const totalCost = accumulatedCost + parseFloat(row.agg_cost);
            if (!results.has(row.node) || results.get(row.node).totalCost > totalCost) {
                results.set(row.node, { node: row.node, totalCost });
            }
        }

        // return only rows that have a stop (stop_id not null)
        return rows
            .filter(row => row.stop_id !== null)
            .map(row => ({
                stopId: row.stop_id,
                pedVertex: row.node,
                accumulatedCost: accumulatedCost + parseFloat(row.agg_cost),
                depth
            }));
    }
    // --- main loop ---

    // initial walk from start node
    let stopQueue = await walkToStops(startNode, 0, 0);
    //console.log("stopsReachable:" + stopQueue.length)
    while (stopQueue.length > 0) {
        const nextStopQueue = [];

        for (const { stopId, pedVertex, accumulatedCost, depth } of stopQueue) {
            if (visited.has(stopId) || depth >= maxDepth) continue;
            visited.add(stopId);

            // get available trips from this stop
            const trips = await getTripsFromStop(stopId, startTime, accumulatedCost, maxWalkCost, depth);
            //console.log("trips:" + trips.length);
            for (const trip of trips) {
                // ride to reachable stops on this trip
                const arrivedStops = await rideToStop(
                    trip.node,
                    maxWalkCost,
                    trip.tripId,
                    trip.accumulatedCost,
                    trip.depth + 1
                );
                //console.log("Arrived Stops: " + arrivedStops.length)
                for (const arrived of arrivedStops) {
                    //console.log("testing stopID:" + arrived.pedVertex);
                    if (visited.has(arrived.stopId)) continue;

                    // walk from arrived stop to nearby stops
                    if (arrived.pedVertex) {
                        //walkVisited.add(arrived.pedVertex);
                        //console.log("from stopID:" + arrived.pedVertex);
                        const newStops = await walkToStops(
                            arrived.pedVertex,
                            arrived.accumulatedCost,
                            arrived.depth + 1
                        );
                        nextStopQueue.push(...newStops);
                    }

                    nextStopQueue.push(arrived);
                }
            }
        }

        stopQueue = [...nextStopQueue];
    }

    // return array of { node, totalCost } pairs from all walk queries
    console.log({ rows: [...results.values()].map(({ node, totalCost }) => ({ node: node, agg_cost: totalCost })) });
    return { rows: [...results.values()].map(({ node, totalCost }) => ({ node: node, agg_cost: totalCost })) };
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

    return recursiveDrivingDistance(ongrid.rows[0].id, starttime, time)

}

function spawnWorker(data) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(path.resolve(__dirname, './workers.js'), {
            workerData: {
                ...data,
                connectionString: process.env.DATABASE_URL
            }
        });
        worker.on('message', resolve);
        worker.on('error', (err) => {
            console.error('worker error', err);  // catch spawn errors
            reject(err);
        });
        worker.on('exit', (code) => {
            if (code !== 0) reject(new Error(`worker exited with code ${code}`));
        });
    });
}

function spawnTripWorker(data) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(path.resolve(__dirname, 'workerride.js'), {
            workerData: { ...data }
        });
        worker.on('message', resolve);
        worker.on('error', reject);
        worker.on('exit', code => {
            if (code !== 0) reject(new Error(`trip worker exited with code ${code}`));
        });
    });
}

function spawnWalkWorker(data) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(path.resolve(__dirname, 'workerwalk.js'), {
            workerData: { ...data }
        });
        worker.on('message', resolve);
        worker.on('error', reject);
        worker.on('exit', code => {
            if (code !== 0) reject(new Error(`walk worker exited with code ${code}`));
        });
    });
}

const BATCH_SIZE = 32;

async function processInBatches(stops, workerFn, concurrency, onResult) {
    const results = [];

    for (let i = 0; i < stops.length; i += BATCH_SIZE) {
        const batch = stops.slice(i, i + BATCH_SIZE);

        try {
            const batchResults = await runWithConcurrencyLimit(
                batch.map(stop => () => workerFn(stop)),
                concurrency
            );

            // process each result immediately instead of collecting
            for (const result of batchResults) {
                onResult(result);  // handle result inline
            }
            batchResults.length = 0;
        } catch (err) {
            batch.length = 0;
            throw err;  // propagate up to the while loop catch
        }

        batch.length = 0;
    }

    return results;
}


async function runWithConcurrencyLimit(tasks, limit) {
    const results = [];
    const executing = new Set();
    let aborted = false;
    let abortError = null;

    for (const task of tasks) {
        if (aborted) break;  // stop spawning new workers

        const p = Promise.resolve().then(() => {
            if (aborted) return null;
            return task();
        });

        const tracked = p.then(result => {
            executing.delete(tracked);
            return result;
        }).catch(err => {
            executing.delete(tracked);
            aborted = true;       // signal all future tasks to stop
            abortError = err;
            return null;          // don't rethrow here, handle below
        });

        executing.add(tracked);
        results.push(tracked);

        if (executing.size >= limit) {
            await Promise.race(executing);
            if (aborted) break;   // stop waiting if error occurred
        }
    }

    await Promise.all(executing);  // wait for in-flight workers to finish

    if (aborted) throw abortError; // rethrow the original error

    return Promise.all(results);
}

const INITIAL_WALK_BUDGET = 20;

async function recursiveDrivingDistanceWorkers(startNode, startTime, maxWalkCost, maxDepth = 5) {
    const visited = new Set();   // visited transit stops
    const walkVisited = new Set();   // visited ped vertices
    const results = new Map();   // ped_vertex -> { node, totalCost }
    let aborted = false;


    // initial walk from start node — run directly, not in worker
    const { rows: initRows } = await pool.query(`
        SELECT
            dd.node,
            dd.agg_cost,
            s.ogc_fid       AS stop_id,
            s.wkb_geometry  AS stop_geom
        FROM pgr_drivingDistance(
            'SELECT id, source, target, minutes AS cost, -1 AS reverse_cost
            FROM ped_edges'::text,
            $1::bigint, $2::decimal, false
        ) dd
        LEFT JOIN spt_stops s ON s.id_ped_vertex = dd.node
        WHERE dd.edge != -1
    `, [startNode, Math.min(maxWalkCost, INITIAL_WALK_BUDGET)]);

    // seed results and first stop queue
    let stopQueue = [];
    for (const row of initRows) {
        const totalCost = parseFloat(row.agg_cost);
        results.set(row.node, { node: row.node, totalCost });
        walkVisited.add(row.node);

        if (row.stop_id && !visited.has(row.stop_id)) {
            //visited.add(row.stop_id);
            stopQueue.push({
                stopId: row.stop_id,
                pedVertexId: row.node,
                accumulatedCost: totalCost,
                startTime,
                maxWalkCost,
                depth: 1
            });
        }
    }

    // ── depth loop ────────────────────────────────────────────────────────────
    while (stopQueue.length > 0 && stopQueue[0].depth < maxDepth) {

        // deduplicate before spawning — no wasted workers
        const toProcess = stopQueue.filter(s => {
            if (visited.has(s.stopId)) return false;
            visited.add(s.stopId);
            return true;
        });

        const nextStopQueue = [];

        // all stops at this depth level run in parallel
        try {
            const nextStopsMap = new Map();

            console.log(`spawning ${toProcess.length} ride workers at depth ${stopQueue[0]?.depth}`);

            await processInBatches(toProcess, spawnTripWorker, 8, (result) => {
                console.log('trip onResult nextStops:', result?.nextStops?.length);
                if (!Array.isArray(result)) return;

                for (const stop of result) {
                    if (!stop.pedVertex) continue;
                    if (walkVisited.has(stop.pedVertex)) continue;

                    const existing = nextStopsMap.get(stop.pedVertex);
                    if (!existing || stop.accumulatedCost < existing.accumulatedCost) {
                        nextStopsMap.set(stop.pedVertex, stop);
                    }
                }

                console.log('nextStopsMap size:', nextStopsMap.size);
            });

            console.log(`spawning ${nextStopsMap.size} walk workers from map`);
            // phase 2 — walk from each arrived stop
            await processInBatches([...nextStopsMap.values()], spawnWalkWorker, 4, (result) => {
                console.log('onResult called with:', result);
                if (!result?.walkResults) return;
                for (const r of result.walkResults) {
                    if (!results.has(r.node) || results.get(r.node).totalCost > r.totalCost) {
                        results.set(r.node, { node: r.node, totalCost: r.totalCost });
                    }
                }
                for (const stop of result.nextStops ?? []) {
                    if (!stop.pedVertex) continue;
                    if (visited.has(stop.stopId)) continue;
                    nextStopQueue.push({
                        stopId: stop.stopId,
                        pedVertexId: stop.pedVertex,
                        accumulatedCost: stop.accumulatedCost,
                        startTime,
                        maxWalkCost,
                        depth: stop.depth
                    });
                }
            });
            //console.log(walks);
            //console.log('walks[0]:', JSON.stringify(walks[0], null, 2));
            nextStopsMap.clear();
        } catch (err) {
            console.error('aborting recursive driving distance:', err);
            aborted = true;  // ← stop the while loop
            break;
        }
        console.log(nextStopQueue)
        stopQueue = nextStopQueue;
    }

    console.log({ rows: [...results.values()] });
    return {
        rows: [...results.values()].map(({ node, totalCost }) => ({
            node,
            agg_cost: totalCost
        }))
    };
}

async function heatmapWithTransportWorkers(lat, lng, time, starttime) {
    const ongrid = await pool.query(
        `SELECT *
        FROM ped_edges_vertices_pgr pe 
        ORDER BY pe.the_geom  <-> ST_Transform(ST_SetSRID(ST_MakePoint($1, $2), 4326),7801)
        LIMIT 1;`,
        [lng, lat]);

    return recursiveDrivingDistanceWorkers(ongrid.rows[0].id, starttime, time)

}

module.exports = { heatmapByFoot, heatmapWithTransport, heatmapWithTransportWorkers };