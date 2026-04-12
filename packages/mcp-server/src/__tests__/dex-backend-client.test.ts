import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchWcfxPriceViaBackend,
  refreshSelectedSourcesViaBackend,
  mineViaBackend,
  fundViaBackend,
} from '../features/dex/dex-backend-client.js';

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

describe('dex-backend-client', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetchWcfxPriceViaBackend returns null on non-ok response', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => response({}, false));
    vi.stubGlobal('fetch', fetchMock);

    const price = await fetchWcfxPriceViaBackend('http://backend');

    expect(price).toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://backend/api/dex/pricing/wcfx-usd');
  });

  it('fetchWcfxPriceViaBackend returns numeric price from backend', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => response({ usd: 1.23 }));
    vi.stubGlobal('fetch', fetchMock);

    const price = await fetchWcfxPriceViaBackend('http://backend');

    expect(price).toBe(1.23);
  });

  it('refreshSelectedSourcesViaBackend posts expected payload', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => response({ tokens: [{ symbol: 'WCFX' }] }));
    vi.stubGlobal('fetch', fetchMock);

    const feed = await refreshSelectedSourcesViaBackend({
      chainId: 1030,
      tokenSelections: [{ tokenAddress: '0xtoken', poolAddress: '0xpool' }],
      forceRefresh: true,
      devkitUrl: 'http://backend',
    });

    expect(feed).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://backend/api/dex/source-pools/refresh');
    expect(init?.method).toBe('POST');
    expect(String(init?.body)).toContain('"chainId":1030');
    expect(String(init?.body)).toContain('"forceRefresh":true');
  });

  it('mineViaBackend and fundViaBackend return false when backend throws', async () => {
    const fetchMock = vi.fn<FetchLike>().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);

    const mined = await mineViaBackend(10, 'http://backend');
    const funded = await fundViaBackend('0xabc', 5, 'http://backend');

    expect(mined).toBe(false);
    expect(funded).toBe(false);
  });
});
