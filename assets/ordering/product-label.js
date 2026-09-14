export const DEFAULT_LABEL_COLOR = '#764b25';
export const MAX_LABEL_LENGTH = 32;

// Older products have no label. Only an explicit opt-in displays a badge.
export function productLabelSettings(value) {
  return {
    enabled: value?.enabled === true,
    text: typeof value?.text === 'string' ? value.text.trim().slice(0, MAX_LABEL_LENGTH) : '',
    color: typeof value?.color === 'string' && /^#[0-9a-f]{6}$/i.test(value.color)
      ? value.color.toLowerCase() : DEFAULT_LABEL_COLOR,
  };
}

export function labelTextColor(color) {
  const safeColor = productLabelSettings({ color }).color;
  const [red, green, blue] = safeColor.slice(1).match(/../g).map(hex => {
    const channel = parseInt(hex, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#ffffff';
}

export function visibleProductLabel(value) {
  const label = productLabelSettings(value);
  return label.enabled && label.text ? { ...label, textColor: labelTextColor(label.color) } : null;
}
