import express from 'express';
import cors from 'cors';
import healthRoutes from './routes/healthRoutes.js';
import scanRoutes from './routes/scanRoutes.js';

const app = express();

// CORS configuration
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
app.use(
  cors({
    origin: frontendUrl,
    credentials: true,
  })
);

// Enforce request body size limits
app.use(express.json({ limit: '10kb' }));

// API Routes
app.use('/api/health', healthRoutes);
app.use('/api/scans', scanRoutes);

// JSON 404 handler for unknown routes
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    message: `Cannot ${req.method} ${req.originalUrl} - Route not found`,
  });
});

// Centralized error-handling middleware
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      success: false,
      message: 'Malformed JSON payload in request body',
      code: 'INVALID_JSON',
    });
  }

  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      success: false,
      message: 'Request payload exceeded maximum size limit',
      code: 'PAYLOAD_TOO_LARGE',
    });
  }

  console.error('Unhandled server error:', err);
  const statusCode = err.statusCode || err.status || 500;
  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
});

export default app;
