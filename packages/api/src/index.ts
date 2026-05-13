// ============================================
// LeadChat API — Server Entry Point
// Express + Socket.IO with graceful shutdown
// ============================================

import http from 'node:http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { Server as SocketIOServer } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@leadchat/shared';

import { config } from './config/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { profileRouter } from './routes/profile.js';
import { verifyRouter } from './routes/verify.js';
import { billingRouter } from './routes/billing.js';
import { creditsRouter } from './routes/credits.js';
import { dealsRouter } from './routes/deals.js';
import { closeDatabasePool } from './services/database.js';
import { closeRedisConnection } from './services/redis.js';
import { initializeSocketHandlers } from './socket/index.js';
import { initializeFirebase } from './config/firebase.js';
import { startMatchingLoop, stopMatchingLoop } from './services/matchingEngine.js';
import { globalLimiter, strictLimiter } from './middleware/rateLimiter.js';

// --- Express App ---

const app = express();

// Security middleware
app.use(helmet());
app.use(
  cors({
    origin: config.CORS_ORIGIN,
    credentials: true,
  }),
);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting (Mission 7)
app.use(globalLimiter);

// --- Routes ---

app.use('/api', healthRouter);
app.use('/api', authRouter);
app.use('/api', profileRouter);
app.use('/api', verifyRouter);
app.use('/api', strictLimiter, billingRouter);
app.use('/api', strictLimiter, creditsRouter);
app.use('/api', dealsRouter);

// 404 handler for unknown routes
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'The requested endpoint does not exist',
    },
  });
});

// Global error handler (must be last)
app.use(errorHandler);

// --- HTTP Server + Socket.IO ---

const httpServer = http.createServer(app);

const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: config.CORS_ORIGIN,
    credentials: true,
  },
  pingTimeout: 60_000,
  pingInterval: 25_000,
});

// Initialize Firebase Admin SDK (Mission 4)
initializeFirebase();

// Initialize Socket.IO event handlers (Mission 2)
initializeSocketHandlers(io);

// Start the matching engine loop (Mission 2)
startMatchingLoop(io);

// --- Server Start ---

httpServer.listen(config.PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║          🚀 LeadChat API Server          ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  Port:        ${String(config.PORT).padEnd(26)}║`);
  console.log(`║  Environment: ${config.NODE_ENV.padEnd(26)}║`);
  console.log(`║  CORS Origin: ${config.CORS_ORIGIN.padEnd(26)}║`);
  console.log('╚══════════════════════════════════════════╝');
  console.log('');
  console.log('📡 Health check: http://localhost:' + config.PORT + '/api/health');
  console.log('🔌 Socket.IO:    ws://localhost:' + config.PORT);
  console.log('');
});

// --- Graceful Shutdown ---

async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`\n⚡ Received ${signal}. Starting graceful shutdown...`);

  // Stop matching engine
  stopMatchingLoop();

  // Close Socket.IO connections
  io.close(() => {
    console.log('🔌 Socket.IO server closed');
  });

  // Close HTTP server
  httpServer.close(() => {
    console.log('🌐 HTTP server closed');
  });

  // Close database and Redis
  await Promise.all([closeDatabasePool(), closeRedisConnection()]);

  console.log('✅ Graceful shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => void gracefulShutdown('SIGINT'));

// Handle uncaught exceptions (never crash silently)
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
  void gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled Rejection:', reason);
  void gracefulShutdown('unhandledRejection');
});

export { app, io, httpServer };

