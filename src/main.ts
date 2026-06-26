import { createRouter } from '@songloft/plugin-sdk';
import type { HTTPRequest, HTTPResponse } from '@songloft/plugin-sdk';
import { ConfigManager } from './config/manager';
import { AccountManager } from './account/manager';
import { AuthService } from './auth/service';
import { MinaService } from './service/service';
import { PlaylistManagerMap } from './player/manager';
import { Scheduler } from './schedule/scheduler';
import { TaskExecutor } from './schedule/executor';
import { ConversationMonitor } from './conversation/monitor';
import { VoiceEngine } from './voicecmd/engine';
import { AIAnalyzer } from './voicecmd/ai_analyzer';
import { getDefaultVoiceCommands } from './voicecmd/engine';
import { IndexingManager } from './indexing/manager';
import { SourceStore } from './music/source_store';
import { SourceManager } from './music/source_manager';
import { RuntimeManager } from './music/runtime_manager';
import { PlatformRegistry } from './music/platforms/registry';
import { BridgeService } from './bridge/service';
import { DownloadService } from './download/service';
import { CustomPlaylistStore } from './custom_playlists/store';
import { CustomPlaylistService } from './custom_playlists/service';
import { prefixRouter } from './router/prefix';

// 导入所有handler注册函数
import { registerAccountHandlers } from './handlers/account';
import { registerAuthHandlers } from './handlers/auth';
import { registerDeviceHandlers } from './handlers/device';
import { registerPlaylistHandlers } from './handlers/playlist';
import { registerConfigHandlers } from './handlers/config';
import { registerConversationHandlers } from './handlers/conversation';
import { registerScheduleHandlers } from './handlers/schedule';
import { registerVoiceCommandHandlers } from './handlers/voice_command';
import { registerIndexingHandlers } from './handlers/indexing';
import { registerMusicHandlers } from './handlers/music';
import { registerBridgeHandlers } from './handlers/bridge';
import { registerDownloadHandlers } from './handlers/download';
import { registerCustomPlaylistHandlers } from './handlers/custom_playlists';
import { registerHealthHandlers } from './handlers/health';
import { registerSongloftLibraryHandlers } from './handlers/songloft_library';
import { registerDiagnosticsHandlers } from './handlers/diagnostics';
import { setHostBaseUrl } from './utils/http';
import { SongloftPlaylistService } from './songloft/playlist_service';

const router = createRouter();

// 全局服务实例
let configManager: ConfigManager;
let accountManager: AccountManager;
let authService: AuthService;
let minaService: MinaService;
let playlistManagerMap: PlaylistManagerMap;
let scheduler: Scheduler;
let conversationMonitor: ConversationMonitor;
let voiceEngine: VoiceEngine;
let indexingManager: IndexingManager;
let sourceManager: SourceManager;
let runtimeManager: RuntimeManager;
let downloadSourceManager: SourceManager;
let downloadRuntimeManager: RuntimeManager;
let platformRegistry: PlatformRegistry;
let bridgeService: BridgeService;
let downloadService: DownloadService;
let customPlaylistService: CustomPlaylistService;
let songloftPlaylistService: SongloftPlaylistService;

async function onInit(): Promise<void> {
  songloft.log.info('Starlight 插件初始化...');

  // 初始化管理器
  configManager = new ConfigManager();
  accountManager = new AccountManager(configManager);
  await accountManager.init();

  indexingManager = new IndexingManager();
  authService = new AuthService(configManager, accountManager);
  minaService = new MinaService(accountManager, configManager);
  playlistManagerMap = new PlaylistManagerMap(minaService, configManager);

  // 与 MIoT 插件保持一致：播放地址必须使用用户配置的可访问 Songloft 地址。
  const pluginConfig = await configManager.getConfig();
  if (pluginConfig.server_host) {
    setHostBaseUrl(pluginConfig.server_host);
    songloft.log.info('宿主 API 基础 URL 已设置: ' + pluginConfig.server_host);
  } else {
    songloft.log.warn('Songloft 访问地址未配置，MIoT 智能音箱无法播放相对歌曲地址');
  }

  sourceManager = new SourceManager(new SourceStore());
  await sourceManager.init();
  runtimeManager = new RuntimeManager(sourceManager, { runtimeNamespace: 'playback' });
  downloadSourceManager = new SourceManager(new SourceStore({
    indexKey: 'starlight:music:download_sources',
    scriptPrefix: 'starlight:music:download_source_script:',
  }));
  await downloadSourceManager.init();
  downloadRuntimeManager = new RuntimeManager(downloadSourceManager, { runtimeNamespace: 'download' });
  platformRegistry = new PlatformRegistry();
  bridgeService = new BridgeService(platformRegistry, runtimeManager, minaService, playlistManagerMap);
  songloftPlaylistService = new SongloftPlaylistService(bridgeService, platformRegistry);
  downloadService = new DownloadService(downloadRuntimeManager);
  customPlaylistService = new CustomPlaylistService(new CustomPlaylistStore(), bridgeService);
  playlistManagerMap.setDynamicPlaylistOptions({
    dynamicPlaylistLoader: (playlistId) => customPlaylistService.loadDynamicPlayerSongs(playlistId),
    dynamicSongResolver: (song) => bridgeService.resolvePlayableSong(song.title, song.artist),
  });
  indexingManager.setCustomPlaylistService(customPlaylistService);

  conversationMonitor = new ConversationMonitor(accountManager, configManager);
  voiceEngine = new VoiceEngine(
    configManager,
    accountManager,
    minaService,
    playlistManagerMap,
    indexingManager,
    new AIAnalyzer(),
    bridgeService,
    customPlaylistService,
    platformRegistry,
  );

  const executor = new TaskExecutor(configManager, minaService, playlistManagerMap, indexingManager, conversationMonitor);
  scheduler = new Scheduler(configManager, executor);

  // 如果配置中没有语音口令配置，写入默认配置
  const existingCommands = await configManager.getVoiceCommands();
  if (!existingCommands || existingCommands.length === 0) {
    const defaultCommands = getDefaultVoiceCommands();
    await configManager.saveVoiceCommands(defaultCommands);
    songloft.log.info(`[VoiceCmd] Initialized ${defaultCommands.length} default voice commands`);
  }

  // 注册所有路由
  const miotRouter = prefixRouter(router, '/api/miot');
  registerAccountHandlers(miotRouter, accountManager);
  registerAuthHandlers(miotRouter, authService);
  registerDeviceHandlers(miotRouter, minaService, accountManager, playlistManagerMap, conversationMonitor);
  registerPlaylistHandlers(miotRouter, playlistManagerMap, minaService);
  registerConfigHandlers(miotRouter, configManager, conversationMonitor, scheduler, voiceEngine);
  registerConversationHandlers(miotRouter, conversationMonitor, configManager);
  registerScheduleHandlers(miotRouter, scheduler, configManager);
  registerVoiceCommandHandlers(miotRouter, configManager);
  registerIndexingHandlers(miotRouter, indexingManager);
  registerMusicHandlers(router, sourceManager, runtimeManager, platformRegistry, { downloadRuntimes: downloadRuntimeManager });
  registerBridgeHandlers(router, bridgeService);
  registerDownloadHandlers(router, downloadSourceManager, downloadRuntimeManager, downloadService);
  registerCustomPlaylistHandlers(router, customPlaylistService, platformRegistry);
  registerSongloftLibraryHandlers(router, { playlistManagerMap, playlistService: songloftPlaylistService });
  registerHealthHandlers(router, sourceManager, runtimeManager);
  registerDiagnosticsHandlers(router);

  runtimeManager.loadEnabledSources().catch(e => {
    songloft.log.warn('Failed to load enabled music sources: ' + String(e));
  });
  downloadRuntimeManager.loadEnabledSources().catch(e => {
    songloft.log.warn('Failed to load enabled download sources: ' + String(e));
  });

  // 自动登录 + 启动后台服务（异步，不阻塞插件初始化）
  authService.autoLoginAll().catch(e => {
    songloft.log.error('autoLoginAll failed: ' + String(e));
  });
  // 异步刷新索引，不阻塞插件初始化
  setTimeout(() => {
    indexingManager.refresh().catch(e => {
      songloft.log.error('indexingManager.refresh failed: ' + String(e));
    });
  }, 100);

  // 注册 VoiceEngine 回调（独立于启停生命周期）
  conversationMonitor.registerCallback('voice_engine', (msg) => {
    return voiceEngine.handleMessage(msg);
  });

  // 根据配置启动后台服务
  if (pluginConfig.scheduled_tasks_enabled) {
    scheduler.start();
  }
  if (pluginConfig.conversation_monitor_enabled) {
    conversationMonitor.start();
  }
  if (pluginConfig.voice_command_enabled) {
    voiceEngine.setEnabled(true);
  }

  songloft.log.info('Starlight 插件初始化完成');
}

async function onDeinit(): Promise<void> {
  songloft.log.info('Starlight 插件停止...');
  scheduler?.stop();
  conversationMonitor?.stop();
  playlistManagerMap?.cleanup();
  authService?.cleanup();
  await runtimeManager?.close();
  await downloadRuntimeManager?.close();
  songloft.log.info('Starlight 插件已停止');
}

async function onHTTPRequest(req: HTTPRequest): Promise<HTTPResponse> {
  return await router.handle(req);
}

// 暴露为全局（QuickJS 需要显式声明）。SDK 0.8+ 已正式支持 async 签名。
globalThis.onInit = onInit;
globalThis.onDeinit = onDeinit;
globalThis.onHTTPRequest = onHTTPRequest;
