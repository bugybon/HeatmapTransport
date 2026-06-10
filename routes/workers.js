const {isMainThread, parentPort, workerData} = require('node:worker_threads');
const pool = require('../db/pool');

if (!isMainThread) {
    const { stopId, pedVertexId, accumulatedCost, depth, startTime, maxWalkCost, connectionString } = workerData;

    async function walkToStops(pedVertexId, accumulatedCost, depth) {
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
        `, [pedVertexId, maxWalkCost - accumulatedCost]);

        return rows;
    }

    async function getTripsFromStop(stopId, accumulatedCost, depth) {
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
        `, [stopId, startTime, accumulatedCost, maxWalkCost]);

        return rows.map(row => ({
            node:            stopId,
            tripId:          row.trip_id,
            accumulatedCost: accumulatedCost + parseFloat(row.wait_minutes),
            depth
        }));
    }

    async function rideToStop(stopId, tripId, accumulatedCost, depth) {
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
        `, [stopId, maxWalkCost - accumulatedCost, tripId]);

        return rows.map(row => ({
            stopId:          row.stop_id,
            pedVertex:       row.ped_vertex,
            accumulatedCost: accumulatedCost + parseFloat(row.agg_cost),
            depth
        }));
    }

    async function run() {
        // walkResults: all ped vertices for results map
        // nextStops:   stops to expand from in next depth level
        const walkRows = await walkToStops(pedVertexId, accumulatedCost, depth);

        const walkResults = walkRows.map(row => ({
            node:      row.node,
            totalCost: accumulatedCost + parseFloat(row.agg_cost)
        }));

        const reachableStops = walkRows
            .filter(row => row.stop_id !== null)
            .map(row => ({
                stopId:          row.stop_id,
                pedVertex:       row.node,
                accumulatedCost: accumulatedCost + parseFloat(row.agg_cost),
                depth
            }));

        // get trips from all reachable stops
        const tripArrays = await Promise.all(
            reachableStops.map(s => getTripsFromStop(s.stopId, s.accumulatedCost, depth))
        );
        const trips = tripArrays.flat();

        // ride each trip
        const rideArrays = await Promise.all(
            trips.map(t => rideToStop(t.node, t.tripId, t.accumulatedCost, depth + 1))
        );
        const nextStops = rideArrays.flat();

        parentPort.postMessage({ walkResults, nextStops });
    }

    run().finally(() => pool.end());
}