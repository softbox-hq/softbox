import { useEffect, useState } from 'react'

type NewsItem = {
  title: string
  link: string
  pubDate: string
}

import './App.css'

const telegramReality = [
  'No — not magically. I cannot inspect your whole Telegram account, read all your private messages, or browse your history unless Telegram itself exposes that data through a connection you explicitly set up.',
  'With a normal Telegram bot integration, the scope is much narrower: I can only see messages sent to that bot or in chats where the bot is present and allowed to read them.',
  'I do not get automatic access to your DMs, archived chats, contacts, secret chats, or account-wide history just because you asked.',
  'So: your messages are not something I can just pull out of your account on my own. That is a platform permission boundary, not me being difficult.',
  'If you want, I can help you set up the maximum legitimate access Telegram allows through a bot, or show you how to export your own data and let me analyze it locally.',
]

function formatNow(date: Date) {
  return {
    date: new Intl.DateTimeFormat(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(date),
    time: new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(date),
  }
}

function formatNewsTime(value: string) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function parseNewsFeed(xmlText: string) {
  const xml = new window.DOMParser().parseFromString(xmlText, 'text/xml')

  return Array.from(xml.querySelectorAll('item'))
    .slice(0, 4)
    .map((item) => ({
      title: item.querySelector('title')?.textContent?.trim() ?? 'Untitled headline',
      link: item.querySelector('link')?.textContent?.trim() ?? '#',
      pubDate: item.querySelector('pubDate')?.textContent?.trim() ?? '',
    }))
    .filter((item) => item.title)
}

async function fetchFeedThrough(url: string) {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Feed request failed: ${response.status}`)
  }

  return response.text()
}

function App() {
  const [now, setNow] = useState(() => formatNow(new Date()))
  const [news, setNews] = useState<NewsItem[]>([])
  const [newsStatus, setNewsStatus] = useState('Loading latest Iran headlines…')

  useEffect(() => {
    const tick = () => setNow(formatNow(new Date()))
    const interval = window.setInterval(tick, 1000)

    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadNews = async () => {
      setNewsStatus('Loading latest Iran headlines…')

      const directFeed = 'https://news.google.com/rss/search?q=Iran&hl=en-US&gl=US&ceid=US:en'
      const fallbackFeed = 'https://feeds.bbci.co.uk/news/world/middle_east/rss.xml'
      const sources = [
        `https://api.allorigins.win/raw?url=${encodeURIComponent(directFeed)}`,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(fallbackFeed)}`,
        `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(directFeed)}`,
        `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(fallbackFeed)}`,
      ]

      for (const source of sources) {
        try {
          const xmlText = await fetchFeedThrough(source)
          const items = parseNewsFeed(xmlText).filter(
            (item) => source.includes('q=Iran') || /iran/i.test(item.title),
          )

          if (!cancelled && items.length) {
            setNews(items)
            setNewsStatus('Latest news')
            return
          }
        } catch {
          // try next source
        }
      }

      if (!cancelled) {
        setNews([])
        setNewsStatus('Live feeds are blocked right now. Try again in a moment.')
      }
    }

    loadNews()
    const refreshInterval = window.setInterval(loadNews, 1000 * 60 * 10)

    return () => {
      cancelled = true
      window.clearInterval(refreshInterval)
    }
  }, [])

  return (
    <main className="chat-page">
      <section className="chat-shell" aria-labelledby="chat-title">
        <div className="widget-row">
          <div className="clock-widget" aria-label="Current date and time widget">
            <p className="clock-widget__label">Current time</p>
            <p className="clock-widget__time">{now.time}</p>
            <p className="clock-widget__date">{now.date}</p>
          </div>

          <div className="news-widget" aria-label="Latest Iran news widget">
            <p className="news-widget__label">Iran news</p>
            <h2 className="news-widget__title">Latest headlines</h2>
            <p className="news-widget__status">{newsStatus}</p>
            <ul className="news-widget__list">
              {news.map((item) => (
                <li key={`${item.link}-${item.pubDate}`} className="news-widget__item">
                  <a href={item.link} target="_blank" rel="noreferrer" className="news-widget__link">
                    {item.title}
                  </a>
                  {item.pubDate ? (
                    <p className="news-widget__time">{formatNewsTime(item.pubDate)}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="info-card" aria-label="Telegram setup guide">
          <h2>Can I inspect your whole Telegram account?</h2>
          <ol>
            {telegramReality.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      </section>
    </main>
  )
}

export default App
