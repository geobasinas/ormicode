export function serializeInspectorValue(value: unknown, max: number): string {
  let text = '';
  try {
    if (value instanceof Error) text = `${value.name}: ${value.message}`;
    else if (typeof value === 'string') text = value;
    else {
      const seen = new WeakSet<object>();
      text = JSON.stringify(value, (_key, item: unknown) => {
        if (typeof item === 'bigint') return `${item}n`;
        if (item instanceof Error) return { name: item.name, message: item.message, stack: item.stack };
        if (typeof item === 'function') return `[Function ${item.name || 'anonymous'}]`;
        if (item && typeof item === 'object') {
          if (seen.has(item)) return '[Circular]';
          seen.add(item);
        }
        return item;
      }) ?? String(value);
    }
  } catch { text = String(value); }
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 14))}[truncated]`;
}

export function trimInspectorStack(stack: string): string {
  return stack.split(/\r?\n/).filter((line, index) =>
    index === 0 || !/\/__ormi\/inspect\.js|previewInspectorScript|preview-inspector\.ts/.test(line)).join('\n');
}

export function isInspectorHttpFailure(status: number): boolean {
  return Number.isFinite(status) && status >= 400;
}
