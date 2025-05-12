const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv').config();
// Ensure JWT_SECRET is always available
const JWT_SECRET = process.env.JWT_SECRET || 'default-jwt-secret-for-development';

// Log warning if using default secret in production
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  console.warn('WARNING: Using default JWT_SECRET in production environment!');
}

const app = express();
app.use(express.json());

const UserSchema = new mongoose.Schema({
  email: { type: String, unique: true },
  password: String,
  name: String,
});
const User = mongoose.model('User', UserSchema);

app.use(express.json());

app.get('/test', (req, res) => {
  res.send('User service is running');
});

app.get('/:id', async (req, res) => {
  const userId = req.params.id;
  if (!userId) return res.status(400).send('No user ID provided');

  const user = await User.findOne({ _id: userId });
  if (!user) return res.status(404).send('User not found');

  res.json({ name: user.name, email: user.email });
});

app.post('/update', async (req, res) => {
  const { userId, name, email } = req.body;
  const user = await User.findOneAndUpdate({ _id: userId }, { name, email }, { new: true });
  if (!user) return res.status(404).send('User not found');

  res.json({ message: 'User updated' });
});

app.post('/change-password', async (req, res) => {
  const { userId, oldPassword, newPassword } = req.body;
  const user = await User.findOne({ _id: userId });
  if (!user) return res.status(404).send('User not found');

  const isMatch = await bcrypt.compare(oldPassword, user.password);
  if (!isMatch) return res.status(400).send('Invalid credentials');

  const hashedPassword = await bcrypt.hash(newPassword, 10);
  user.password = hashedPassword;
  await user.save();

  res.json({ message: 'Password changed' });
});

app.post('/signup', async (req, res) => {
  const { email, password, name } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const user = new User({ email, password: hashedPassword, name });

  try {
    await user.save();
    res.status(201).json({ message: 'User created' });
  } catch (error) {
    if (error.name === 'MongoServerError' && error.code === 11000) {
      return res.status(400).json({ message: 'Email already in use' });
    }
    throw error;
  }
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });   
  if (!user) return res.status(400).json({ message: 'Invalid credentials' });

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });

  const accessToken = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '3h' });

  res.json({ accessToken, userId: user._id, name: user.name });
});

// Robust error logging middleware for debugging
app.use((err, req, res) => {
  console.error('Express error:', err.stack || err);
  res.status(500).json({ message: 'Internal Server Error', error: err.message });
});

async function connectToDatabase(uri) {
  await mongoose.connect(uri);
}

if (require.main === module) {
  const PORT = process.env.PORT || 3001;
  connectToDatabase(process.env.MONGO_URI || 'mongodb://localhost:27017/cineRate-user-db').then(() => {
    app.listen(PORT, () => {
      console.log(`User service running on port ${PORT}`);
    });
  });
}

module.exports = { app, connectToDatabase };