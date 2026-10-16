import assert from 'node:assert/strict';
import test from 'node:test';
import { postInlineMedia } from './reddit-media.ts';

void test('resolves media IDs from gallery URLs and HTML without relying on order', () => {
  const first = 'https://i.redd.it/2jtgiifymrvh1.png';
  const second =
    'https://preview.redd.it/xu8pdwhzmrvh1.jpg?width=1080&format=pjpg&auto=webp&s=example';
  assert.deepEqual(
    postInlineMedia({
      gallery: [{ status: 1, url: first, width: 100, height: 100 }],
      bodyHtml: `<div><a href="${second.replaceAll('&', '&amp;')}">img</a><img src="https://preview.redd.it/2jtgiifymrvh1.png?width=100"></div>`,
    }),
    { '2jtgiifymrvh1': first, xu8pdwhzmrvh1: second }
  );
});

void test('reads image URLs from entity-escaped Reddit HTML', () => {
  assert.deepEqual(
    postInlineMedia({
      gallery: [],
      bodyHtml:
        '&lt;p&gt;&lt;img src=&quot;https://preview.redd.it/example.gif?width=720&amp;amp;s=signature&quot;&gt;&lt;/p&gt;',
    }),
    { example: 'https://preview.redd.it/example.gif?width=720&s=signature' }
  );
  assert.deepEqual(
    postInlineMedia({
      gallery: [],
      bodyHtml:
        "<img src='https:&#47;&#47;i.redd.it&#47;example.png&#63;foo=1&#x26;bar=2'>",
    }),
    { example: 'https://i.redd.it/example.png?foo=1&bar=2' }
  );
});

void test('ignores unavailable uploads and URLs unsuitable for Reddit image galleries', () => {
  const urls = [
    'https://i.redd.it/failed.png',
    'https://example.com/external.png',
    'https://i.redd.it.example.com/spoof.png',
    'https://user:password@i.redd.it/credentials.png',
    'http://i.redd.it/insecure.png',
    'https://i.redd.it:8080/port.png',
    'https://i.redd.it/video.mp4',
    'not a URL',
  ];
  assert.deepEqual(
    postInlineMedia({
      gallery: urls.map((url, index) => ({
        status: index === 0 ? 2 : 1,
        url,
        width: 100,
        height: 100,
      })),
      bodyHtml: undefined,
    }),
    {}
  );
});
