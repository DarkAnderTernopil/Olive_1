function errorHandler(err, _req, res, _next) {
  console.error('[error]', err.stack || err.message);

  if (err.isAxiosError) {
    const status = err.response?.status || 502;
    return res.status(status).json({
      error: 'Yahoo API error',
      details: err.response?.data || err.message,
    });
  }

  const status = err.status || 500;
  res.status(status).json({
    error: err.message || 'Internal server error',
  });
}

module.exports = errorHandler;
