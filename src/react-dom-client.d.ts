declare module 'react-dom/client' {
  import type React from 'react';
  export function createRoot(container: Element | DocumentFragment): { render(children: React.ReactNode): void };
}

declare module 'react-dom/server' {
  import type React from 'react';
  export function renderToStaticMarkup(element: React.ReactElement): string;
}
