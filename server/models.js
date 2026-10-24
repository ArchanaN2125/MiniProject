import mongoose from 'mongoose';

const { Schema } = mongoose;
const schemaFor = (fields, indexes = []) => {
  const schema = new Schema(fields, { timestamps: true, strict: true });
  indexes.forEach(index => schema.index(index));
  return schema;
};
const text = (required = true) => ({ type: String, required, trim: true, maxlength: 4000 });
const number = (min = 0) => ({ type: Number, min, default: 0 });

export const User = mongoose.models.User || mongoose.model('User', schemaFor({
  name: text(), email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, select: false }, role: { type: String, enum: ['student','faculty','admin'], default: 'student' },
  registerNumber: text(false), phone: text(false), batch: text(false), year: { type: Number, min: 1 }, section: text(false),
  designation: text(false), qualification: text(false), specialization: text(false), experience: number(),
  bio: text(false), skills: { type: [String], default: [] }, active: { type: Boolean, default: true }
}, [{ registerNumber: 1 }]));

const definitions = {
  department: { name: text(), code: text(), about: text(), vision: text(), mission: text(), objectives: [String], history: text(false), hodMessage: text(false), accreditation: text(false), facilities: [String], email: text(false), phone: text(false), address: text(false) },
  faculty: { name: text(), email: { type: String, lowercase: true, trim: true }, designation: text(), qualification: text(false), specialization: text(false), experience: number(), researchInterests: [String], publications: [String], image: text(false), bio: text(false), user: { type: Schema.Types.ObjectId, ref: 'User' } },
  students: { name: text(), email: { type: String, lowercase: true, trim: true }, registerNumber: text(), batch: text(false), year: { type: Number, min: 1 }, section: text(false), phone: text(false), skills: [String], user: { type: Schema.Types.ObjectId, ref: 'User' } },
  courses: { name: text(), code: { type: String, required: true, unique: true, uppercase: true, trim: true }, description: text(false), duration: text(false), semester: number(), credits: number() },
  subjects: { name: text(), code: { type: String, required: true, unique: true, uppercase: true, trim: true }, semester: number(1), credits: number(), faculty: text(false), description: text(false), course: text(false) },
  timetable: { day: { type: String, enum: ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'], required: true }, startTime: text(), endTime: text(), subject: text(), faculty: text(false), room: text(false), section: text(false), year: { type: Number, min: 1, required: true }, semester: number(1) },
  announcements: { title: text(), description: text(), category: { type: String, default: 'General' }, author: text(false), priority: { type: String, enum: ['Normal','Important','Urgent'], default: 'Normal' }, date: { type: Date, default: Date.now }, attachment: text(false) },
  events: { title: text(), description: text(), date: { type: Date, required: true }, startTime: text(false), endTime: text(false), venue: text(false), organizer: text(false), image: text(false), registrationLink: text(false) },
  materials: { title: text(), subject: text(false), semester: number(), faculty: text(false), description: text(false), originalName: text(false), storedName: text(false), mimeType: text(false), size: number(), uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' } },
  achievements: { title: text(), description: text(), category: text(false), date: { type: Date, default: Date.now }, image: text(false), recipient: text(false) },
  placements: { company: text(), role: text(false), packageLpa: number(), year: { type: Number, min: 2000, required: true }, studentsPlaced: number(), studentNames: [String], logo: text(false) },
  projects: { title: text(), description: text(), students: [String], mentor: text(false), technologies: [String], github: text(false), demo: text(false), image: text(false), year: number(2000) },
  clubs: { name: text(), description: text(), coordinator: text(false), members: [String], activities: [String], image: text(false), contact: text(false) },
  labs: { name: text(), description: text(), equipment: [String], capacity: number(), inCharge: text(false), image: text(false) },
  notifications: { title: text(), message: text(), user: { type: Schema.Types.ObjectId, ref: 'User', required: true }, read: { type: Boolean, default: false }, link: text(false) }
};

export const models = Object.fromEntries(Object.entries(definitions).map(([name, fields]) => [name, mongoose.models[name] || mongoose.model(name, schemaFor(fields))]));
export const resources = Object.keys(definitions);
