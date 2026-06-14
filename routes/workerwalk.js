const { parentPort, workerData } = require('node:worker_threads');
const pool = require('../db/poolworkers');

const { stopId, pedVertex, accumulatedCost, depth, startTime, maxWalkCost } = workerData ?? {};

const MAX_WALK_LEG = 20;

async function walkToStops(pedVertexId, accumulated, depth) {
    const remaining = Math.min(maxWalkCost - accumulated, MAX_WALK_LEG);

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
    `, [pedVertexId, remaining]);

    return rows.map(row => ({
        node:row.node,
        agg_cost:row.agg_cost,
        stop_id:row.stop_id,
        stop_geom:row.stop_geom,
        accumulatedCost: accumulated + row.agg_cost,
        depth: depth
    }));
}

async function run() {
    try {
        //console.log(pedVertex, accumulatedCost, depth + 1);
        const walks = await walkToStops(pedVertex, accumulatedCost, depth + 1)

        const walkResults = walks.map(row => ({
            node:      row.node,
            totalCost: accumulatedCost + parseFloat(row.agg_cost)
        }));

        const nextStops = walks
            .filter(row => row.stop_id !== null)
            .map(row => ({
                stopId:          row.stop_id,
                pedVertexId:     row.node,
                accumulatedCost: accumulatedCost + parseFloat(row.agg_cost),
                depth:  row.depth
            }));

        parentPort.postMessage({ walkResults, nextStops });
    } catch (err) {
        console.error('walk worker error:', err);
        parentPort.postMessage({ walkResults: [], nextStops: [] });
    }
}

run();