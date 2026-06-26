import { api } from './api.js';
import {
    configFromForm,
    loadConfig,
    manageAllConversationDevices,
    prepareConversationMonitorFromCheckbox,
    saveConfig,
    setConfigState,
    updateServerHostWarning,
    updateVoiceCommandAccess,
} from './automation_modules/config.js';
import {
    bindVoiceCommandEditor,
    loadVoiceCommands,
    renderVoiceCommandRow,
    voiceCommandFromEditorData,
} from './automation_modules/voice_commands.js';
import { bindIndexingControls, loadIndexing } from './automation_modules/indexing.js';
import { bindScheduleControls, loadSchedules } from './automation_modules/schedules.js';
import { $, $$, toast } from './state.js';

export {
    configFromForm,
    manageAllConversationDevices,
    setConfigState,
    updateVoiceCommandAccess,
} from './automation_modules/config.js';
export { renderVoiceCommandRow, voiceCommandFromEditorData } from './automation_modules/voice_commands.js';

let automationBindingsBound = false;

function bindAutomation() {
    bindVoiceCommandEditor();
    bindIndexingControls();
    bindScheduleControls();
    $('[data-action="refresh-automation"]')?.addEventListener('click', () => loadAutomation().catch(error => toast(error.message, 'error')));
    $$('[data-action="load-config"]').forEach(button => {
        button.addEventListener('click', () => loadConfig().catch(error => toast(error.message, 'error')));
    });
    $$('[data-config-form]').forEach(form => {
        form.addEventListener('submit', event => saveConfig(event).catch(error => toast(error.message, 'error')));
    });
    $$('[name="conversation_monitor_enabled"]').forEach(input => {
        input.addEventListener('change', event => {
            prepareConversationMonitorFromCheckbox(event.currentTarget).catch(error => {
                setConfigState(error.message, event.currentTarget.closest?.('form'));
                toast(error.message, 'error');
            });
        });
    });
    $$('[name="server_host"]').forEach(input => {
        input.addEventListener('input', event => updateServerHostWarning(event.currentTarget.closest?.('form'), event.currentTarget.value));
    });
}

async function loadAutomation() {
    await Promise.allSettled([
        loadVoiceCommands(),
        loadIndexing(),
        loadSchedules(),
        loadConfig(),
    ]);
}

export async function initAutomationUI() {
    if (!automationBindingsBound) {
        bindAutomation();
        automationBindingsBound = true;
    }
    await loadAutomation();
}
