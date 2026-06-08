const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({ 
    host: process.env.PGHOST, 
    database: process.env.PGDB,
    user: process.env.PGUSER,
    password: process.env.PGPASS,
    port: process.env.PGPORT,
    ssl: process.env.PGSSL,
    idleTimeoutMillis:0
});

pool.on('error', (err) => console.error('pg pool error', err));

module.exports = pool;