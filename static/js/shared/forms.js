export function hasField(form, name) {
    return Boolean(form?.elements?.[name]);
}

export function boolValue(form, name) {
    return Boolean(form?.elements?.[name]?.checked);
}

export function textValue(form, name) {
    return String(form?.elements?.[name]?.value || '').trim();
}

export function numberValue(form, name) {
    const raw = textValue(form, name);
    return raw === '' ? undefined : Number(raw);
}

export function setField(form, name, value) {
    if (!hasField(form, name)) return;
    const field = form.elements[name];
    if (field.type === 'checkbox') {
        field.checked = Boolean(value);
    } else if (Array.isArray(value)) {
        field.value = value.join(',');
    } else {
        field.value = value ?? '';
    }
}
