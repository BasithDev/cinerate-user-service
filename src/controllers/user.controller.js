const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getUser } = require('../config/database');

class UserController {
  constructor(dbCircuitBreaker) {
    this.dbCircuitBreaker = dbCircuitBreaker;
    this.JWT_SECRET = process.env.JWT_SECRET || 'default-jwt-secret-for-development';
    
    if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
      console.warn('WARNING: Using default JWT_SECRET in production environment!');
    }
  }

  /**
   * Get user by ID
   */
  async getUserById(req, res) {
    const userId = req.params.id;
    if (!userId) return res.status(400).send('No user ID provided');

    try {
      const user = await this.dbCircuitBreaker.fire(async () => {
        return await getUser().findByPk(userId);
      });
      
      if (!user) return res.status(404).send('User not found');

      res.json({ name: user.name, email: user.email });
    } catch (err) {
      console.error('Error fetching user:', err);
      res.status(500).send('Internal server error');
    }
  }

  /**
   * Update user profile
   */
  async updateUser(req, res) {
    const { userId, name, email } = req.body;
    
    try {
      const [updated] = await this.dbCircuitBreaker.fire(async () => {
        return await getUser().update(
          { name, email },
          { where: { id: userId } }
        );
      }, 'update_user');
      
      if (updated === 0) {
        return res.status(404).send('User not found');
      }
      
      // Invalidate user cache after update
      if (req.redisCache) {
        await req.redisCache.del(userId);
      }
      
      res.json({ message: 'User updated' });
    } catch (err) {
      console.error('Error updating user:', err);
      res.status(500).send('Internal server error');
    }
  }

  /**
   * Change user password
   */
  async changePassword(req, res) {
    const { userId, oldPassword, newPassword } = req.body;
    
    try {
      const user = await this.dbCircuitBreaker.fire(async () => {
        return await getUser().findByPk(userId);
      });
      
      if (!user) return res.status(404).send('User not found');

      const isMatch = await bcrypt.compare(oldPassword, user.password);
      if (!isMatch) return res.status(400).send('Invalid credentials');

      const hashedPassword = await bcrypt.hash(newPassword, 10);
      
      await this.dbCircuitBreaker.fire(async () => {
        user.password = hashedPassword;
        return await user.save();
      }, 'update_user_password');

      res.json({ message: 'Password changed' });
    } catch (err) {
      console.error('Error changing password:', err);
      res.status(500).send('Internal server error');
    }
  }

  /**
   * User signup
   */
  async signup(req, res) {
    const { email, password, name } = req.body;
    
    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      
      await this.dbCircuitBreaker.fire(async () => {
        return await getUser().create({ email, password: hashedPassword, name });
      }, 'create_user');
      
      res.status(201).json({ message: 'User created' });
    } catch (error) {
      if (error.name === 'SequelizeUniqueConstraintError') {
        return res.status(400).json({ message: 'Email already in use' });
      }
      console.error('Error creating user:', error);
      res.status(500).send('Internal server error');
    }
  }

  /**
   * User login
   */
  async login(req, res) {
    const { email, password } = req.body;
    
    try {
      const user = await this.dbCircuitBreaker.fire(async () => {
        return await getUser().findOne({ where: { email } });
      }, 'find_user_by_email');
      
      if (!user) return res.status(400).json({ message: 'Invalid credentials' });

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });

      const accessToken = jwt.sign({ userId: user.id }, this.JWT_SECRET, { expiresIn: '3h' });

      res.json({ accessToken, userId: user.id, name: user.name });
    } catch (err) {
      console.error('Error during login:', err);
      res.status(500).send('Internal server error');
    }
  }
}

module.exports = UserController;
