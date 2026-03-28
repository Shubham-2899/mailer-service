import { Router, Request, Response } from 'express';
import { authenticateMailerRequest } from '../middleware/auth.middleware';
import { LiveSendingModel } from '../models/live-sending.model';

const router = Router();

/**
 * GET /tracking/live/:campaignId
 * Returns live sending stats for a campaign — recent sends, per-IP breakdown, totals.
 * Query params:
 *   limit  - max recent records to return (default 50)
 *   since  - ISO date string; only return records after this timestamp
 */
router.get('/live/:campaignId', authenticateMailerRequest, async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const since = req.query.since ? new Date(req.query.since as string) : null;

    const filter: any = { campaignId };
    if (since) filter.sentAt = { $gt: since };

    const [recentSends, ipBreakdown, totals] = await Promise.all([
      // Recent individual send events
      LiveSendingModel.find(filter)
        .sort({ sentAt: -1 })
        .limit(limit)
        .select('to ipUsed domain status errorMessage sentAt')
        .lean(),

      // Per-IP breakdown: sent/failed counts
      LiveSendingModel.aggregate([
        { $match: { campaignId } },
        {
          $group: {
            _id: { ip: '$ipUsed', domain: '$domain', status: '$status' },
            count: { $sum: 1 },
          },
        },
        {
          $group: {
            _id: { ip: '$_id.ip', domain: '$_id.domain' },
            stats: { $push: { status: '$_id.status', count: '$count' } },
          },
        },
        {
          $project: {
            _id: 0,
            ip: '$_id.ip',
            domain: '$_id.domain',
            stats: 1,
          },
        },
        { $sort: { ip: 1 } },
      ]),

      // Overall totals
      LiveSendingModel.aggregate([
        { $match: { campaignId } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
    ]);

    // Flatten totals
    const totalSent = totals.find((t) => t._id === 'sent')?.count || 0;
    const totalFailed = totals.find((t) => t._id === 'failed')?.count || 0;

    res.json({
      success: true,
      campaignId,
      totals: { sent: totalSent, failed: totalFailed, total: totalSent + totalFailed },
      ipBreakdown,
      recentSends,
    });
  } catch (error: any) {
    console.error('Error fetching live tracking:', error);
    res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
});

/**
 * GET /tracking/live/:campaignId/stream
 * Server-Sent Events stream — pushes new send events in real time.
 * Client connects once and receives events as they happen.
 */
router.get('/live/:campaignId/stream', authenticateMailerRequest, async (req: Request, res: Response) => {
  const { campaignId } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let lastChecked = new Date();

  const sendEvent = (data: any) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Poll every 2 seconds for new records
  const interval = setInterval(async () => {
    try {
      const newRecords = await LiveSendingModel.find({
        campaignId,
        sentAt: { $gt: lastChecked },
      })
        .sort({ sentAt: 1 })
        .select('to ipUsed domain status errorMessage sentAt')
        .lean();

      if (newRecords.length > 0) {
        lastChecked = newRecords[newRecords.length - 1].sentAt;
        sendEvent({ type: 'sends', records: newRecords });
      }
    } catch (err: any) {
      sendEvent({ type: 'error', message: err.message });
    }
  }, 2000);

  // Heartbeat to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 15000);

  req.on('close', () => {
    clearInterval(interval);
    clearInterval(heartbeat);
  });
});

export default router;
