import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { z } from 'zod';
import { supaSrv } from './supabase.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.post('/api/queue/join', async (req, res) => {
  const body = z.object({
    canteenId: z.string().uuid(),
    vkId: z.number().int()
  }).safeParse(req.body);
  if (!body.success) return res.status(400).json(body.error);

  const { canteenId, vkId } = body.data;

  const existing = await supaSrv.from('queues')
    .select('id,status')
    .eq('canteen_id', canteenId)
    .eq('user_id', vkId)
    .eq('status', 'waiting')
    .maybeSingle();

  if (existing.data) return res.json(existing.data);

  const ins = await supaSrv.from('queues')
    .insert({ canteen_id: canteenId, user_id: vkId })
    .select()
    .single();

  if (ins.error) return res.status(500).json({ error: ins.error.message });
  res.json(ins.data);
});

app.post('/api/queue/leave', async (req, res) => {
  const body = z.object({
    rowId: z.string().uuid(),
    vkId: z.number().int()
  }).safeParse(req.body);
  if (!body.success) return res.status(400).json(body.error);

  const { rowId, vkId } = body.data;

  const upd = await supaSrv.from('queues')
    .update({ status: 'left' })
    .eq('id', rowId)
    .eq('user_id', vkId);

  if (upd.error) return res.status(500).json({ error: upd.error.message });
  res.json({ ok: true });
});

const port = Number(process.env.PORT ?? 5175);
app.listen(port, () => console.log(`Backend listening on :${port}`));
