import { describe, expect, it } from 'vitest'
import { parseFeedDocument } from '../rss'
import { parseTranslationLine, parseOpenAiModelIds } from '../ai'
import { parseOpml } from '../opml'
import { extractArticle, discoverFeeds } from '../extract'
import { parseDate, stripHtml, truncate, normalizeUrl } from '../utils'

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>Solidot</title>
    <link>https://www.solidot.org/</link>
    <description>奇客的资讯</description>
    <image><url>https://www.solidot.org/favicon.ico</url><title>Solidot</title><link>https://www.solidot.org/</link></image>
    <item>
      <title><![CDATA[开源社区发布新工具]]></title>
      <link>https://www.solidot.org/story?sid=1</link>
      <guid isPermaLink="false">solidot-1</guid>
      <description><![CDATA[<p>这是一段<b>摘要</b>&amp;内容。</p>]]></description>
      <content:encoded><![CDATA[<p>正文第一段。</p><p><img src="/images/cover.jpg" alt="cover"></p>]]></content:encoded>
      <pubDate>Tue, 01 Oct 2024 08:00:00 +0800</pubDate>
      <author>someone@example.com (Alice)</author>
      <category>linux</category>
      <category>开源</category>
      <enclosure url="https://cdn.example.com/audio.mp3" type="audio/mpeg" length="1234" />
    </item>
    <item>
      <title>没有链接的文章</title>
      <guid>solidot-2</guid>
      <pubDate>2024-10-02 09:30:00</pubDate>
    </item>
  </channel>
</rss>`

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Anthony Fu</title>
  <subtitle>Blog of Anthony Fu</subtitle>
  <link href="https://antfu.me/" rel="alternate"/>
  <link href="https://antfu.me/feed.xml" rel="self"/>
  <icon>https://antfu.me/favicon.ico</icon>
  <entry>
    <title>Why I build tools</title>
    <link href="https://antfu.me/posts/why" rel="alternate"/>
    <id>tag:antfu.me,2024:why</id>
    <published>2024-09-20T10:00:00Z</published>
    <updated>2024-09-21T10:00:00Z</updated>
    <summary>A post about tooling</summary>
    <content type="html">&lt;p&gt;Hello &amp;amp; welcome&lt;/p&gt;</content>
    <author><name>Anthony Fu</name></author>
    <category term="vue"/>
  </entry>
</feed>`

const JSON_FEED = JSON.stringify({
  version: 'https://jsonfeed.org/version/1.1',
  title: 'Example JSON',
  home_page_url: 'https://example.com/',
  feed_url: 'https://example.com/feed.json',
  items: [
    {
      id: '1',
      url: 'https://example.com/hello',
      title: 'Hello JSON',
      content_html: '<p>JSON feed body</p>',
      summary: 'A JSON summary',
      date_published: '2024-08-01T00:00:00Z',
      tags: ['json', 'feed'],
      authors: [{ name: 'Bob' }],
    },
  ],
})

const OPML = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="1.0">
<head><title>Feed Subscriptions</title></head>
<body>
  <outline title="news" text="news">
    <outline text="Solidot" title="最新更新 – Solidot" type="rss" xmlUrl="https://www.solidot.org/index.rss" htmlUrl="https://www.solidot.org"/>
  </outline>
  <outline text="Hacker News" title="Hacker News" type="rss" xmlUrl="https://news.ycombinator.com/rss" htmlUrl="https://news.ycombinator.com/"/>
</body>
</opml>`

const ARTICLE_HTML = `<!doctype html><html><head>
<title>Fallback title</title>
<meta property="og:title" content="真正 的 标题">
<meta property="og:site_name" content="Example Blog">
<meta name="author" content="Jane Doe">
<meta property="og:description" content="An interesting read">
<meta property="og:image" content="/cover.png">
<link rel="alternate" type="application/rss+xml" title="Example RSS" href="/feed.xml">
</head><body>
<nav><a href="/">Home</a></nav>
<header><h1>Site header</h1></header>
<article>
  <h1>真正 的 标题</h1>
  <p>${'第一段内容。'.repeat(40)}</p>
  <p>第二段 <a href="/relative">链接</a> 内容。</p>
  <p><img data-src="/lazy.jpg" src="placeholder.gif" alt="图片"></p>
  <script>alert(1)</script>
</article>
<aside class="related"><p>相关文章</p></aside>
<footer>版权</footer>
</body></html>`

describe('parseFeedDocument – RSS 2.0', () => {
  const feed = parseFeedDocument(RSS, 'https://www.solidot.org/index.rss')

  it('reads channel metadata', () => {
    expect(feed.title).toBe('Solidot')
    expect(feed.format).toBe('rss')
    expect(feed.siteUrl).toBe('https://www.solidot.org/')
    expect(feed.iconUrl).toBe('https://www.solidot.org/favicon.ico')
    expect(feed.items).toHaveLength(2)
  })

  it('resolves links, content and images', () => {
    const item = feed.items[0]!
    expect(item.title).toBe('开源社区发布新工具')
    expect(item.link).toBe('https://www.solidot.org/story?sid=1')
    expect(item.guid).toBe('solidot-1')
    expect(item.contentHtml).toContain('正文第一段')
    expect(item.imageUrl).toBe('https://www.solidot.org/images/cover.jpg')
    expect(item.summary).toContain('摘要&内容')
    expect(item.categories).toEqual(['linux', '开源'])
    expect(item.audioUrl).toBe('https://cdn.example.com/audio.mp3')
    expect(item.publishedAt).toBe(Date.parse('2024-10-01T00:00:00Z'))
  })

  it('falls back to the feed URL and parses space separated dates', () => {
    const item = feed.items[1]!
    expect(item.link).toBe('https://www.solidot.org/index.rss')
    expect(item.guid).toBe('solidot-2')
    expect(item.publishedAt).toBeTypeOf('number')
  })
})

describe('parseFeedDocument – Atom', () => {
  const feed = parseFeedDocument(ATOM, 'https://antfu.me/feed.xml')

  it('reads atom metadata and entries', () => {
    expect(feed.format).toBe('atom')
    expect(feed.title).toBe('Anthony Fu')
    expect(feed.siteUrl).toBe('https://antfu.me/')
    expect(feed.items).toHaveLength(1)
  })

  it('decodes escaped html content and author', () => {
    const item = feed.items[0]!
    expect(item.title).toBe('Why I build tools')
    expect(item.link).toBe('https://antfu.me/posts/why')
    expect(item.author).toBe('Anthony Fu')
    expect(item.contentHtml).toBe('<p>Hello &amp; welcome</p>')
    expect(item.publishedAt).toBe(Date.parse('2024-09-20T10:00:00Z'))
    expect(item.categories).toEqual(['vue'])
  })
})

describe('parseFeedDocument – JSON Feed', () => {
  const feed = parseFeedDocument(JSON_FEED, 'https://example.com/feed.json')

  it('maps json feed items', () => {
    expect(feed.format).toBe('json')
    expect(feed.title).toBe('Example JSON')
    expect(feed.items[0]!.title).toBe('Hello JSON')
    expect(feed.items[0]!.author).toBe('Bob')
    expect(feed.items[0]!.summary).toBe('A JSON summary')
  })
})

describe('parseFeedDocument – failures', () => {
  it('throws a readable error for junk input', () => {
    expect(() => parseFeedDocument('<html><body>nope</body></html>', 'https://x.test')).toThrow(/无法识别/)
    expect(() => parseFeedDocument('   ', 'https://x.test')).toThrow()
  })
})

describe('opml', () => {
  it('flattens folders into feed entries', () => {
    const doc = parseOpml(OPML)
    expect(doc.feeds).toHaveLength(2)
    expect(doc.feeds[0]).toMatchObject({
      title: '最新更新 – Solidot',
      xmlUrl: 'https://www.solidot.org/index.rss',
      folder: 'news',
    })
    expect(doc.folders).toEqual(['news'])
  })
})

describe('extract', () => {
  it('extracts the main article and strips noise', () => {
    const result = extractArticle(ARTICLE_HTML, 'https://blog.example.com/posts/1')
    expect(result.title).toBe('真正 的 标题')
    expect(result.byline).toBe('Jane Doe')
    expect(result.html).toContain('第一段内容')
    expect(result.html).toContain('https://blog.example.com/relative')
    expect(result.html).toContain('https://blog.example.com/lazy.jpg')
    expect(result.html).not.toContain('alert(1)')
    expect(result.html).not.toContain('相关文章')
    expect(result.html).not.toContain('版权')
  })

  it('discovers feeds from link tags', () => {
    const result = discoverFeeds(ARTICLE_HTML, 'https://blog.example.com/posts/1')
    expect(result.candidates[0]?.url).toBe('https://blog.example.com/feed.xml')
    expect(result.candidates[0]?.title).toBe('Example RSS')
  })
})

describe('ai helpers', () => {
  it('parses streamed translation lines', () => {
    expect(parseTranslationLine('3||你好')).toEqual({ index: 3, text: '你好' })
    expect(parseTranslationLine('[12] 你好')).toEqual({ index: 12, text: '你好' })
    expect(parseTranslationLine('-1||标题')).toEqual({ index: -1, text: '标题' })
    expect(parseTranslationLine('随便一行')).toBeNull()
  })

  it('parses OpenAI-compatible model lists', () => {
    expect(
      parseOpenAiModelIds({
        object: 'list',
        data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }, { id: 'deepseek-chat' }],
      }),
    ).toEqual(['deepseek-chat', 'deepseek-reasoner'])
    expect(parseOpenAiModelIds({ models: [{ name: 'qwen2.5:7b' }, { model: 'llama3' }] })).toEqual([
      'llama3',
      'qwen2.5:7b',
    ])
    expect(parseOpenAiModelIds({ data: ['b', 'a'] })).toEqual(['a', 'b'])
    expect(parseOpenAiModelIds({ data: [] })).toEqual([])
    expect(parseOpenAiModelIds(null)).toEqual([])
    expect(parseOpenAiModelIds('nope')).toEqual([])
  })
})

describe('utils', () => {
  it('handles sloppy dates', () => {
    expect(parseDate('2024-01-02T03:04:05Z')).toBeTypeOf('number')
    expect(parseDate('2024-01-02 03:04:05')).toBeTypeOf('number')
    expect(parseDate('')).toBeUndefined()
  })

  it('strips html and entities', () => {
    expect(stripHtml('<p>a&nbsp;b &amp; c</p><script>x</script>')).toBe('a b & c')
  })

  it('normalises urls', () => {
    expect(normalizeUrl('example.com/feed')).toBe('https://example.com/feed')
    expect(normalizeUrl('http://example.com/feed')).toBe('http://example.com/feed')
  })

  it('truncates on codepoint boundaries', () => {
    expect(truncate('abcdef', 3)).toBe('abc…')
    expect(truncate('abc', 3)).toBe('abc')
  })
})
