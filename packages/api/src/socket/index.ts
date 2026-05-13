// ============================================
// LeadChat API — Socket.IO Initialization
// Sets up connection handler and registers events
// Firebase JWT verification for Socket.IO (Mission 7)
// ============================================

import type { Server as SocketIOServer } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@leadchat/shared';
import { registerSocketHandlers } from './handlers.js';
import { verifyFirebaseToken } from '../config/firebase.js';
import { pool } from '../services/database.js';

/**
 * Initialize Socket.IO event handling on the server.
 *
 * Security (Mission 7):
 * - In production, all sockets must present a valid Firebase JWT
 * - In development, allows unauthenticated connections for Expo Go testing
 */
export function initializeSocketHandlers(
  io: SocketIOServer<ClientToServerEvents, ServerToClientEvents>,
): void {
  // Socket auth middleware — verifies Firebase JWT
  io.use(async (socket, next) => {
    // In development, allow unauthenticated connections
    if (process.env['NODE_ENV'] === 'development') {
      const testUserId = socket.handshake.auth.userId;
      if (typeof testUserId === 'string' && testUserId.length > 0) {
        // Resolve firebase_uid → internal UUID (same as auth middleware)
        try {
          const result = await pool.query<{ id: string }>(
            `SELECT id FROM users WHERE firebase_uid = $1`,
            [testUserId],
          );
          socket.data.userId = result.rows[0]?.id ?? testUserId;
          socket.data.firebaseUid = testUserId;
        } catch {
          socket.data.userId = testUserId;
          socket.data.firebaseUid = testUserId;
        }
      }
      next();
      return;
    }

    // Production: verify Firebase JWT from handshake auth
    const token = socket.handshake.auth.token;
    if (!token || typeof token !== 'string') {
      next(new Error('Authentication required: missing token'));
      return;
    }

    try {
      const decoded = await verifyFirebaseToken(token);
      if (!decoded) {
        next(new Error('Authentication failed: invalid token'));
        return;
      }

      // Resolve firebase_uid → internal UUID
      const result = await pool.query<{ id: string }>(
        `SELECT id FROM users WHERE firebase_uid = $1`,
        [decoded.uid],
      );

      if (!result.rows[0]) {
        next(new Error('Authentication failed: user not registered'));
        return;
      }

      socket.data.userId = result.rows[0].id;
      socket.data.firebaseUid = decoded.uid;
      next();
    } catch (error) {
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`🔌 Socket connected: ${socket.id} (user: ${socket.data.userId ?? 'anonymous'})`);

    // Register all event handlers
    registerSocketHandlers(io, socket);
  });

  console.log('🔌 Socket.IO handlers initialized');
}
