const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { createApp } = require('../src/app');
const UserModel = require('../src/infrastructure/persistence/schemas/userSchema');
const EmailMatchModel = require('../src/infrastructure/persistence/schemas/emailMatchSchema');
const MongoUserRepository = require('../src/infrastructure/persistence/MongoUserRepository');

let mongoServer;
let app;
let userRepo;
let mockOAuthClient;
let mockEnqueueSyncJob;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { dbName: 'test' });

  userRepo = new MongoUserRepository();

  mockOAuthClient = {
    getAuthorizationUrl: jest.fn((state) =>
      `https://api.login.yahoo.com/oauth2/request_auth?state=${state}&mock=true`,
    ),
    exchangeCode: jest.fn().mockResolvedValue({
      accessToken: 'mock_access_token',
      refreshToken: 'mock_refresh_token',
      expiresIn: 3600,
      idToken: 'mock_id_token',
      xoauth_yahoo_guid: 'mock_guid',
    }),
    getUserProfile: jest.fn().mockResolvedValue({
      yahooId: 'yahoo_user_123',
      email: 'testuser@yahoo.com',
    }),
    refreshAccessToken: jest.fn().mockResolvedValue({
      accessToken: 'refreshed_access_token',
      refreshToken: 'refreshed_refresh_token',
      expiresIn: 3600,
    }),
  };

  mockEnqueueSyncJob = jest.fn().mockResolvedValue('sync-some_user_id');

  app = createApp({
    userRepository: userRepo,
    oauthClient: mockOAuthClient,
    enqueueSyncJob: mockEnqueueSyncJob,
  });
}, 30_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  await UserModel.deleteMany({});
  await EmailMatchModel.deleteMany({});
  jest.clearAllMocks();
});

// ---------- GET /health ----------

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

// ---------- POST /api/yahoo/connect ----------

describe('POST /api/yahoo/connect', () => {
  it('returns an authorization URL and state', async () => {
    const res = await request(app).post('/api/yahoo/connect');

    expect(res.status).toBe(200);
    expect(res.body.authorizationUrl).toContain('api.login.yahoo.com');
    expect(res.body.state).toBeDefined();
    expect(typeof res.body.state).toBe('string');
    expect(res.body.state.length).toBe(32); // 16 random bytes → 32 hex chars
    expect(mockOAuthClient.getAuthorizationUrl).toHaveBeenCalledTimes(1);
  });

  it('generates a different state on each call', async () => {
    const res1 = await request(app).post('/api/yahoo/connect');
    const res2 = await request(app).post('/api/yahoo/connect');

    expect(res1.body.state).not.toBe(res2.body.state);
  });
});

// ---------- GET /api/yahoo/callback ----------

describe('GET /api/yahoo/callback', () => {
  it('returns 400 when code is missing', async () => {
    const res = await request(app).get('/api/yahoo/callback');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Missing authorization code');
    expect(mockOAuthClient.exchangeCode).not.toHaveBeenCalled();
  });

  it('exchanges code and creates a new user', async () => {
    const res = await request(app)
      .get('/api/yahoo/callback')
      .query({ code: 'test_auth_code', state: 'some_state' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Yahoo Mail connected successfully');
    expect(res.body.userId).toBeDefined();
    expect(res.body.email).toBe('testuser@yahoo.com');

    expect(mockOAuthClient.exchangeCode).toHaveBeenCalledWith('test_auth_code');
    expect(mockOAuthClient.getUserProfile).toHaveBeenCalledWith('mock_access_token');

    // Verify user persisted in MongoDB
    const dbUser = await UserModel.findOne({ yahooId: 'yahoo_user_123' });
    expect(dbUser).not.toBeNull();
    expect(dbUser.email).toBe('testuser@yahoo.com');
    expect(dbUser.accessToken).toBe('mock_access_token');
    expect(dbUser.refreshToken).toBe('mock_refresh_token');
  });

  it('updates existing user on re-authorization', async () => {
    // First callback — create user
    await request(app)
      .get('/api/yahoo/callback')
      .query({ code: 'code_1' });

    const userBefore = await UserModel.findOne({ yahooId: 'yahoo_user_123' });

    // Second callback — same yahooId, should update not duplicate
    mockOAuthClient.exchangeCode.mockResolvedValueOnce({
      accessToken: 'new_access_token',
      refreshToken: 'new_refresh_token',
      expiresIn: 7200,
    });

    const res = await request(app)
      .get('/api/yahoo/callback')
      .query({ code: 'code_2' });

    expect(res.status).toBe(200);

    const users = await UserModel.find({ yahooId: 'yahoo_user_123' });
    expect(users).toHaveLength(1);

    const userAfter = users[0];
    expect(userAfter._id.toString()).toBe(userBefore._id.toString());
    expect(userAfter.accessToken).toBe('new_access_token');
    expect(userAfter.refreshToken).toBe('new_refresh_token');
  });

  it('returns 500 when Yahoo token exchange fails', async () => {
    mockOAuthClient.exchangeCode.mockRejectedValueOnce(new Error('Yahoo is down'));

    const res = await request(app)
      .get('/api/yahoo/callback')
      .query({ code: 'bad_code' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Yahoo is down');
  });
});

// ---------- POST /api/yahoo/sync/:userId ----------

describe('POST /api/yahoo/sync/:userId', () => {
  it('enqueues a sync job with high priority', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    mockEnqueueSyncJob.mockResolvedValueOnce(`sync-${userId}`);

    const res = await request(app).post(`/api/yahoo/sync/${userId}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Sync job enqueued');
    expect(res.body.jobId).toBe(`sync-${userId}`);
    expect(res.body.userId).toBe(userId);

    expect(mockEnqueueSyncJob).toHaveBeenCalledWith({
      userId,
      priority: 1, // SyncJob.PRIORITY.HIGH
      triggeredBy: 'api',
    });
  });

  it('returns 500 when queue is unavailable', async () => {
    mockEnqueueSyncJob.mockRejectedValueOnce(new Error('Redis connection refused'));

    const userId = new mongoose.Types.ObjectId().toString();
    const res = await request(app).post(`/api/yahoo/sync/${userId}`);

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Redis connection refused');
  });
});

// ---------- Full flow: connect → callback → sync ----------

describe('Full OAuth → Sync flow', () => {
  it('connects a user then triggers sync', async () => {
    // Step 1: get auth URL
    const connectRes = await request(app).post('/api/yahoo/connect');
    expect(connectRes.status).toBe(200);
    expect(connectRes.body.authorizationUrl).toBeDefined();

    // Step 2: callback with code
    const callbackRes = await request(app)
      .get('/api/yahoo/callback')
      .query({ code: 'real_code', state: connectRes.body.state });

    expect(callbackRes.status).toBe(200);
    const { userId } = callbackRes.body;

    // Step 3: trigger sync
    mockEnqueueSyncJob.mockResolvedValueOnce(`sync-${userId}`);

    const syncRes = await request(app).post(`/api/yahoo/sync/${userId}`);
    expect(syncRes.status).toBe(200);
    expect(syncRes.body.jobId).toBe(`sync-${userId}`);

    expect(mockEnqueueSyncJob).toHaveBeenCalledWith({
      userId,
      priority: 1,
      triggeredBy: 'api',
    });
  });
});
