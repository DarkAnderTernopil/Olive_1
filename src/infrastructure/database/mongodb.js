const mongoose = require('mongoose');
const config = require('../../config');

let connection = null;

async function connectMongo() {
  if (connection) return connection;

  connection = await mongoose.connect(config.mongo.uri);
  console.log(`[mongo] connected to ${config.mongo.uri}`);
  return connection;
}

function getConnection() {
  if (!connection) throw new Error('MongoDB not connected. Call connectMongo() first.');
  return connection;
}

module.exports = { connectMongo, getConnection };
