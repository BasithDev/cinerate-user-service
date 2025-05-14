/**
 * Create a mock User model for testing
 * @returns {object} Mock User model
 */
const createMockUserModel = () => {
  // Mock user data store for tests
  const mockUsers = [];
  let mockUserId = 1;
  
  // Create a mock User model
  const User = {
    findAll: async () => mockUsers,
    findOne: async (query) => {
      let user = null;
      if (query.where.id) {
        user = mockUsers.find(user => user.id === query.where.id) || null;
      } else if (query.where.email) {
        user = mockUsers.find(user => user.email === query.where.email) || null;
      }
      
      if (user) {
        // Add save method to the user object
        user.save = async () => {
          const index = mockUsers.findIndex(u => u.id === user.id);
          if (index >= 0) {
            mockUsers[index] = { ...user };
            return user;
          }
          return null;
        };
      }
      return user;
    },
    findByPk: async (id) => {
      const user = mockUsers.find(user => user.id === parseInt(id)) || null;
      if (user) {
        // Add save method to the user object
        user.save = async () => {
          const index = mockUsers.findIndex(u => u.id === user.id);
          if (index >= 0) {
            mockUsers[index] = { ...user };
            return user;
          }
          return null;
        };
      }
      return user;
    },
    create: async (data) => {
      const newUser = { ...data, id: mockUserId++ };
      mockUsers.push(newUser);
      return newUser;
    },
    update: async (data, query) => {
      const userIndex = mockUsers.findIndex(user => user.id === query.where.id);
      if (userIndex >= 0) {
        mockUsers[userIndex] = { ...mockUsers[userIndex], ...data };
        return [1];  // Return 1 row affected
      }
      return [0];
    },
    destroy: async (query) => {
      const initialLength = mockUsers.length;
      const userIndex = mockUsers.findIndex(user => user.id === query.where.id);
      if (userIndex >= 0) {
        mockUsers.splice(userIndex, 1);
        return initialLength - mockUsers.length; // Return number of rows affected
      }
      return 0;
    }
  };

  return User;
};

/**
 * Create a mock sequelize instance
 * @returns {object} Mock sequelize instance
 */
const createMockSequelize = (User) => {
  return {
    authenticate: async () => true,
    sync: async () => true,
    define: (modelName, attributes, options) => {
      // We've already defined User above, so just return it
      return User;
    },
    getDialect: () => 'postgres (mock)',
    drop: async () => true,
    close: async () => true
  };
};

module.exports = {
  createMockUserModel,
  createMockSequelize
};
