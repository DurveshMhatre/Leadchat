// ============================================
// LeadChat API — Socket.IO Event Handlers
// All client→server event implementations
// ============================================

import type { Server as SocketIOServer, Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  Industry,
  UserRole,
  MessageType,
} from '@leadchat/shared';
import {
  enqueue,
  removeFromAllQueues,
  getActiveMatch,
  deleteActiveMatch,
  type QueueEntry,
} from '../services/matchingQueue.js';
import {
  getUserByFirebaseUid,
  getUserById,
  saveMessage,
  setMatchSaved,
  updateMatchStatus,
  createDealRoom,
} from '../services/matchDb.js';

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

/**
 * Register all socket event handlers on a connected socket.
 */
export function registerSocketHandlers(
  io: SocketIOServer<ClientToServerEvents, ServerToClientEvents>,
  socket: TypedSocket,
): void {
  // Track current user state on the socket
  let currentUserId: string | null = null;
  let currentIndustry: Industry | null = null;
  let currentRole: UserRole | null = null;

  // ----- join:room -----
  socket.on('join:room', async (data) => {
    try {
      const { industry, role, userId } = data;

      // Fetch user from database
      const user = await getUserByFirebaseUid(userId);
      if (!user) {
        socket.emit('error', { code: 'USER_NOT_FOUND', message: 'User not found' });
        return;
      }

      // Store current state
      currentUserId = user.id;
      currentIndustry = industry;
      currentRole = role;

      // Build queue entry
      const entry: QueueEntry = {
        userId: user.id,
        socketId: socket.id,
        score: user.ai_score,
        joinedAt: Date.now(),
        industry,
        role,
        budgetMin: user.budget_min ?? undefined,
        budgetMax: user.budget_max ?? undefined,
        serviceType: user.service_type ?? undefined,
        profileComplete: user.profile_complete,
        rating: Number(user.rating),
      };

      // Add to matching queue
      await enqueue(entry);

      // Join the industry room for broadcasts
      void socket.join(`room:${industry}`);

      console.log(
        `📥 ${user.display_name} joined ${industry} room as ${role} (score: ${user.ai_score})`,
      );
    } catch (error) {
      console.error('❌ join:room error:', error);
      socket.emit('error', { code: 'JOIN_FAILED', message: 'Failed to join room' });
    }
  });

  // ----- leave:room -----
  socket.on('leave:room', async () => {
    try {
      if (currentUserId) {
        await removeFromAllQueues(currentUserId);
        if (currentIndustry) {
          void socket.leave(`room:${currentIndustry}`);
        }
        console.log(`📤 User ${currentUserId} left room`);
      }
      currentUserId = null;
      currentIndustry = null;
      currentRole = null;
    } catch (error) {
      console.error('❌ leave:room error:', error);
    }
  });

  // ----- chat:send -----
  socket.on('chat:send', async (data) => {
    try {
      const { matchId, content, type } = data;
      if (!currentUserId) {
        socket.emit('error', { code: 'NOT_AUTHENTICATED', message: 'Not authenticated' });
        return;
      }

      // Validate the match exists and user is a participant
      const match = await getActiveMatch(matchId);
      if (!match) {
        socket.emit('error', { code: 'MATCH_NOT_FOUND', message: 'Match not found' });
        return;
      }

      const isParticipant = match.buyerId === currentUserId || match.providerId === currentUserId;
      if (!isParticipant) {
        socket.emit('error', { code: 'NOT_IN_MATCH', message: 'Not a participant in this match' });
        return;
      }

      // Save message to database
      const message = await saveMessage(matchId, currentUserId, content, type as MessageType);

      // Determine partner socket
      const partnerSocketId =
        match.buyerId === currentUserId ? match.providerSocketId : match.buyerSocketId;

      // Emit to partner
      const partnerSocket = io.sockets.sockets.get(partnerSocketId);
      if (partnerSocket) {
        partnerSocket.emit('chat:received', {
          message: {
            id: message.id,
            matchId: message.match_id,
            senderId: message.sender_id,
            content: message.content,
            type: message.type as MessageType,
            readAt: message.read_at ?? undefined,
            createdAt: message.created_at,
          },
        });
      }
    } catch (error) {
      console.error('❌ chat:send error:', error);
      socket.emit('error', { code: 'SEND_FAILED', message: 'Failed to send message' });
    }
  });

  // ----- chat:typing -----
  socket.on('chat:typing', async (data) => {
    try {
      const { matchId } = data;
      if (!currentUserId) return;

      const match = await getActiveMatch(matchId);
      if (!match) return;

      const partnerSocketId =
        match.buyerId === currentUserId ? match.providerSocketId : match.buyerSocketId;

      const partnerSocket = io.sockets.sockets.get(partnerSocketId);
      if (partnerSocket) {
        partnerSocket.emit('partner:typing');
      }
    } catch (error) {
      console.error('❌ chat:typing error:', error);
    }
  });

  // ----- match:skip -----
  socket.on('match:skip', async (data) => {
    try {
      const { matchId } = data;
      if (!currentUserId) return;

      const match = await getActiveMatch(matchId);
      if (!match) return;

      // Update match status to skipped
      await updateMatchStatus(matchId, 'skipped');

      // Notify partner that this user left
      const partnerSocketId =
        match.buyerId === currentUserId ? match.providerSocketId : match.buyerSocketId;
      const partnerSocket = io.sockets.sockets.get(partnerSocketId);
      if (partnerSocket) {
        partnerSocket.emit('partner:left');
      }

      // Leave the match room
      void socket.leave(`match:${matchId}`);
      if (partnerSocket) {
        void partnerSocket.leave(`match:${matchId}`);
      }

      // Clean up active match
      await deleteActiveMatch(matchId);

      // Re-queue both users if they're still connected
      // Current user re-queues automatically if still in room
      if (currentIndustry && currentRole) {
        const currentUser = await getUserById(currentUserId);
        if (currentUser) {
          const entry: QueueEntry = {
            userId: currentUser.id,
            socketId: socket.id,
            score: currentUser.ai_score,
            joinedAt: Date.now(),
            industry: currentIndustry,
            role: currentRole,
            budgetMin: currentUser.budget_min ?? undefined,
            budgetMax: currentUser.budget_max ?? undefined,
            serviceType: currentUser.service_type ?? undefined,
            profileComplete: currentUser.profile_complete,
            rating: Number(currentUser.rating),
          };
          await enqueue(entry);
        }
      }

      // Re-queue partner
      const partnerId = match.buyerId === currentUserId ? match.providerId : match.buyerId;
      const partnerUser = await getUserById(partnerId);
      if (partnerUser && partnerSocket) {
        const partnerRole = match.buyerId === currentUserId ? 'provider' : 'buyer';
        const entry: QueueEntry = {
          userId: partnerUser.id,
          socketId: partnerSocketId,
          score: partnerUser.ai_score,
          joinedAt: Date.now(),
          industry: currentIndustry ?? (partnerUser.industry as Industry),
          role: partnerRole,
          budgetMin: partnerUser.budget_min ?? undefined,
          budgetMax: partnerUser.budget_max ?? undefined,
          serviceType: partnerUser.service_type ?? undefined,
          profileComplete: partnerUser.profile_complete,
          rating: Number(partnerUser.rating),
        };
        await enqueue(entry);
      }

      console.log(`⏩ Match ${matchId} skipped by ${currentUserId}`);
    } catch (error) {
      console.error('❌ match:skip error:', error);
      socket.emit('error', { code: 'SKIP_FAILED', message: 'Failed to skip match' });
    }
  });

  // ----- match:save -----
  socket.on('match:save', async (data) => {
    try {
      const { matchId } = data;
      if (!currentUserId) return;

      const activeMatch = await getActiveMatch(matchId);
      if (!activeMatch) return;

      // Determine role of current user in this match
      const role: 'buyer' | 'provider' =
        activeMatch.buyerId === currentUserId ? 'buyer' : 'provider';

      // Set the saved flag in DB
      const result = await setMatchSaved(matchId, role);
      if (!result) return;

      // Notify partner that this user saved
      const partnerSocketId =
        activeMatch.buyerId === currentUserId
          ? activeMatch.providerSocketId
          : activeMatch.buyerSocketId;

      const partnerSocket = io.sockets.sockets.get(partnerSocketId);
      if (partnerSocket) {
        partnerSocket.emit('match:saved', { matchId, savedBy: currentUserId });
      }

      // If BOTH saved → create deal room
      if (result.buyerSaved && result.providerSaved) {
        const dealRoomId = await createDealRoom(
          matchId,
          activeMatch.buyerId,
          activeMatch.providerId,
        );

        // Emit deal:created to both parties
        socket.emit('deal:created', { dealRoomId, matchId });
        if (partnerSocket) {
          partnerSocket.emit('deal:created', { dealRoomId, matchId });
        }

        console.log(`🤝 Deal room created: ${dealRoomId} (match: ${matchId})`);
      }

      console.log(`💾 Match ${matchId} saved by ${currentUserId} (${role})`);
    } catch (error) {
      console.error('❌ match:save error:', error);
      socket.emit('error', { code: 'SAVE_FAILED', message: 'Failed to save match' });
    }
  });

  // ----- disconnect -----
  socket.on('disconnect', async (reason) => {
    try {
      if (currentUserId) {
        // Remove from all queues
        await removeFromAllQueues(currentUserId);
        console.log(`🔌 User ${currentUserId} disconnected (${reason})`);
      }
    } catch (error) {
      console.error('❌ disconnect cleanup error:', error);
    }
  });
}
