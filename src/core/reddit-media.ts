import type { Post } from '@devvit/web/server';

export const INLINE_MEDIA_REFERENCE = /!\[(img|gif)\]\(([A-Za-z0-9]+)\)/gi;

function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi,
    (entity) => {
      switch (entity.toLowerCase()) {
        case '&amp;':
          return '&';
        case '&lt;':
          return '<';
        case '&gt;':
          return '>';
        case '&quot;':
          return '"';
        case '&apos;':
          return "'";
        default: {
          const hex = entity[2]?.toLowerCase() === 'x';
          const code = Number.parseInt(
            entity.slice(hex ? 3 : 2, -1),
            hex ? 16 : 10
          );
          return code > 0 && code <= 0x10ffff
            ? String.fromCodePoint(code)
            : entity;
        }
      }
    }
  );
}

export function postInlineMedia(
  post: Pick<Post, 'bodyHtml' | 'gallery'>
): Record<string, string> {
  const media: Record<string, string> = {};
  const addUrl = (value: string): void => {
    try {
      const url = new URL(decodeHtmlEntities(value));
      if (
        url.protocol !== 'https:' ||
        !['i.redd.it', 'preview.redd.it'].includes(url.hostname) ||
        url.username ||
        url.password ||
        url.port
      ) {
        return;
      }
      const id = /^\/([A-Za-z0-9]+)\.(?:gif|jpe?g|png|webp)$/i.exec(
        url.pathname
      )?.[1];
      if (id && !Object.hasOwn(media, id)) media[id] = url.toString();
    } catch {
      // Missing or malformed media URLs leave a Reddit-link fallback.
    }
  };

  for (const item of post.gallery ?? []) {
    if (item.status === 1) addUrl(item.url);
  }

  const html = post.bodyHtml || '';
  const markup = html.includes('<') ? html : decodeHtmlEntities(html);
  for (const tag of markup.matchAll(/<(?:img|a)\b[^>]*>/gi)) {
    for (const attribute of tag[0].matchAll(
      /\s(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi
    )) {
      addUrl(attribute[1] ?? attribute[2] ?? '');
    }
  }
  return media;
}
