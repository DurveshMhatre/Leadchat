// ============================================
// LeadChat API — Deal Room Routes
// GET  /api/deals       — List user's deal rooms
// GET  /api/deals/:id   — Get deal room details
// POST /api/deals/:id/milestones     — Add milestone
// PUT  /api/deals/:id/milestones/:mid — Update milestone status
// POST /api/deals/:id/rate           — Submit rating
// PUT  /api/deals/:id/archive        — Archive a deal
// ============================================

import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../services/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { recomputeAndSaveScore } from '../services/scoreEngine.js';

export const dealsRouter = Router();

/**
 * GET /api/deals
 * List all deal rooms for the current user.
 */
dealsRouter.get('/deals', authMiddleware, async (req, res, next) => {
  try {
    if (!req.userId) throw new AppError(401, 'Not authenticated', 'AUTH_REQUIRED');

    const result = await pool.query(
      `SELECT d.*,
              b.display_name AS buyer_name, b.industry AS buyer_industry, b.avatar_url AS buyer_avatar,
              p.display_name AS provider_name, p.industry AS provider_industry, p.avatar_url AS provider_avatar,
              (SELECT content FROM chat_messages WHERE match_id = d.match_id ORDER BY created_at DESC LIMIT 1) AS last_message,
              (SELECT created_at FROM chat_messages WHERE match_id = d.match_id ORDER BY created_at DESC LIMIT 1) AS last_message_at
       FROM deal_rooms d
       JOIN users b ON d.buyer_id = b.id
       JOIN users p ON d.provider_id = p.id
       WHERE d.buyer_id = $1 OR d.provider_id = $1
       ORDER BY COALESCE(
         (SELECT created_at FROM chat_messages WHERE match_id = d.match_id ORDER BY created_at DESC LIMIT 1),
         d.created_at
       ) DESC`,
      [req.userId]
    );

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/deals/:id
 * Get full deal room details including milestones and recent messages.
 */
dealsRouter.get('/deals/:id', authMiddleware, async (req, res, next) => {
  try {
    if (!req.userId) throw new AppError(401, 'Not authenticated', 'AUTH_REQUIRED');

    const { id } = req.params;

    // Get deal room
    const dealResult = await pool.query(
      `SELECT d.*,
              b.display_name AS buyer_name, b.industry AS buyer_industry,
              p.display_name AS provider_name, p.industry AS provider_industry
       FROM deal_rooms d
       JOIN users b ON d.buyer_id = b.id
       JOIN users p ON d.provider_id = p.id
       WHERE d.id = $1 AND (d.buyer_id = $2 OR d.provider_id = $2)`,
      [id, req.userId]
    );

    if (dealResult.rows.length === 0) {
      throw new AppError(404, 'Deal room not found', 'DEAL_NOT_FOUND');
    }

    const deal = dealResult.rows[0];

    // Get milestones
    const milestones = await pool.query(
      `SELECT * FROM milestones WHERE deal_room_id = $1 ORDER BY created_at ASC`,
      [id]
    );

    // Get recent messages (last 50)
    const messages = await pool.query(
      `SELECT * FROM chat_messages WHERE match_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [deal.match_id]
    );

    // Get proposals/files
    const proposals = await pool.query(
      `SELECT * FROM proposals WHERE deal_room_id = $1 ORDER BY created_at DESC`,
      [id]
    );

    // Get ratings
    const ratings = await pool.query(
      `SELECT * FROM ratings WHERE match_id = $1`,
      [deal.match_id]
    );

    res.json({
      success: true,
      data: {
        deal,
        milestones: milestones.rows,
        messages: messages.rows.reverse(), // oldest first
        proposals: proposals.rows,
        ratings: ratings.rows,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/deals/:id/milestones
 * Add a new milestone to a deal room.
 */
dealsRouter.post('/deals/:id/milestones', authMiddleware, async (req, res, next) => {
  try {
    if (!req.userId) throw new AppError(401, 'Not authenticated', 'AUTH_REQUIRED');

    const schema = z.object({ title: z.string().min(1).max(200) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, 'Title is required', 'VALIDATION_ERROR');

    const { id } = req.params;

    // Verify user is a participant
    const dealCheck = await pool.query(
      `SELECT id FROM deal_rooms WHERE id = $1 AND (buyer_id = $2 OR provider_id = $2)`,
      [id, req.userId]
    );
    if (dealCheck.rows.length === 0) throw new AppError(404, 'Deal room not found', 'DEAL_NOT_FOUND');

    const result = await pool.query(
      `INSERT INTO milestones (deal_room_id, title) VALUES ($1, $2) RETURNING *`,
      [id, parsed.data.title]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/deals/:id/milestones/:mid
 * Update milestone status.
 */
dealsRouter.put('/deals/:id/milestones/:mid', authMiddleware, async (req, res, next) => {
  try {
    if (!req.userId) throw new AppError(401, 'Not authenticated', 'AUTH_REQUIRED');

    const schema = z.object({ status: z.enum(['todo', 'in_progress', 'done']) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, 'Invalid status', 'VALIDATION_ERROR');

    const { id, mid } = req.params;

    // Verify user is a participant
    const dealCheck = await pool.query(
      `SELECT id FROM deal_rooms WHERE id = $1 AND (buyer_id = $2 OR provider_id = $2)`,
      [id, req.userId]
    );
    if (dealCheck.rows.length === 0) throw new AppError(404, 'Deal room not found', 'DEAL_NOT_FOUND');

    const result = await pool.query(
      `UPDATE milestones SET status = $1 WHERE id = $2 AND deal_room_id = $3 RETURNING *`,
      [parsed.data.status, mid, id]
    );

    if (result.rows.length === 0) throw new AppError(404, 'Milestone not found', 'MILESTONE_NOT_FOUND');

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/deals/:id/rate
 * Submit a 1-5 star rating + optional note.
 */
dealsRouter.post('/deals/:id/rate', authMiddleware, async (req, res, next) => {
  try {
    if (!req.userId) throw new AppError(401, 'Not authenticated', 'AUTH_REQUIRED');

    const schema = z.object({
      score: z.number().int().min(1).max(5),
      note: z.string().max(120).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, 'Score must be 1-5', 'VALIDATION_ERROR');

    const { id } = req.params;

    // Get deal room
    const dealResult = await pool.query(
      `SELECT * FROM deal_rooms WHERE id = $1 AND (buyer_id = $2 OR provider_id = $2)`,
      [id, req.userId]
    );
    if (dealResult.rows.length === 0) throw new AppError(404, 'Deal room not found', 'DEAL_NOT_FOUND');

    const deal = dealResult.rows[0];
    const ratedUserId = deal.buyer_id === req.userId ? deal.provider_id : deal.buyer_id;

    // Insert rating (unique constraint prevents duplicates)
    await pool.query(
      `INSERT INTO ratings (match_id, rater_id, rated_user_id, score, note)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (match_id, rater_id) DO UPDATE SET score = $4, note = $5`,
      [deal.match_id, req.userId, ratedUserId, parsed.data.score, parsed.data.note ?? null]
    );

    // Recompute average rating for the rated user
    const avgResult = await pool.query(
      `SELECT AVG(score)::numeric(3,1) AS avg_rating, COUNT(*) AS total_ratings
       FROM ratings WHERE rated_user_id = $1`,
      [ratedUserId]
    );
    const newAvg = parseFloat(avgResult.rows[0].avg_rating) || 0;

    // Update user's rating
    await pool.query(
      `UPDATE users SET rating = $1 WHERE id = $2`,
      [newAvg, ratedUserId]
    );

    // Recompute AI score for rated user (rating affects score)
    await recomputeAndSaveScore(ratedUserId);

    // Check if both sides have now rated
    const bothRated = await pool.query(
      `SELECT COUNT(*) FROM ratings WHERE match_id = $1`,
      [deal.match_id]
    );

    res.json({
      success: true,
      data: {
        rated: true,
        bothSidesRated: parseInt(bothRated.rows[0].count, 10) >= 2,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/deals/:id/archive
 * Archive a completed deal.
 */
dealsRouter.put('/deals/:id/archive', authMiddleware, async (req, res, next) => {
  try {
    if (!req.userId) throw new AppError(401, 'Not authenticated', 'AUTH_REQUIRED');

    const { id } = req.params;

    const result = await pool.query(
      `UPDATE deal_rooms SET status = 'archived' WHERE id = $1 AND (buyer_id = $2 OR provider_id = $2) RETURNING *`,
      [id, req.userId]
    );

    if (result.rows.length === 0) throw new AppError(404, 'Deal room not found', 'DEAL_NOT_FOUND');

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});
