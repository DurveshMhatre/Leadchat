// ============================================
// LeadChat API — GST Verification via Setu
// Authenticates with client_id/secret → JWT token
// Then calls GSTIN lookup endpoint
// ============================================

import { config } from '../config/index.js';

// --- Token Cache ---

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

/**
 * Get a valid Setu access token.
 * Caches the token and refreshes when expired (typically 300s).
 */
async function getSetuAccessToken(): Promise<string> {
  const now = Date.now();

  // Return cached token if still valid (with 30s buffer)
  if (cachedToken && tokenExpiresAt > now + 30_000) {
    return cachedToken;
  }

  const { GST_API_CLIENT_ID, GST_API_CLIENT_SECRET } = config;
  if (!GST_API_CLIENT_ID || !GST_API_CLIENT_SECRET) {
    throw new Error('GST API credentials not configured');
  }

  // Setu login endpoint
  const loginUrl = 'https://accountservice.setu.co/v1/users/login';

  const response = await fetch(loginUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientID: GST_API_CLIENT_ID,
      secret: GST_API_CLIENT_SECRET,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Setu auth failed (${response.status}): ${text}`);
  }

  const data = await response.json() as {
    data?: { token?: { accessToken?: string; expiresIn?: number } };
    access_token?: string;
    expiresIn?: number;
  };

  // Setu response format may vary — handle both shapes
  const token = data.data?.token?.accessToken ?? data.access_token;
  const expiresIn = data.data?.token?.expiresIn ?? data.expiresIn ?? 300;

  if (!token) {
    throw new Error('Setu auth returned no token');
  }

  cachedToken = token;
  tokenExpiresAt = now + expiresIn * 1000;

  return token;
}

// --- GST Verification Result ---

export interface GSTVerificationResult {
  valid: boolean;
  gstin: string;
  legalName: string;
  tradeName: string;
  status: string;  // e.g. "Active", "Cancelled"
  stateCode: string;
  registrationDate: string;
  error?: string;
}

/**
 * Verify a GSTIN number via Setu's GST API.
 *
 * Flow:
 * 1. Authenticate with client_id/secret → access_token
 * 2. Call GSTIN lookup with the token
 * 3. Parse and return result
 */
export async function verifyGSTIN(gstin: string): Promise<GSTVerificationResult> {
  const { GST_API_URL } = config;

  if (!GST_API_URL) {
    // Sandbox fallback for development
    console.warn('⚠️  GST_API_URL not configured — using mock response');
    return mockGSTResponse(gstin);
  }

  try {
    const token = await getSetuAccessToken();

    // Setu GSTIN verification endpoint
    const verifyUrl = `${GST_API_URL}/api/verify/gst`;

    const response = await fetch(verifyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ gstin }),
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        valid: false,
        gstin,
        legalName: '',
        tradeName: '',
        status: 'Error',
        stateCode: '',
        registrationDate: '',
        error: `API error (${response.status}): ${text}`,
      };
    }

    const result = await response.json() as Record<string, unknown>;

    // Parse Setu response — adapt to their actual response shape
    const gstData = (result.data ?? result) as Record<string, unknown>;
    const status = String(gstData.status ?? gstData.gstStatus ?? 'Unknown');
    const isActive = status.toLowerCase() === 'active';

    return {
      valid: isActive,
      gstin,
      legalName: String(gstData.legalName ?? gstData.legal_name ?? ''),
      tradeName: String(gstData.tradeName ?? gstData.trade_name ?? ''),
      status,
      stateCode: String(gstData.stateCode ?? gstData.state_code ?? ''),
      registrationDate: String(gstData.registrationDate ?? gstData.registration_date ?? ''),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ GST verification error:', message);
    return {
      valid: false,
      gstin,
      legalName: '',
      tradeName: '',
      status: 'Error',
      stateCode: '',
      registrationDate: '',
      error: message,
    };
  }
}

/**
 * Mock GST response for development when API URL is not configured.
 * Returns valid for well-formed GSTINs.
 */
function mockGSTResponse(gstin: string): GSTVerificationResult {
  // Basic GSTIN format: 2-digit state + 10-char PAN + 1 entity + 1 Z + 1 check
  const isValidFormat = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[0-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstin);

  if (isValidFormat) {
    return {
      valid: true,
      gstin,
      legalName: 'Mock Business Pvt Ltd',
      tradeName: 'Mock Business',
      status: 'Active',
      stateCode: gstin.substring(0, 2),
      registrationDate: '2020-01-15',
    };
  }

  return {
    valid: false,
    gstin,
    legalName: '',
    tradeName: '',
    status: 'Invalid',
    stateCode: '',
    registrationDate: '',
    error: 'Invalid GSTIN format',
  };
}
