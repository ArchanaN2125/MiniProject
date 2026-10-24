import 'dotenv/config';
import 'express-async-errors';
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { User, models, resources } from './models.js';
import { authenticate, allow, errorHandler } from './middleware.js';

const app = express();
const dirname = path.dirname(fileURLToPath(import.meta.url));
const uploads = path.join(dirname, 'uploads');
await mkdir(uploads, { recursive: true });
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173' }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan('tiny'));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60_000, limit: 80, standardHeaders: true, legacyHeaders: false }));
app.get('/api/health', (req, res) => res.json({ status: 'ok', database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' }));

const cleanUser = user => ({ id: user._id, name: user.name, email: user.email, role: user.role, registerNumber: user.registerNumber, phone: user.phone, batch: user.batch, year: user.year, section: user.section, designation: user.designation, qualification: user.qualification, specialization: user.specialization, experience: user.experience, bio: user.bio, skills: user.skills });
const issueToken = user => jwt.sign({ sub: user._id.toString() }, process.env.JWT_SECRET, { expiresIn: '12h' });
const isEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value || '');
const escapeRegex = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const validateContactFields = body => {
  if (body.email && !isEmail(body.email)) return 'Enter a valid email address.';
  for (const key of ['github','demo','registrationLink','image','logo']) if (body[key]) {
    try { const url = new URL(body[key]); if (!['http:','https:'].includes(url.protocol)) throw new Error(); }
    catch { return `${key} must be a valid http or https URL.`; }
  }
  return null;
};

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, registerNumber } = req.body;
  if (!name?.trim() || !isEmail(email) || !/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(password || '')) return res.status(400).json({ message: 'Enter your name, a valid email and a password with at least 8 characters, including a number.' });
  const user = await User.create({ name: name.trim(), email: email.toLowerCase(), password: await bcrypt.hash(password, 12), registerNumber, role: 'student' });
  await models.students.create({ name: user.name, email: user.email, registerNumber: registerNumber || `NEW-${user._id.toString().slice(-6).toUpperCase()}`, user: user._id });
  res.status(201).json({ token: issueToken(user), user: cleanUser(user) });
});
app.post('/api/auth/login', async (req, res) => {
  const user = await User.findOne({ email: String(req.body.email || '').toLowerCase() }).select('+password');
  if (!user || !user.active || !(await bcrypt.compare(req.body.password || '', user.password))) return res.status(401).json({ message: 'Email or password is incorrect.' });
  res.json({ token: issueToken(user), user: cleanUser(user) });
});
app.get('/api/auth/me', authenticate, (req, res) => res.json({ user: cleanUser(req.user) }));
app.put('/api/auth/profile', authenticate, async (req, res) => {
  const allowed = ['name','phone','batch','year','section','bio','skills','designation','qualification','specialization','experience'];
  for (const key of allowed) if (req.body[key] !== undefined) req.user[key] = req.body[key];
  await req.user.save(); res.json({ user: cleanUser(req.user) });
});
app.put('/api/auth/password', authenticate, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = await User.findById(req.user._id).select('+password');
  if (!(await bcrypt.compare(currentPassword || '', user.password))) return res.status(400).json({ message: 'Current password is incorrect.' });
  if (!/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(newPassword || '')) return res.status(400).json({ message: 'New password must be at least 8 characters and include a number.' });
  user.password = await bcrypt.hash(newPassword, 12); await user.save(); res.json({ message: 'Password changed. Sign in again on your other devices.' });
});

app.get('/api/dashboard', authenticate, async (req, res) => {
  const counts = await Promise.all(['students','faculty','courses','subjects','announcements','events','projects','placements'].map(async key => [key, await models[key].countDocuments()]));
  const upcomingEvents = await models.events.find({ date: { $gte: new Date() } }).sort({ date: 1 }).limit(4);
  const placements = await models.placements.find();
  res.json({ counts: Object.fromEntries(counts), placement: { companies: new Set(placements.map(p => p.company)).size, placed: placements.reduce((n, p) => n + p.studentsPlaced, 0), highestPackage: Math.max(0, ...placements.map(p => p.packageLpa)) }, upcomingEvents });
});

const fileFilter = (req, file, cb) => {
  const allowed = ['application/pdf','image/jpeg','image/png','image/webp','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation'];
  cb(allowed.includes(file.mimetype) ? null : new Error('Unsupported file type. Use PDF, Office documents, or an image.'), allowed.includes(file.mimetype));
};
const upload = multer({ storage: multer.diskStorage({ destination: uploads, filename: (req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`) }), limits: { fileSize: 10 * 1024 * 1024 }, fileFilter });

app.get('/api/:resource', (req, res, next) => ['students','notifications'].includes(req.params.resource) ? authenticate(req, res, next) : next(), async (req, res, next) => {
  if (!resources.includes(req.params.resource)) return next();
  if (req.params.resource === 'students' && (!req.user || !['admin','faculty'].includes(req.user.role))) return res.status(403).json({ message: 'Student directory is available to faculty and administrators.' });
  const Model = models[req.params.resource];
  const page = Math.max(1, Number(req.query.page) || 1), limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const filter = {};
  if (req.params.resource === 'notifications') filter.user = req.user._id;
  if (req.query.search) {
    const fields = Object.keys(Model.schema.paths).filter(k => Model.schema.paths[k].instance === 'String');
    filter.$or = fields.map(field => ({ [field]: { $regex: escapeRegex(String(req.query.search).slice(0, 100)), $options: 'i' } }));
  }
  for (const key of ['category','priority','day','section','semester','year','subject','designation','batch']) if (req.query[key]) filter[key] = req.query[key];
  if (req.query.upcoming === 'true') filter.date = { $gte: new Date() };
  if (req.query.upcoming === 'past') filter.date = { $lt: new Date() };
  const sort = req.params.resource === 'timetable' ? { day: 1, startTime: 1 } : { createdAt: -1 };
  const [items, total] = await Promise.all([Model.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).lean(), Model.countDocuments(filter)]);
  res.json({ items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});
app.get('/api/:resource/:id', (req, res, next) => ['students','notifications'].includes(req.params.resource) ? authenticate(req, res, next) : next(), async (req, res, next) => {
  if (!resources.includes(req.params.resource)) return next();
  const item = await models[req.params.resource].findById(req.params.id);
  if (!item) return res.status(404).json({ message: 'Record not found.' });
  if (req.params.resource === 'notifications' && item.user.toString() !== req.user._id.toString()) return res.status(404).json({ message: 'Record not found.' });
  res.json({ item });
});

const adminOnly = allow('admin');
const staff = allow('admin','faculty');
app.post('/api/materials', authenticate, staff, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Choose a document to upload.' });
  const item = await models.materials.create({ ...req.body, originalName: req.file?.originalname, storedName: req.file?.filename, mimeType: req.file?.mimetype, size: req.file?.size, uploadedBy: req.user._id, faculty: req.user.name });
  res.status(201).json({ item });
});
app.post('/api/:resource', authenticate, async (req, res, next) => {
  const key = req.params.resource;
  if (!resources.includes(key)) return next();
  if (key === 'announcements' && ['admin','faculty'].includes(req.user.role)) { req.body.author = req.user.name; }
  else if (key === 'materials' && ['admin','faculty'].includes(req.user.role)) return res.status(400).json({ message: 'Upload materials using multipart file data.' });
  else if (req.user.role !== 'admin') return res.status(403).json({ message: 'You do not have permission to create this record.' });
  const invalid = validateContactFields(req.body); if (invalid) return res.status(400).json({ message: invalid });
  const item = await models[key].create(req.body); res.status(201).json({ item });
});
app.put('/api/:resource/:id', authenticate, async (req, res, next) => {
  const key = req.params.resource;
  if (!resources.includes(key)) return next();
  if (key === 'announcements' && req.user.role === 'faculty') {
    const owned = await models.announcements.findOne({ _id: req.params.id, author: req.user.name });
    if (!owned) return res.status(403).json({ message: 'Faculty can edit only their own announcements.' });
    req.body.author = req.user.name;
  } else if (key === 'materials' && req.user.role === 'faculty') {
    const owned = await models.materials.findOne({ _id: req.params.id, uploadedBy: req.user._id });
    if (!owned) return res.status(403).json({ message: 'Faculty can edit only materials they uploaded.' });
  } else if (req.user.role !== 'admin') return res.status(403).json({ message: 'You do not have permission to update this record.' });
  const invalid = validateContactFields(req.body); if (invalid) return res.status(400).json({ message: invalid });
  const item = await models[key].findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!item) return res.status(404).json({ message: 'Record not found.' }); res.json({ item });
});
app.delete('/api/:resource/:id', authenticate, async (req, res, next) => {
  const key = req.params.resource;
  if (!resources.includes(key)) return next();
  if (key === 'announcements' && req.user.role === 'faculty') {
    const owned = await models.announcements.findOne({ _id: req.params.id, author: req.user.name });
    if (!owned) return res.status(403).json({ message: 'Faculty can delete only their own announcements.' });
  } else if (key === 'materials' && req.user.role === 'faculty') {
    const owned = await models.materials.findOne({ _id: req.params.id, uploadedBy: req.user._id });
    if (!owned) return res.status(403).json({ message: 'Faculty can delete only materials they uploaded.' });
  } else if (req.user.role !== 'admin') return res.status(403).json({ message: 'You do not have permission to delete this record.' });
  const item = await models[key].findByIdAndDelete(req.params.id);
  if (!item) return res.status(404).json({ message: 'Record not found.' });
  if (key === 'materials' && item.storedName) await unlink(path.join(uploads, item.storedName)).catch(() => {});
  res.json({ message: 'Record deleted.' });
});
app.get('/api/files/:id', authenticate, async (req, res) => {
  const item = await models.materials.findById(req.params.id);
  if (!item?.storedName) return res.status(404).json({ message: 'File not found.' });
  res.download(path.join(uploads, item.storedName), item.originalName || 'study-material');
});

app.get('/api/users', authenticate, adminOnly, async (req, res) => {
  const users = await User.find(req.query.role ? { role: req.query.role } : {}).sort({ createdAt: -1 });
  res.json({ items: users.map(cleanUser) });
});
app.put('/api/users/:id/role', authenticate, adminOnly, async (req, res) => {
  if (!['student','faculty','admin'].includes(req.body.role)) return res.status(400).json({ message: 'Select a valid role.' });
  if (req.params.id === req.user.id && req.body.role !== 'admin') return res.status(400).json({ message: 'You cannot remove your own administrator role.' });
  const user = await User.findByIdAndUpdate(req.params.id, { role: req.body.role }, { new: true, runValidators: true });
  if (!user) return res.status(404).json({ message: 'User not found.' }); res.json({ user: cleanUser(user) });
});

app.use('/api', (req, res) => res.status(404).json({ message: 'API route not found.' }));
app.use(errorHandler);

const start = async () => {
  if (!process.env.JWT_SECRET || !process.env.MONGO_URI) throw new Error('Set MONGO_URI and JWT_SECRET in server/.env.');
  await mongoose.connect(process.env.MONGO_URI);
  const port = process.env.PORT || 5000;
  app.listen(port, () => console.log(`Department Portal API listening on ${port}`));
};
if (process.env.NODE_ENV !== 'test') start().catch(err => { console.error(err.message); process.exit(1); });

export default app;
