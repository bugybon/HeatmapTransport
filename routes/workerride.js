const { parentPort, workerData } = require('node:worker_threads');
const pool = require('../db/poolworkers');

const { stopId, pedVertexId, accumulatedCost, depth, startTime, maxWalkCost } = workerData ?? {};

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
        maxWalkCost: maxWalkCost,
        depth
    }));
}

async function run() {
    try {
        const trips = await getTripsFromStop(stopId, accumulatedCost, depth);
        if (trips.length === 0) {
            parentPort.postMessage([]);
            return;
        }

        // ride each trip sequentially to keep memory flat
        const nextStops = [];
        for (const trip of trips) {
            const arrived = await rideToStop(trip.node, trip.tripId, trip.accumulatedCost, trip.depth + 1);
            nextStops.push(...arrived);
        }

        parentPort.postMessage(nextStops);
    } catch (err) {
        console.error('trip worker error:', err);
        parentPort.postMessage([]);
    }
}

run();