import { existsSync, readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { env } from '../utils/env.js';
import { fetchJson } from '../utils/http.js';

const tokenCache = new Map();

export async function getGoogleAccessToken(scopes) {
  const explicitToken = env('GOOGLE_ACCESS_TOKEN');
  if (explicitToken) return explicitToken;

  const scopeString = scopes.join(' ');
  const cached = tokenCache.get(scopeString);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.accessToken;
  }

  const account = loadServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const assertion = signJwt(
    {
      alg: 'RS256',
      typ: 'JWT'
    },
    {
      iss: account.client_email,
      scope: scopeString,
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600
    },
    account.private_key
  );

  const response = await fetchJson(
    'https://oauth2.googleapis.com/token',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion
      })
    },
    'Google OAuth token'
  );

  tokenCache.set(scopeString, {
    accessToken: response.access_token,
    expiresAt: Date.now() + Number(response.expires_in || 3600) * 1000
  });

  return response.access_token;
}

function loadServiceAccount() {
  const rawJson = env('GOOGLE_SERVICE_ACCOUNT_JSON');
  const filePath = env('GOOGLE_SERVICE_ACCOUNT_FILE');

  let raw;
  if (rawJson) {
    raw = rawJson;
  } else if (filePath && existsSync(filePath)) {
    raw = readFileSync(filePath, 'utf8');
  } else {
    throw new Error(
      'Falta GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_SERVICE_ACCOUNT_FILE o GOOGLE_ACCESS_TOKEN'
    );
  }

  const parsed = JSON.parse(raw);
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('El service account JSON no tiene client_email/private_key');
  }
  parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  return parsed;
}

function signJwt(header, payload, privateKey) {
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const unsigned = `${encodedHeader}.${encodedPayload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(privateKey).toString('base64url');
  return `${unsigned}.${signature}`;
}

