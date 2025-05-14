const { DataTypes } = require('sequelize');

/**
 * Define User model
 * @param {object} sequelize - Sequelize instance
 * @returns {object} User model
 */
const defineUserModel = (sequelize) => {
  const User = sequelize.define('User', {
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    password: {
      type: DataTypes.STRING,
      allowNull: false
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    }
  });

  return User;
};

module.exports = defineUserModel;
