import dotenv from 'dotenv';
dotenv.config();

import app from './app.js';

const PORT = parseInt(process.env.PORT, 10) || 5001;

const server = app.listen(PORT, () => {
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

export default server;
