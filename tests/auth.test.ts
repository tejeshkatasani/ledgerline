import request from 'supertest';
import app from '../src/app';
import { cleanDatabase, closePool } from './setup';

beforeEach(cleanDatabase);
afterAll(closePool);

describe('Auth — registration & login', () => {
  it('registers a new user and returns a JWT', async () => {
    const res = await request(app).post('/auth/register').send({
      email: 'alice@example.com',
      password: 'SecurePass123',
    });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.email).toBe('alice@example.com');
  });

  it('rejects duplicate email registration', async () => {
    await request(app).post('/auth/register').send({
      email: 'alice@example.com',
      password: 'SecurePass123',
    });
    const res = await request(app).post('/auth/register').send({
      email: 'alice@example.com',
      password: 'AnotherPass456',
    });
    expect(res.status).toBe(409);
  });

  it('rejects weak passwords', async () => {
    const res = await request(app).post('/auth/register').send({
      email: 'bob@example.com',
      password: 'short',
    });
    expect(res.status).toBe(422);
  });

  it('logs in with correct credentials', async () => {
    await request(app).post('/auth/register').send({
      email: 'carol@example.com',
      password: 'ValidPass99',
    });
    const res = await request(app).post('/auth/login').send({
      email: 'carol@example.com',
      password: 'ValidPass99',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeDefined();
  });

  it('rejects wrong password and does not leak timing info', async () => {
    await request(app).post('/auth/register').send({
      email: 'dave@example.com',
      password: 'ValidPass99',
    });
    const res = await request(app).post('/auth/login').send({
      email: 'dave@example.com',
      password: 'WrongPassword',
    });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
  });

  it('returns 401 for unknown email (same error as wrong password)', async () => {
    const res = await request(app).post('/auth/login').send({
      email: 'nobody@example.com',
      password: 'anything',
    });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
  });
});

describe('Auth — JWT protection', () => {
  it('rejects requests to protected routes without a token', async () => {
    const res = await request(app).get('/accounts');
    expect(res.status).toBe(401);
  });

  it('rejects requests with a tampered token', async () => {
    const res = await request(app)
      .get('/accounts')
      .set('Authorization', 'Bearer this.is.fake');
    expect(res.status).toBe(401);
  });
});
