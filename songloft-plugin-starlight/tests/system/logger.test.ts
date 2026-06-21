import { describe, expect, test } from 'vitest';
import { maskRecord, maskSecret } from '../../src/system/logger';

describe('logger masking helpers', () => {
  test('maskSecret keeps the first and last four characters', () => {
    expect(maskSecret('abcdef1234567890')).toBe('abcd********7890');
  });

  test('maskRecord masks secret keys and leaves ordinary keys unchanged', () => {
    expect(maskRecord({ api_key: 'sk-1234567890', username: 'admin' })).toEqual({
      api_key: 'sk-1******7890',
      username: 'admin',
    });
  });

  test('maskRecord masks normalized token and secret key variants', () => {
    expect(
      maskRecord({
        external_search_token: 'external1234567890',
        access_token: 'access1234567890',
        client_secret: 'client1234567890',
        apiKey: 'key-1234567890',
        username: 'admin',
      }),
    ).toEqual({
      external_search_token: 'exte**********7890',
      access_token: 'acce********7890',
      client_secret: 'clie********7890',
      apiKey: 'key-******7890',
      username: 'admin',
    });
  });

  test('maskRecord recursively masks nested object secrets', () => {
    expect(
      maskRecord({
        services: {
          mina: {
            service_token: 'abcdef1234567890',
            ssecurity: 'secret12345678',
          },
        },
      }),
    ).toEqual({
      services: {
        mina: {
          service_token: 'abcd********7890',
          ssecurity: 'secr******5678',
        },
      },
    });
  });

  test('maskRecord recursively masks secret keys inside arrays', () => {
    expect(
      maskRecord({
        accounts: [
          { username: 'admin', access_token: 'access1234567890' },
          { cookie: 'cookie1234567890' },
        ],
      }),
    ).toEqual({
      accounts: [
        { username: 'admin', access_token: 'acce********7890' },
        { cookie: 'cook********7890' },
      ],
    });
  });
});
