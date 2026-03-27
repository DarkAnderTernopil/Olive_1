const { Redis } = require('ioredis');
const config = require('../../config');

let client = null;

function getRedis() {
  if (client) return client;

  client = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    maxRetriesPerRequest: null, // required by BullMQ
  });

  client.on('connect', () => console.log('[redis] connected'));
  client.on('error', (err) => console.error('[redis] error', err.message));

  return client;
}

module.exports = { getRedis };
