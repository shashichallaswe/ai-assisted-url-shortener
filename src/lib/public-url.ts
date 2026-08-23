export function publicShortUrl(baseUrl: string, code: string): string {
  return `${baseUrl.replace(/\/+$/u, '')}/${code}`;
}
