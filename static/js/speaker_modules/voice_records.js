import { asArray } from '../shared/arrays.js';
import { escapeHtml } from '../state.js';

const VOICE_RECORD_WINDOW_MS = 12 * 60 * 60 * 1000;

function firstText(...values) {
    for (const value of values) {
        const text = String(value ?? '').trim();
        if (text && text !== '[object Object]') return text;
        if (value && typeof value === 'object') {
            const nested = firstText(
                value.text,
                value.to_speak,
                value.toSpeak,
                value.displayText,
                value.display_text,
                value.answer,
                value.content,
            );
            if (nested) return nested;
        }
    }
    return '';
}

function voiceRecordTimestamp(record) {
    const value = Number(record?.message?.timestamp_ms ?? record?.timestamp_ms ?? 0);
    return Number.isFinite(value) ? value : 0;
}

function voiceRecordParts(record = {}) {
    const message = record.message || record;
    const answer = message?.response?.answer?.[0] || {};
    return {
        timestampMs: voiceRecordTimestamp(record),
        deviceName: firstText(record.device_name, record.device_id, '未知音箱'),
        question: firstText(answer.question, answer.intention?.query),
        answer: firstText(
            answer.content,
            answer.text,
            answer.displayText,
            answer.display_text,
            answer.answer,
            answer.tts?.text,
        ),
        domain: firstText(answer.domain, answer.action),
    };
}

function isRecentVoiceRecord(record, now = Date.now()) {
    const timestamp = voiceRecordTimestamp(record);
    return timestamp > 0
        && timestamp >= now - VOICE_RECORD_WINDOW_MS
        && timestamp <= now + 60000;
}

function voiceRecordTimeLabel(timestampMs, now = Date.now()) {
    const diff = Math.max(0, now - timestampMs);
    if (diff < 60000) return '刚刚';
    if (diff < 60 * 60000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 24 * 60 * 60000) return `${Math.floor(diff / (60 * 60000))} 小时前`;
    return new Date(timestampMs).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

export function recentVoiceRecords(records = [], now = Date.now()) {
    return asArray(records)
        .filter(record => isRecentVoiceRecord(record, now))
        .sort((left, right) => voiceRecordTimestamp(right) - voiceRecordTimestamp(left));
}

export function renderVoiceRecordList(records = [], now = Date.now()) {
    const recent = recentVoiceRecords(records, now);
    if (!recent.length) {
        return '<div class="empty-state">暂无近 12 小时对话记录。开启对话监听后会自动记录新的语音交互。</div>';
    }

    return recent.map(record => {
        const parts = voiceRecordParts(record);
        const question = parts.question || '未识别到用户语音';
        const answer = parts.answer || '音箱暂无文本回应';
        return `
            <article class="voice-record-item">
                <div class="voice-record-meta">
                    <strong>${escapeHtml(parts.deviceName)}</strong>
                    <span>${escapeHtml(voiceRecordTimeLabel(parts.timestampMs, now))}</span>
                </div>
                <div class="voice-record-bubble user">
                    <span>用户</span>
                    <p>${escapeHtml(question)}</p>
                </div>
                <div class="voice-record-bubble assistant">
                    <span>音箱</span>
                    <p>${escapeHtml(answer)}</p>
                </div>
                ${parts.domain ? `<div class="voice-record-domain">${escapeHtml(parts.domain)}</div>` : ''}
            </article>
        `;
    }).join('');
}
