// Set NODE_ENV to 'test' before importing app
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.USE_MOCK_DB = 'true';

const request = require('supertest');

// Import database configuration to access connectToDatabase function
const { connectToDatabase } = require('../src/config/database');

// Import the app after setting environment variables
const { app } = require('../src/app');

// Create a server for testing
let server;

beforeAll(async () => {
  // Connect to mock database for testing
  await connectToDatabase();
  
  // Create test server
  server = app.listen(0);
});

afterAll(async () => {
  // Close the server to prevent Jest hanging
  if (server) {
    await new Promise((resolve) => {
      server.close(resolve);
    });
  }
});

describe('User API tests', () => {
  let userId;

  test('POST /signup - should register a user', async () => {
    const res = await request(server).post('/signup').send({
      name: 'Test User',
      email: 'test@example.com',
      password: 'password123',
    });

    expect(res.statusCode).toBe(201);
    expect(res.body.message).toBe('User created');
  });

  test('POST /login - should login and return token', async () => {
    const res = await request(server).post('/login').send({
      email: 'test@example.com',
      password: 'password123',
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('userId');
    userId = res.body.userId;
    token = res.body.accessToken;
  });

  test('GET /:id - should get user data', async () => {
    const res = await request(server).get(`/${userId}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.email).toBe('test@example.com');
  });

  test('POST /update - should update user data', async () => {
    const res = await request(server).post('/update').send({
      userId,
      name: 'Updated User',
      email: 'updated@example.com',
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe('User updated');
  });

  test('POST /change-password - should change user password', async () => {
    const res = await request(server).post('/change-password').send({
      userId,
      oldPassword: 'password123',
      newPassword: 'newPassword456',
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe('Password changed');
  });

  test('POST /login - login with new password', async () => {
    const res = await request(server).post('/login').send({
      email: 'updated@example.com',
      password: 'newPassword456',
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('accessToken');
  });
});