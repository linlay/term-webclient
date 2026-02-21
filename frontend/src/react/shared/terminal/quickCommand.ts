const QUICK_KEY_SEQUENCES = new Map([
  ["tab", "\t"],
  ["esc", "\u001b"],
  ["escape", "\u001b"],
  ["enter", "\r"],
  ["return", "\r"],
  ["up", "\u001b[A"],
  ["down", "\u001b[B"],
  ["left", "\u001b[D"],
  ["right", "\u001b[C"],
  ["ctrl+c", "\u0003"],
  ["ctrl+d", "\u0004"],
  ["ctrl+z", "\u001a"]
]);

export function parseQuickCommand(value: string): string {
  const text = value.trim();
  if (!text) {
    return "";
  }
  if (text.startsWith("cmd:")) {
    return `${text.slice(4).trim()}\r`;
  }
  if (text.startsWith("input:")) {
    return text.slice(6);
  }
  if (!text.includes("|")) {
    return text;
  }

  const parts = text.split("|").map((part) => part.trim()).filter(Boolean);
  const sequence = parts.map((part) => {
    if (part.startsWith("key:")) {
      const key = part.slice(4).trim().toLowerCase();
      return QUICK_KEY_SEQUENCES.get(key) ?? "";
    }
    return part;
  }).join("");

  return sequence || text;
}
