const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { app, connectToDatabase } = require('../index');

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await connectToDatabase(uri);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('User API tests', () => {
  let userId;

  test('POST /signup - should register a user', async () => {
    const res = await request(app).post('/signup').send({
      name: 'Test User',
      email: 'test@example.com',
      password: 'password123',
    });

    expect(res.statusCode).toBe(201);
    expect(res.body.message).toBe('User created');
  });

  test('POST /login - should login and return token', async () => {
    const res = await request(app).post('/login').send({
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
    const res = await request(app).get(`/${userId}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.email).toBe('test@example.com');
  });

  test('POST /update - should update user data', async () => {
    const res = await request(app).post('/update').send({
      userId,
      name: 'Updated User',
      email: 'updated@example.com',
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe('User updated');
  });

  test('POST /change-password - should change user password', async () => {
    const res = await request(app).post('/change-password').send({
      userId,
      oldPassword: 'password123',
      newPassword: 'newPassword456',
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe('Password changed');
  });

  test('POST /login - login with new password', async () => {
    const res = await request(app).post('/login').send({
      email: 'updated@example.com',
      password: 'newPassword456',
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('accessToken');
  });
});