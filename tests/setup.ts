import { beforeEach } from 'vitest';
import { installSongloftMock } from './helpers/songloft';

installSongloftMock();

beforeEach(() => {
  installSongloftMock();
});
