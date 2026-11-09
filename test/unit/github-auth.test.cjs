const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  parseGitCredential,
  checkGhCliToken,
  checkGitCredentialToken,
  verifyTokenWithGithub,
  detectSystemGitHub,
  startDeviceFlow,
  pollDeviceFlow,
  saveEncryptedToken,
  loadEncryptedToken,
  clearEncryptedToken
} = require('../../electron/github-auth.cjs');

describe('GitHub Auth Unit Tests (Phase 7 / T7.1)', () => {
  describe('Credential Parsers', () => {
    test('parseGitCredential parses password from git credential stdout', () => {
      const output = [
        'protocol=https',
        'host=github.com',
        'username=testuser',
        'password=gho_secret_token_12345',
        ''
      ].join('\n');

      const parsed = parseGitCredential(output);
      assert.equal(parsed, 'gho_secret_token_12345');
    });

    test('parseGitCredential returns null when password is missing or empty', () => {
      assert.equal(parseGitCredential('protocol=https\nhost=github.com\n'), null);
      assert.equal(parseGitCredential('password=\n'), null);
      assert.equal(parseGitCredential(null), null);
      assert.equal(parseGitCredential(''), null);
    });

    test('checkGhCliToken returns token when gh CLI is logged in', async () => {
      const mockExec = (cmd, args, opts, cb) => {
        assert.equal(cmd, 'gh');
        assert.deepEqual(args, ['auth', 'token']);
        cb(null, 'gho_cli_token_99999\n');
      };

      const token = await checkGhCliToken(mockExec);
      assert.equal(token, 'gho_cli_token_99999');
    });

    test('checkGhCliToken returns null when gh is not logged in or missing', async () => {
      const mockExecError = (cmd, args, opts, cb) => {
        cb(new Error('command not found: gh'), '');
      };

      const token = await checkGhCliToken(mockExecError);
      assert.equal(token, null);
    });

    test('checkGitCredentialToken communicates via stdin and parses output', async () => {
      let writtenData = '';
      let streamEnded = false;

      const mockExec = (cmd, args, opts, cb) => {
        assert.equal(cmd, 'git');
        assert.deepEqual(args, ['credential', 'fill']);
        
        // Return dummy child process with stdin
        const child = {
          stdin: {
            write: (data) => { writtenData += data; },
            end: () => {
              streamEnded = true;
              cb(null, 'protocol=https\nhost=github.com\npassword=gho_git_token_88888\n');
            }
          }
        };
        return child;
      };

      const token = await checkGitCredentialToken(mockExec);
      assert.equal(writtenData, 'protocol=https\nhost=github.com\n\n');
      assert.equal(streamEnded, true);
      assert.equal(token, 'gho_git_token_88888');
    });
  });

  describe('Token Verification & System Detection', () => {
    test('verifyTokenWithGithub returns valid:true and user on 200 OK', async () => {
      const mockFetch = async (url, options) => {
        assert.equal(url, 'https://api.github.com/user');
        assert.equal(options.headers.Authorization, 'Bearer gho_valid');
        return {
          ok: true,
          json: async () => ({
            login: 'octocat',
            name: 'The Octocat',
            avatar_url: 'https://avatars.githubusercontent.com/u/583231',
            id: 583231
          })
        };
      };

      const res = await verifyTokenWithGithub('gho_valid', mockFetch);
      assert.equal(res.valid, true);
      assert.equal(res.user.login, 'octocat');
      assert.equal(res.user.id, 583231);
    });

    test('verifyTokenWithGithub returns valid:false on 401 Unauthorized', async () => {
      const mockFetch = async () => ({
        ok: false,
        status: 401
      });

      const res = await verifyTokenWithGithub('gho_invalid', mockFetch);
      assert.equal(res.valid, false);
      assert.equal(res.user, null);
    });

    test('detectSystemGitHub prioritizes gh CLI over git credentials', async () => {
      const options = {
        checkGh: async () => 'gho_cli_token',
        checkGit: async () => 'gho_git_token',
        verifyToken: async (tok) => ({
          valid: true,
          user: { login: 'cliuser', name: 'CLI User', avatarUrl: '', id: 1 }
        })
      };

      const result = await detectSystemGitHub(options);
      assert.equal(result.detected, true);
      assert.equal(result.source, 'GitHub CLI');
      assert.equal(result.token, 'gho_cli_token');
      assert.equal(result.user.login, 'cliuser');
    });

    test('detectSystemGitHub falls back to git credential manager', async () => {
      const options = {
        checkGh: async () => null,
        checkGit: async () => 'gho_git_token',
        verifyToken: async (tok) => ({
          valid: true,
          user: { login: 'gituser', name: 'Git User', avatarUrl: '', id: 2 }
        })
      };

      const result = await detectSystemGitHub(options);
      assert.equal(result.detected, true);
      assert.equal(result.source, 'Git Credential Manager');
      assert.equal(result.token, 'gho_git_token');
      assert.equal(result.user.login, 'gituser');
    });

    test('detectSystemGitHub returns detected:false when no valid credentials exist', async () => {
      const options = {
        checkGh: async () => null,
        checkGit: async () => null,
        verifyToken: async () => ({ valid: false, user: null })
      };

      const result = await detectSystemGitHub(options);
      assert.equal(result.detected, false);
    });
  });

  describe('Device Flow (RFC 8628)', () => {
    test('startDeviceFlow calls GitHub device endpoint and returns codes', async () => {
      const mockFetch = async (url, options) => {
        assert.equal(url, 'https://github.com/login/device/code');
        assert.equal(options.method, 'POST');
        const body = JSON.parse(options.body);
        assert.equal(body.client_id, 'test_client_id');
        assert.equal(body.scope, 'repo,read:user');
        return {
          ok: true,
          json: async () => ({
            device_code: 'dev_code_123',
            user_code: 'ABCD-1234',
            verification_uri: 'https://github.com/login/device',
            expires_in: 900,
            interval: 5
          })
        };
      };

      const result = await startDeviceFlow('test_client_id', mockFetch);
      assert.equal(result.device_code, 'dev_code_123');
      assert.equal(result.user_code, 'ABCD-1234');
      assert.equal(result.interval, 5);
    });

    test('pollDeviceFlow handles authorization_pending state', async () => {
      const mockFetch = async () => ({
        ok: true,
        json: async () => ({ error: 'authorization_pending' })
      });

      const res = await pollDeviceFlow('dev_code_123', 'test_client', mockFetch);
      assert.equal(res.error, 'authorization_pending');
    });

    test('pollDeviceFlow handles slow_down state', async () => {
      const mockFetch = async () => ({
        ok: true,
        json: async () => ({ error: 'slow_down', interval: 10 })
      });

      const res = await pollDeviceFlow('dev_code_123', 'test_client', mockFetch);
      assert.equal(res.error, 'slow_down');
    });

    test('pollDeviceFlow handles expired_token state', async () => {
      const mockFetch = async () => ({
        ok: true,
        json: async () => ({ error: 'expired_token' })
      });

      const res = await pollDeviceFlow('dev_code_123', 'test_client', mockFetch);
      assert.equal(res.error, 'expired_token');
    });

    test('pollDeviceFlow handles access_denied state', async () => {
      const mockFetch = async () => ({
        ok: true,
        json: async () => ({ error: 'access_denied' })
      });

      const res = await pollDeviceFlow('dev_code_123', 'test_client', mockFetch);
      assert.equal(res.error, 'access_denied');
    });

    test('pollDeviceFlow handles successful authorization', async () => {
      const mockFetch = async () => ({
        ok: true,
        json: async () => ({
          access_token: 'gho_granted_access_token_777',
          token_type: 'bearer',
          scope: 'repo,read:user'
        })
      });

      const res = await pollDeviceFlow('dev_code_123', 'test_client', mockFetch);
      assert.equal(res.access_token, 'gho_granted_access_token_777');
      assert.equal(res.scope, 'repo,read:user');
    });
  });

  describe('Token Keychain Storage', () => {
    const testDir = path.join(os.tmpdir(), `banana_test_${Date.now()}`);
    const testTokenPath = path.join(testDir, 'test_token.enc');

    test('saves and loads encrypted token with safeStorage mock', () => {
      fs.mkdirSync(testDir, { recursive: true });

      const mockSafeStorage = {
        isEncryptionAvailable: () => true,
        encryptString: (str) => Buffer.from(`enc:${str}`, 'utf8'),
        decryptString: (buf) => buf.toString('utf8').replace(/^enc:/, '')
      };

      const saved = saveEncryptedToken('gho_super_secret', mockSafeStorage, testTokenPath);
      assert.equal(saved, true);
      assert.equal(fs.existsSync(testTokenPath), true);

      const loaded = loadEncryptedToken(mockSafeStorage, testTokenPath);
      assert.equal(loaded, 'gho_super_secret');

      const cleared = clearEncryptedToken(testTokenPath);
      assert.equal(cleared, true);
      assert.equal(fs.existsSync(testTokenPath), false);
    });

    test('falls back gracefully to base64 obfuscation when safeStorage is unavailable', () => {
      const mockSafeStorage = {
        isEncryptionAvailable: () => false
      };

      const saved = saveEncryptedToken('gho_fallback_secret', mockSafeStorage, testTokenPath);
      assert.equal(saved, true);

      const rawContent = fs.readFileSync(testTokenPath, 'utf8');
      assert.notEqual(rawContent, 'gho_fallback_secret'); // Plaintext is not stored directly

      const loaded = loadEncryptedToken(mockSafeStorage, testTokenPath);
      assert.equal(loaded, 'gho_fallback_secret');

      clearEncryptedToken(testTokenPath);
      try {
        fs.rmSync(testDir, { recursive: true, force: true });
      } catch (_) {}
    });
  });
});
