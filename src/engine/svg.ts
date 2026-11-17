export function round2(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function svgDocument(
  width: number,
  height: number,
  bgColor: string | null,
  body: string
): string {
  const bgRect = bgColor
    ? `<rect width="${width}" height="${height}" fill="${bgColor}"/>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${bgRect}${body}</svg>`;
}

