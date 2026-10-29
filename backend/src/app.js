import express from 'express';
import cors from 'cors';
import healthRoutes from './routes/healthRoutes.js';
import scanRoutes from './routes/scanRoutes.js';
import functionalTestRoutes from './routes/functionalTestRoutes.js';

const app = express();

// CORS configuration: allow configured FRONTEND_URL and local Vite development ports (5173, 5174, etc.)
const allowedOriginPattern = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const configuredFrontend = process.env.FRONTEND_URL;

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
      if (!origin) return callback(null, true);

      if (origin === configuredFrontend || allowedOriginPattern.test(origin)) {
        return callback(null, true);
      }

      return callback(null, false);
    },
    credentials: true,
  })
);

// Enforce request body size limits
app.use(express.json({ limit: '100kb' }));

// API Routes
app.use('/api/health', healthRoutes);
app.use('/api/scans', scanRoutes);
app.use('/api/functional-tests', functionalTestRoutes);

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
