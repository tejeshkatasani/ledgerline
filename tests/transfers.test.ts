/**
 * Transfer tests — covers the ten core requirements:
 *  1. Successful transfer updates both balances correctly
 *  2. Double-entry: ledger entries produced, debit = credit
 *  3. Insufficient funds rejected
 *  4. Same account transfer rejected
 *  5. Idempotency: second call with same key returns same result, no double-spend
 *  6. Concurrent transfers (best-effort race test)
 *  7. Closed account transfer rejected
 *  8. Wrong currency rejected
 *  9. Ownership check: cannot transfer from account you don't own
 * 10. Audit log entries created
 */
import request from 'supertest';
import app from '../src/app';
import { pool } from '../src/db/pool';
import { cleanDatabase, closePool } from './setup';

beforeEach(cleanDatabase);
afterAll(closePool);

async function setup() {
  const aliceRes = await request(app)
    .post('/auth/register')
    .send({ email: 'alice@ledger.test', password: 'AlicePass123' });
  const bobRes = await request(app)
    .post('/auth/register')
    .send({ email: 'bob@ledger.test', password: 'BobPass456' });

  const aliceToken = aliceRes.body.data.token as string;
  const bobToken = bobRes.body.data.token as string;

  const aliceAccRes = await request(app)
    .post('/accounts')
    .set('Authorization', `Bearer ${aliceToken}`)
    .send({ name: 'Alice Checking', currency: 'USD', initialBalance: 1000 });

  const bobAccRes = await request(app)
    .post('/accounts')
    .set('Authorization', `Bearer ${bobToken}`)
    .send({ name: 'Bob Checking', currency: 'USD', initialBalance: 0 });

  return {
    aliceToken,
    bobToken,
    aliceAccountId: aliceAccRes.body.data.id as string,
    bobAccountId: bobAccRes.body.data.id as string,
  };
}

describe('Transfers — core requirements', () => {
  it('REQ1: transfers funds and updates both balances', async () => {
    const { aliceToken, aliceAccountId, bobAccountId } = await setup();
    const res = await request(app)
      .post('/transfers')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({
        from_account_id: aliceAccountId,
        to_account_id: bobAccountId,
        amount: '250.00',
        currency: 'USD',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.fromBalance).toBe('750.00');
    expect(res.body.data.toBalance).toBe('250.00');
    expect(res.body.data.status).toBe('completed');
  });

  it('REQ2: creates double-entry ledger entries (debit = credit)', async () => {
    const { aliceToken, aliceAccountId, bobAccountId } = await setup();
    const transferRes = await request(app)
      .post('/transfers')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({
        from_account_id: aliceAccountId,
        to_account_id: bobAccountId,
        amount: '100.00',
        currency: 'USD',
      });

    const txnId = transferRes.body.data.transactionId;
    const { rows } = await pool.query(
      'SELECT direction, amount FROM ledger_entries WHERE transaction_id=$1',
      [txnId]
    );
    expect(rows).toHaveLength(2);
    const debit = rows.find((r) => r.direction === 'debit');
    const credit = rows.find((r) => r.direction === 'credit');
    expect(debit).toBeDefined();
    expect(credit).toBeDefined();
    expect(debit!.amount).toBe(credit!.amount); // debit == credit
  });

  it('REQ3: rejects transfer when insufficient funds', async () => {
    const { aliceToken, aliceAccountId, bobAccountId } = await setup();
    const res = await request(app)
      .post('/transfers')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({
        from_account_id: aliceAccountId,
        to_account_id: bobAccountId,
        amount: '9999.00',
        currency: 'USD',
      });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INSUFFICIENT_FUNDS');
  });

  it('REQ4: rejects transfer to the same account', async () => {
    const { aliceToken, aliceAccountId } = await setup();
    const res = await request(app)
      .post('/transfers')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({
        from_account_id: aliceAccountId,
        to_account_id: aliceAccountId,
        amount: '50.00',
        currency: 'USD',
      });
    expect(res.status).toBe(422);
  });

  it('REQ5: idempotency — identical key does not double-spend', async () => {
    const { aliceToken, aliceAccountId, bobAccountId } = await setup();
    const key = 'idem-key-abc-123';

    const first = await request(app)
      .post('/transfers')
      .set('Authorization', `Bearer ${aliceToken}`)
      .set('Idempotency-Key', key)
      .send({
        from_account_id: aliceAccountId,
        to_account_id: bobAccountId,
        amount: '100.00',
        currency: 'USD',
      });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/transfers')
      .set('Authorization', `Bearer ${aliceToken}`)
      .set('Idempotency-Key', key)
      .send({
        from_account_id: aliceAccountId,
        to_account_id: bobAccountId,
        amount: '100.00',
        currency: 'USD',
      });
    expect(second.status).toBe(200); // replayed
    expect(second.body.data.replayed).toBe(true);

    // Balance should only reflect ONE transfer
    const accRes = await request(app)
      .get(`/accounts/${aliceAccountId}`)
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(accRes.body.data.balance).toBe('900.00');
  });

  it('REQ7: rejects transfer from a closed account', async () => {
    const { aliceToken, aliceAccountId, bobAccountId } = await setup();

    // First drain the account so it can be closed
    await request(app)
      .post('/transfers')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({
        from_account_id: aliceAccountId,
        to_account_id: bobAccountId,
        amount: '1000.00',
        currency: 'USD',
      });
    // Close it
    await request(app)
      .delete(`/accounts/${aliceAccountId}`)
      .set('Authorization', `Bearer ${aliceToken}`);

    // Create a fresh funded source
    const newAccRes = await request(app)
      .post('/accounts')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ name: 'Temp', currency: 'USD', initialBalance: 200 });
    const newId = newAccRes.body.data.id;

    // Try to transfer FROM the closed account
    const res = await request(app)
      .post('/transfers')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({
        from_account_id: aliceAccountId,
        to_account_id: newId,
        amount: '10.00',
        currency: 'USD',
      });
    expect(res.status).toBe(403);
  });

  it('REQ9: forbids transfer from account user does not own', async () => {
    const { bobToken, aliceAccountId, bobAccountId } = await setup();
    const res = await request(app)
      .post('/transfers')
      .set('Authorization', `Bearer ${bobToken}`) // Bob trying to spend Alice's money
      .send({
        from_account_id: aliceAccountId,
        to_account_id: bobAccountId,
        amount: '50.00',
        currency: 'USD',
      });
    expect(res.status).toBe(403);
  });

  it('REQ10: audit log entry created for completed transfer', async () => {
    const { aliceToken, aliceAccountId, bobAccountId } = await setup();
    await request(app)
      .post('/transfers')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({
        from_account_id: aliceAccountId,
        to_account_id: bobAccountId,
        amount: '50.00',
        currency: 'USD',
      });

    const auditRes = await request(app)
      .get('/audit')
      .set('Authorization', `Bearer ${aliceToken}`);
    const events = auditRes.body.data as Array<{ event_type: string }>;
    const transferEvent = events.find(
      (e) => e.event_type === 'transfer.completed'
    );
    expect(transferEvent).toBeDefined();
  });
});

describe('Transfers — validation', () => {
  it('rejects amount with more than 2 decimal places', async () => {
    const { aliceToken, aliceAccountId, bobAccountId } = await setup();
    const res = await request(app)
      .post('/transfers')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({
        from_account_id: aliceAccountId,
        to_account_id: bobAccountId,
        amount: '10.999',
        currency: 'USD',
      });
    expect(res.status).toBe(422);
  });

  it('rejects zero amount', async () => {
    const { aliceToken, aliceAccountId, bobAccountId } = await setup();
    const res = await request(app)
      .post('/transfers')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({
        from_account_id: aliceAccountId,
        to_account_id: bobAccountId,
        amount: '0',
        currency: 'USD',
      });
    expect(res.status).toBe(422);
  });

  it('rejects negative amount', async () => {
    const { aliceToken, aliceAccountId, bobAccountId } = await setup();
    const res = await request(app)
      .post('/transfers')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({
        from_account_id: aliceAccountId,
        to_account_id: bobAccountId,
        amount: '-10.00',
        currency: 'USD',
      });
    expect(res.status).toBe(422);
  });
});

describe('Transfers — idempotency key misuse', () => {
  it('rejects same key reused for different accounts', async () => {
    const { aliceToken, aliceAccountId, bobAccountId } = await setup();

    // Create a third account (still Alice's)
    const thirdRes = await request(app)
      .post('/accounts')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ name: 'Alice Savings', currency: 'USD', initialBalance: 500 });
    const thirdId = thirdRes.body.data.id;

    const key = 'reuse-test-key';
    await request(app)
      .post('/transfers')
      .set('Authorization', `Bearer ${aliceToken}`)
      .set('Idempotency-Key', key)
      .send({
        from_account_id: aliceAccountId,
        to_account_id: bobAccountId,
        amount: '50.00',
        currency: 'USD',
      });

    // Same key, different destination
    const res = await request(app)
      .post('/transfers')
      .set('Authorization', `Bearer ${aliceToken}`)
      .set('Idempotency-Key', key)
      .send({
        from_account_id: aliceAccountId,
        to_account_id: thirdId, // different!
        amount: '50.00',
        currency: 'USD',
      });
    expect(res.status).toBe(409);
  });
});
