import jwt from 'jsonwebtoken';
import { User } from './models.js';

export async function authenticate(req, res, next) {
  try {
    const token = req.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ message: 'Sign in to continue.' });
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.sub);
    if (!user || !user.active) return res.status(401).json({ message: 'This account is unavailable.' });
    req.user = user;
    next();
  } catch { res.status(401).json({ message: 'Your session is invalid or expired. Please sign in again.' }); }
}

export const allow = (...roles) => (req, res, next) => roles.includes(req.user?.role)
  ? next() : res.status(403).json({ message: 'You do not have permission to perform this action.' });

export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err.code === 11000) return res.status(409).json({ message: 'A record with that unique value already exists.' });
  if (err.name === 'ValidationError') return res.status(400).json({ message: Object.values(err.errors).map(e => e.message).join(', ') });
  if (err.name === 'CastError') return res.status(400).json({ message: 'Invalid record identifier.' });
  if (err.name === 'MulterError' || err.message?.startsWith('Unsupported file')) return res.status(400).json({ message: err.message });
  console.error(err);
  res.status(500).json({ message: 'The server could not complete that request.' });
}
