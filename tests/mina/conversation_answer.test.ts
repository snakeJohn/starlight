import { describe, expect, it } from 'vitest';
import { extractConversationAnswerText } from '../../src/mina/client';

describe('extractConversationAnswerText', () => {
  it('reads Xiaoai answer text from several response shapes', () => {
    expect(extractConversationAnswerText({
      answers: [{ type: 'TEXT', text: '文本回应' }],
    })).toBe('文本回应');

    expect(extractConversationAnswerText({
      answers: [{ type: 'TTS', tts: { text: 'TTS 回应' } }],
    })).toBe('TTS 回应');

    expect(extractConversationAnswerText({
      answers: [{ type: 'CARD', content: { to_speak: '卡片回应' } }],
    })).toBe('卡片回应');
  });

  it('falls back to record-level answer fields', () => {
    expect(extractConversationAnswerText({
      query: '天气',
      answer: '今天晴',
    })).toBe('今天晴');
  });
});
