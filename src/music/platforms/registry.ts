import type { MusicPlatformProvider } from './types';
import { KugouProvider } from './providers/kg';
import { KuwoProvider } from './providers/kw';
import { MiguProvider } from './providers/mg';
import { QQMusicProvider } from './providers/tx';
import { NeteaseProvider } from './providers/wy';

export class PlatformRegistry {
  private readonly providers = new Map<string, MusicPlatformProvider>();

  constructor() {
    this.register(new KuwoProvider());
    this.register(new KugouProvider());
    this.register(new QQMusicProvider());
    this.register(new NeteaseProvider());
    this.register(new MiguProvider());
  }

  all(): Array<{ id: string; name: string }> {
    return Array.from(this.providers.values()).map((provider) => ({
      id: provider.id,
      name: provider.name,
    }));
  }

  get(id: string): MusicPlatformProvider | null {
    return this.providers.get(id) ?? null;
  }

  private register(provider: MusicPlatformProvider): void {
    this.providers.set(provider.id, provider);
  }
}
