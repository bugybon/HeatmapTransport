const { parentPort, workerData } = require('node:worker_threads');
const pool = require('../db/pool');

const { stopId, pedVertexId, accumulatedCost, depth, startTime, maxWalkCost } = workerData ?? {};

async function walkToStops(pedVertexId, accumulated, depth) {
    const { rows } = await pool.query(`
        SELECT
            dd.node,
            dd.agg_cost,
            s.ogc_fid       AS stop_id,
            s.wkb_geometry  AS stop_geom
        FROM pgr_drivingDistance(
            'SELECT id, source, target, minutes AS cost, -1 AS reverse_cost
            FROM ped_edges'::text,
            $1::bigint,
            $2::decimal,
            false
        ) dd
        LEFT JOIN spt_stops s ON s.id_ped_vertex = dd.node
        WHERE dd.edge != -1
    `, [pedVertexId, maxWalkCost - accumulated]);

    return rows.map(row => ({
        node:row.node,
        agg_cost:row.agg_cost,
        stop_id:row.stop_id,
        stop_geom:row.stop_geom,
        accumulatedCost: accumulated + row.agg_cost
    }));
}

async function getTripsFromStop(stopId, accumulated, depth) {
    const { rows } = await pool.query(`
        SELECT DISTINCT
            sst.trip_id,
            sst.arrival_time,
            EXTRACT(EPOCH FROM (
                sst.arrival_time - ($2::interval + ($3::float || ' minutes')::interval)
            )) / 60.0 AS wait_minutes
        FROM spt_stop_times sst
        JOIN spt_stops ss ON ss.stop_id = sst.stop_id
        WHERE ss.ogc_fid = $1::int
            AND sst.arrival_time > ($2::interval + ($3::float || ' minutes')::interval)
            AND sst.arrival_time < ($2::interval + ($4::float || ' minutes')::interval)
        ORDER BY sst.arrival_time
    `, [stopId, startTime, accumulated, maxWalkCost]);

    return rows.map(row => ({
        node: stopId,
        tripId: row.trip_id,
        accumulatedCost: accumulated + parseFloat(row.wait_minutes),
        depth
    }));
}

async function rideToStop(stopId, tripId, accumulated, depth) {
    const { rows } = await pool.query(`
        SELECT
            dd.node,
            dd.agg_cost,
            s.ogc_fid       AS stop_id,
            s.id_ped_vertex AS ped_vertex
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
    `, [stopId, maxWalkCost - accumulated, tripId]);

    return rows.map(row => ({
        stopId: row.stop_id,
        pedVertex: row.ped_vertex,
        accumulatedCost: accumulated + parseFloat(row.agg_cost),
        depth
    }));
}

async function run() {
    // walkResults: all ped vertices for results map
    // nextStops:   stops to expand from in next depth level

    // get trips from all reachable stops
    const tripArrays = await getTripsFromStop(stopId, accumulatedCost, depth);
    const trips = tripArrays.flat();
    console.log("trips", trips);

    // ride each trip
    const rideArrays = await Promise.all(
        trips
            .map(t => rideToStop(t.node, t.tripId, t.accumulatedCost, depth + 1))
    );
    const currentStops = rideArrays.flat();
    console.log("currentStops", currentStops)
    const walkRows = await Promise.all(
        currentStops.map(t => walkToStops(t.pedVertex, t.accumulatedCost, depth + 2))
    )
    const walkResults = walkRows.flat()
        .map(row => ({
            node: row.node,
            totalCost: row.accumulatedCost
        }));
    console.log("walkRows", walkRows);

    //console.log("walkRows:", walkRows);
    const nextStops = walkRows.flat()
        .filter(row => row.stop_id !== null)
        .map(row => ({
            stopId: row.stop_id,
            pedVertex: row.node,
            accumulatedCost: row.accumulatedCost,
            depth: depth + 2
        }));

    parentPort.postMessage({ walkResults, nextStops });
}

run()