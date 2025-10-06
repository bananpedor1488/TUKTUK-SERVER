const express = require('express');
const router = express.Router();
const User = require('../models/User');
const PromoCode = require('../models/PromoCode');

// Helper to generate promo code
function generateCode(len = 10) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

// GET /api/wallet/balance
router.get('/balance', async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?._id;
    const user = await User.findById(userId).select('coins isPremium');
    if (!user) return res.status(404).json({ message: 'User not found' });
    return res.json({ balance: user.coins || 0, isPremium: !!user.isPremium });
  } catch (e) {
    console.error('wallet/balance error', e);
    return res.status(500).json({ message: 'Internal error' });
  }
});

// POST /api/wallet/purchase-premium { cost: 300 }
router.post('/purchase-premium', async (req, res) => {
  try {
    const COST = Number(req.body?.cost ?? 300);
    if (!Number.isFinite(COST) || COST <= 0) return res.status(400).json({ message: 'Invalid cost' });

    const userId = req.user?.userId || req.user?._id;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (user.isPremium) return res.status(400).json({ message: 'Premium уже активирован' });
    if ((user.coins ?? 0) < COST) return res.status(400).json({ message: 'Недостаточно средств' });

    user.coins = (user.coins || 0) - COST;
    user.isPremium = true;
    await user.save();

    return res.json({ success: true, balance: user.coins, isPremium: true });
  } catch (e) {
    console.error('wallet/purchase-premium error', e);
    return res.status(500).json({ message: 'Internal error' });
  }
});

// POST /api/wallet/redeem { code }
router.post('/redeem', async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code || typeof code !== 'string') return res.status(400).json({ message: 'Код обязателен' });

    const promo = await PromoCode.findOne({ code: code.trim().toUpperCase() });
    if (!promo) return res.status(404).json({ message: 'Промокод не найден' });
    if (!promo.canBeUsed()) return res.status(400).json({ message: 'Промокод недействителен' });

    const userId = req.user?.userId || req.user?._id;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (promo.type === 'premium') {
      if (user.isPremium) return res.status(400).json({ message: 'Premium уже активирован' });
      user.isPremium = true;
    } else if (promo.type === 'coins') {
      const amt = Number(promo.amount || 0);
      if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ message: 'Некорректная сумма промокода' });
      user.coins = (user.coins || 0) + amt;
    }

    promo.usedCount += 1;
    if (promo.usedCount >= promo.maxUses) promo.isActive = false;

    await Promise.all([user.save(), promo.save()]);

    return res.json({ success: true, message: 'Промокод активирован', balance: user.coins, isPremium: user.isPremium });
  } catch (e) {
    console.error('wallet/redeem error', e);
    return res.status(500).json({ message: 'Internal error' });
  }
});

// POST /api/wallet/create-promo { type: 'premium'|'coins', amount? }
router.post('/create-promo', async (req, res) => {
  try {
    const { type, amount } = req.body || {};
    if (!['premium', 'coins'].includes(type)) return res.status(400).json({ message: 'Некорректный тип промокода' });

    if (type === 'coins') {
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ message: 'Некорректная сумма' });
    }

    // generate unique code
    let code = generateCode(10);
    let tries = 0;
    while (tries < 5 && (await PromoCode.findOne({ code }))) {
      code = generateCode(10); tries += 1;
    }

    const promo = new PromoCode({
      code,
      type,
      amount: type === 'coins' ? Number(amount) : 0,
      maxUses: 1,
      createdBy: (req.user?.userId || req.user?._id) || null,
    });

    await promo.save();
    return res.json({ success: true, code: promo.code });
  } catch (e) {
    console.error('wallet/create-promo error', e);
    return res.status(500).json({ message: 'Internal error' });
  }
});

module.exports = router;
