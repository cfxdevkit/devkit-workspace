import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWcfxPrice } from '../features/dex/dex-pricing.js';

type MockResponse = {
  ok: boolean;
  json: () => Promise<unknown>;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<MockResponse>;

function response(body: unknown, ok = true): MockResponse {
  return {
    ok,
    json: async () => body,
  };
}

describe('fetchWcfxPrice', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prefers backend /api/dex pricing endpoint when available', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => response({ usd: 0.77 }));
    vi.stubGlobal('fetch', fetchMock);

    const price = await fetchWcfxPrice('http://localhost:7748');

    expect(price).toBe(0.77);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:7748/api/dex/pricing/wcfx-usd');
  });

  it('falls back to CoinGecko when backend is unavailable', async () => {
    const fetchMock = vi
      .fn<FetchLike>()
      .mockRejectedValueOnce(new Error('backend unavailable'))
      .mockResolvedValueOnce(response({ 'conflux-token': { usd: 0.33 } }));
    vi.stubGlobal('fetch', fetchMock);

    const price = await fetchWcfxPrice('http://localhost:7748');

    expect(price).toBe(0.33);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('api.coingecko.com');
  });

  it('returns deterministic fallback when all providers fail', async () => {
    const fetchMock = vi.fn<FetchLike>().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    const price = await fetchWcfxPrice('http://localhost:7748');

    expect(price).toBe(0.05);
  });
});
