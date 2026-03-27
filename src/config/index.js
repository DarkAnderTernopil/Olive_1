require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  env: process.env.NODE_ENV || 'development',

  mongo: {
    uri: process.env.MONGO_URI || 'mongodb://localhost:27017/repriced-yahoo',
  },

  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
  },

  yahoo: {
    clientId: process.env.YAHOO_CLIENT_ID,
    clientSecret: process.env.YAHOO_CLIENT_SECRET,
    redirectUri: process.env.YAHOO_REDIRECT_URI || 'http://localhost:3000/api/yahoo/callback',
    authUrl: 'https://api.login.yahoo.com/oauth2/request_auth',
    tokenUrl: 'https://api.login.yahoo.com/oauth2/get_token',
    imap: {
      host: process.env.YAHOO_IMAP_HOST || 'imap.mail.yahoo.com',
      port: parseInt(process.env.YAHOO_IMAP_PORT, 10) || 993,
    },
  },
};
