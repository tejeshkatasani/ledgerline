import request from 'supertest';
import app from '../src/app';
import { cleanDatabase, closePool } from './setup';

beforeEach(cleanDatabase);
afterAll(closePool);

async function createUserAndToken(
  email = 'user@example.com',
  password = 'TestPass123'
) {
  const res = await request(app)
    .post('/auth/register')
    .send({ email, password });
  return res.body.data.token as string;
}

describe('Accounts', () => {
  it('creates an account for the authenticated user', async () => {
    const token = await createUserAndToken();
    const res = await request(app)
      .post('/accounts')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Savings', currency: 'USD', initialBalance: 1000 });
    expect(res.status).toBe(201);
    expect(res.body.data.balance).toBe('1000.00');
    expect(res.body.data.name).toBe('Savings');
  });

  it('lists only the caller's accounts', async () => {
    const tokenA = await createUserAndToken('a@example.com');
    const tokenB = await createUserAndToken('b@example.com');

    await request(app)
      .post('/accounts')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'A account', currency: 'USD' });
    await request(app)
      .post('/accounts')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ name: 'B account', currency: 'USD' });

    const res = await request(app)
      .get('/accounts')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('A account');
  });

  it('forbids accessing another user's account', async () => {
    const tokenA = await createUserAndToken('a2@example.com');
    const tokenB = await createUserAndToken('b2@example.com');

    const createRes = await request(app)
      .post('/accounts')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Private', currency: 'USD' });
    const accountId = createRes.body.data.id;

    const res = await request(app)
      .get(`/accounts/${accountId}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(403);
  });

  it('rejects closing an account with non-zero balance', async () => {
    const token = await createUserAndToken('c@example.com');
    const createRes = await request(app)
      .post('/accounts')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Funded', currency: 'USD', initialBalance: 500 });
    const accountId = createRes.body.data.id;

    const res = await request(app)
      .delete(`/accounts/${accountId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(422);
  });
});
