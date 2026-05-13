// ============================================
// LeadChat API — MatchingQueue Unit Tests
// Tests enqueue, dequeue, timeout, duplicate guard
// ============================================

// Mock Redis before imports
const mockPipeline = {
  hset: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis(),
  hdel: jest.fn().mockReturnThis(),
  del: jest.fn().mockReturnThis(),
  expire: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue([]),
};

const mockRedis = {
  pipeline: jest.fn(() => mockPipeline),
  hgetall: jest.fn(),
  hexists: jest.fn(),
  get: jest.fn(),
  keys: jest.fn(),
  hset: jest.fn(),
  expire: jest.fn(),
  del: jest.fn(),
};

jest.mock('../services/redis.js', () => ({
  redis: mockRedis,
}));

import type { Industry, UserRole } from '@leadchat/shared';
import {
  enqueue,
  dequeue,
  getPool,
  removeFromAllQueues,
  getActiveMatch,
  setActiveMatch,
  deleteActiveMatch,
} from '../services/matchingQueue.js';
import type { QueueEntry } from '../services/matchingQueue.js';

// --- Helpers ---

function makeEntry(overrides: Partial<QueueEntry> = {}): QueueEntry {
  return {
    userId: 'user-001',
    socketId: 'socket-001',
    score: 55,
    joinedAt: Date.now(),
    industry: 'technology' as Industry,
    role: 'buyer' as UserRole,
    profileComplete: true,
    rating: 4.0,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// --- enqueue Tests ---

describe('enqueue()', () => {
  test('1. Stores entry in correct Redis hash and sets TTL', async () => {
    const entry = makeEntry();
    await enqueue(entry);

    expect(mockRedis.pipeline).toHaveBeenCalled();
    expect(mockPipeline.hset).toHaveBeenCalledWith(
      'queue:technology:buyer',
      'user-001',
      JSON.stringify(entry)
    );
    // Verify TTL, socket mappings are also set
    expect(mockPipeline.set).toHaveBeenCalledTimes(3); // ttl + 2 socket mappings
    expect(mockPipeline.exec).toHaveBeenCalled();
  });

  test('2. Duplicate enqueue overwrites existing entry (no duplicates)', async () => {
    const entry1 = makeEntry({ score: 50 });
    const entry2 = makeEntry({ score: 70 }); // same userId, updated score

    await enqueue(entry1);
    await enqueue(entry2);

    // Both calls should use hset which overwrites the hash field
    expect(mockPipeline.hset).toHaveBeenCalledTimes(2);
    // The second call should contain the updated score
    const secondCall = mockPipeline.hset.mock.calls[1];
    expect(JSON.parse(secondCall[2]).score).toBe(70);
  });
});

// --- dequeue Tests ---

describe('dequeue()', () => {
  test('3. Removes user from correct hash and clears TTL', async () => {
    await dequeue('technology' as Industry, 'buyer' as UserRole, 'user-001');

    expect(mockPipeline.hdel).toHaveBeenCalledWith('queue:technology:buyer', 'user-001');
    expect(mockPipeline.del).toHaveBeenCalledWith('queue:ttl:user-001');
    expect(mockPipeline.exec).toHaveBeenCalled();
  });
});

// --- getPool Tests ---

describe('getPool()', () => {
  test('4. Returns parsed entries from Redis hash', async () => {
    const entry = makeEntry();
    mockRedis.hgetall.mockResolvedValueOnce({
      'user-001': JSON.stringify(entry),
      'user-002': JSON.stringify(makeEntry({ userId: 'user-002', socketId: 'socket-002' })),
    });

    const pool = await getPool('technology' as Industry, 'buyer' as UserRole);

    expect(pool).toHaveLength(2);
    expect(pool[0]!.userId).toBe('user-001');
    expect(pool[1]!.userId).toBe('user-002');
  });

  test('5. Skips malformed JSON entries gracefully', async () => {
    mockRedis.hgetall.mockResolvedValueOnce({
      'user-001': JSON.stringify(makeEntry()),
      'user-bad': 'not-valid-json{{{',
    });

    const pool = await getPool('technology' as Industry, 'buyer' as UserRole);

    expect(pool).toHaveLength(1);
    expect(pool[0]!.userId).toBe('user-001');
  });

  test('6. Returns empty array for empty queue', async () => {
    mockRedis.hgetall.mockResolvedValueOnce({});

    const pool = await getPool('technology' as Industry, 'buyer' as UserRole);
    expect(pool).toHaveLength(0);
  });
});

// --- removeFromAllQueues Tests ---

describe('removeFromAllQueues()', () => {
  test('7. Removes user from all industry queues', async () => {
    mockRedis.keys.mockResolvedValueOnce([
      'queue:technology:buyer',
      'queue:technology:provider',
      'queue:design:buyer',
      'queue:ttl:user-001', // Should be skipped
    ]);
    mockRedis.get.mockResolvedValueOnce('socket-001');

    await removeFromAllQueues('user-001');

    // Should hdel from 3 queue keys (not the ttl key)
    expect(mockPipeline.hdel).toHaveBeenCalledTimes(3);
    expect(mockPipeline.del).toHaveBeenCalledWith('queue:ttl:user-001');
    expect(mockPipeline.del).toHaveBeenCalledWith('user:socket:user-001');
    expect(mockPipeline.del).toHaveBeenCalledWith('socket:user:socket-001');
    expect(mockPipeline.exec).toHaveBeenCalled();
  });
});

// --- Active Match Tests ---

describe('Active Match Management', () => {
  test('8. setActiveMatch stores match data in Redis', async () => {
    const matchData = {
      buyerId: 'buyer-001',
      providerId: 'provider-001',
      buyerSocketId: 'socket-b1',
      providerSocketId: 'socket-p1',
    };

    await setActiveMatch('match-001', matchData);

    expect(mockRedis.hset).toHaveBeenCalledWith('active:match:match-001', matchData);
    expect(mockRedis.expire).toHaveBeenCalledWith('active:match:match-001', 3600);
  });

  test('9. getActiveMatch returns null for non-existent match', async () => {
    mockRedis.hgetall.mockResolvedValueOnce({});

    const result = await getActiveMatch('match-nonexistent');
    expect(result).toBeNull();
  });

  test('10. deleteActiveMatch removes the key', async () => {
    await deleteActiveMatch('match-001');
    expect(mockRedis.del).toHaveBeenCalledWith('active:match:match-001');
  });
});
