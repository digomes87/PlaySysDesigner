/** Resolves a path relative to public/content/, honouring Vite's `base`. */
export function contentUrl(relativePath: string): string {
  return `${import.meta.env.BASE_URL}content/${relativePath}`;
}
