/** Resolve um caminho relativo a public/content/ respeitando o `base` do Vite. */
export function contentUrl(relativePath: string): string {
  return `${import.meta.env.BASE_URL}content/${relativePath}`;
}
