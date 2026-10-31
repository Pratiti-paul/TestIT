import dotenv from 'dotenv';
dotenv.config();

import app from './app.js';

const PORT = parseInt(process.env.PORT, 10) || 5001;

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`TestIT backend server running on http://localhost:${PORT}`);
  console.log(`Health check endpoint: http://localhost:${PORT}/api/health`);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Please free the port or specify another PORT.`);
  } else {
    console.error('Server startup error:', error.message);
  }
  process.exit(1);
});

// Graceful shutdown on nodemon restart signal (SIGUSR2)
// Ensures the TCP server closes and frees port 5001 before nodemon restarts
process.once('SIGUSR2', () => {
  server.close(() => {
    process.kill(process.pid, 'SIGUSR2');
  });
});

// Graceful shutdown on process termination (SIGINT, SIGTERM)
process.on('SIGINT', () => {
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  server.close(() => {
    process.exit(0);
  });
});

export default server;
