// MIoT 智能音箱插件 - AI 口令分析器
// 使用 LLM 泛化分析用户语音指令，提取操作类型和参数

/// <reference types="@songloft/plugin-sdk" />

import type { AIConfig, AIAnalysisResult } from '../types';
import { fetchWithTimeout, redactForLog } from '../utils/fetch_timeout';

/** AI System Prompt */
const AI_SYSTEM_PROMPT = `你是一个智能音箱语音指令分析专家，擅长从用户的口语指令中精确提取出**操作意图**和**关键参数**。

## 任务

分析用户语音输入，输出符合以下 JSON 格式的解析结果：

{
  "action": "操作类型",
  "params": { /* 操作参数对象 */ },
  "confidence": "high|medium|low",
  "rawText": "保留的原始有效文本"
}

## 支持的操作类型（action 枚举）

| action | 含义 | 必须参数 |
|--------|------|----------|
| play_song | 播放指定歌曲 | name 或 artist |
| play_playlist | 播放指定歌单 | playlist |
| create_playlist | 创建自建歌单 | playlist |
| add_song_to_playlist | 添加歌曲到自建歌单 | playlist, name |
| set_play_mode | 设置播放模式 | mode |
| set_volume | 调节音量 | volume |
| next | 切到下一首 | 无 |
| previous | 切到上一首 | 无 |
| stop | 停止播放 | 无 |
| unknown | 无法识别意图 | 无 |

## params 参数说明

- **play_song**: {"name": "歌曲名", "artist": "歌手名", "playlist": "所属歌单（如有）"}
- **play_playlist**: {"playlist": "歌单名称"}
- **create_playlist**: {"playlist": "歌单名称"}
- **add_song_to_playlist**: {"playlist": "歌单名称", "name": "歌曲名", "artist": "歌手名（如有）", "source": "酷我|酷狗|QQ音乐|咪咕|网易云（如有）"}
- **set_play_mode**: {"mode": "order|random|once|single|loop"}，其中 once=单曲播放一次，single=单曲循环
- **set_volume**: {"volume": 数字, "direction": "up|down|absolute（方向，up/down 时 volume 可忽略）"}
- **next/previous/stop**: {}

## 解析规则

1. **意图优先**：先判断操作类型，再提取对应参数
2. **歌名/歌手名区分**：
   - "播放周杰伦的晴天" → action=play_song, name="晴天", artist="周杰伦"
   - "播放歌曲夜空中最亮的星" → action=play_song, name="夜空中最亮的星", artist=""
   - "播放晴天" → action=play_song, name="晴天", artist=""
3. **模糊处理**：
   - "播放那个歌"（无具体歌名）→ action=play_song, name="", confidence=low
   - "播放一些音乐" → action=play_song, name="", confidence=low
4. **关机/开机**：若提到关机/关闭音箱 → action=stop（音箱暂无独立开机接口，用 stop 代替）
5. **置信度**：
   - high：明确说出歌名/歌手/歌单
   - medium：有一定信息但不完整
   - low：只有模糊意图，无具体参数

## 输出要求

1. 禁止输出思考过程，不要包含尖括号包裹的思考标签（如 [思考开始]...[/思考结束]），直接输出 JSON
2. 只输出 JSON，不要添加任何解释、注释或前缀，不要在 JSON 前后加任何文字
3. 若完全无法识别，返回：{"action": "unknown", "params": {}, "confidence": "low", "rawText": ""}
4. 解析时注意歌曲名称中可能包含助词"的"，如"你的答案"、"我的歌声里"——不要把助词当作歌手名和歌曲名的分隔符

## 示例

输入：你的答案
输出：{"action": "play_song", "params": {"name": "你的答案", "artist": ""}, "confidence": "high", "rawText": "你的答案"}

输入：播放周杰伦的晴天
输出：{"action": "play_song", "params": {"name": "晴天", "artist": "周杰伦"}, "confidence": "high", "rawText": "晴天 周杰伦"}

输入：随机播放
输出：{"action": "set_play_mode", "params": {"mode": "random"}, "confidence": "high", "rawText": "随机播放"}

输入：单曲播放
输出：{"action": "set_play_mode", "params": {"mode": "once"}, "confidence": "high", "rawText": "单曲播放"}

输入：把为龙 河图 酷狗 加到古风
输出：{"action": "add_song_to_playlist", "params": {"playlist": "古风", "name": "为龙", "artist": "河图", "source": "酷狗"}, "confidence": "high", "rawText": "为龙 河图 酷狗 古风"}

输入：声音大一点
输出：{"action": "set_volume", "params": {"volume": 10, "direction": "up"}, "confidence": "high", "rawText": "大一点"}`;

/**
 * AI 口令分析器
 * 调用 LLM API 分析用户语音指令，提取操作类型和参数
 */
export class AIAnalyzer {
  /**
   * 调用 AI 分析用户语音指令
   * @param query 用户语音文本
   * @param config AI 配置
   * @returns 分析结果，超时或失败返回 null
   */
  async analyze(query: string, config: AIConfig): Promise<AIAnalysisResult | null> {
    if (!config.enabled || !config.api_url || !config.api_key) {
      return null;
    }

    try {
      return await this.callAI(query, config);
    } catch (e) {
      songloft.log.warn(`[AIAnalyzer] AI analysis failed: ${String(e)}`);
      return null;
    }
  }

  /**
   * 调用 LLM API
   */
  private async callAI(query: string, config: AIConfig): Promise<AIAnalysisResult> {
    songloft.log.info(`[AIAnalyzer] Calling ${config.api_url} model=${config.model} timeout=${config.timeout}s`);

    const messages = [
      { role: 'system', content: AI_SYSTEM_PROMPT },
      { role: 'user', content: `用户指令：${query}` },
    ];

    const body: Record<string, unknown> = {
      model: config.model,
      messages,
      temperature: 1.0,
      max_tokens: 300,
      response_format: { type: 'json_object' },
      extra_body: { reasoning_split: true },
    };

    let resp: Response;
    try {
      resp = await fetchWithTimeout(`${config.api_url}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.api_key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        timeoutMs: Math.max(1000, config.timeout * 1000),
      });
    } catch (e) {
      songloft.log.warn(`[AIAnalyzer] fetch error: ${String(e)}`);
      throw e;
    }

    if (!resp.ok) {
      const errBody = redactForLog(await resp.text());
      throw new Error(`API error: ${resp.status} ${errBody}`);
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content as string | undefined;
    const finishReason = data.choices?.[0]?.finish_reason as string | undefined;
    if (!content) {
      throw new Error('Empty response from AI API');
    }

    if (finishReason && finishReason !== 'stop') {
      songloft.log.warn(`[AIAnalyzer] Finish reason: ${finishReason} (content may be truncated)`);
    }

    songloft.log.info(`[AIAnalyzer] API response: ${redactForLog(content, 200)}`);
    return this.parseResponse(content);
  }

  /**
   * 解析 AI 返回的 JSON
   * reasoning_split=true 时 content 直接是干净 JSON，尝试直接解析
   * 解析失败则兜底：从内容中提取 JSON
   */
  private parseResponse(content: string): AIAnalysisResult {
    const trimmed = content.trim();

    // 优先尝试直接解析（reasoning_split=true 时 content 直接是 JSON）
    try {
      const parsed = JSON.parse(trimmed);
      return {
        action: parsed.action || 'unknown',
        params: parsed.params || {},
        confidence: (parsed.confidence === 'high' || parsed.confidence === 'medium' || parsed.confidence === 'low')
          ? parsed.confidence
          : 'low',
        rawText: parsed.rawText || '',
      };
    } catch {
      songloft.log.warn(`[AIAnalyzer] Direct JSON parse failed, content: ${content.slice(0, 300)}`);
    }

    // 兜底：去掉思考标签后再提取 JSON
    let cleaned = trimmed
      .replace(/[\[\]/?]*(?:think|思考|THINK)[\[\]/?]*/gi, '');

    const firstBrace = cleaned.indexOf('{');
    if (firstBrace === -1) {
      throw new Error('No JSON found in response');
    }

    let end = cleaned.lastIndexOf('}');
    while (end > firstBrace) {
      const after = cleaned.slice(end + 1);
      if (/^[\s]*$/.test(after)) break;
      end = cleaned.lastIndexOf('}', end - 1);
    }

    const jsonStr = cleaned.slice(firstBrace, end + 1);
    try {
      const parsed = JSON.parse(jsonStr);
      return {
        action: parsed.action || 'unknown',
        params: parsed.params || {},
        confidence: (parsed.confidence === 'high' || parsed.confidence === 'medium' || parsed.confidence === 'low')
          ? parsed.confidence
          : 'low',
        rawText: parsed.rawText || '',
      };
    } catch {
      songloft.log.warn(`[AIAnalyzer] Fallback JSON parse also failed, extracted: ${jsonStr.slice(0, 300)}`);
      throw new Error(`Failed to parse AI response: ${jsonStr.slice(0, 100)}`);
    }
  }
}
