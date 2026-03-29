import { useEffect, useState } from 'react'

type NewsItem = {
  title: string
  link: string
  pubDate: string
}

import './App.css'

type PublicCam = {
  name: string
  place: string
  href: string
  note: string
}

const publicCams: PublicCam[] = [
  {
    name: 'Venice Grand Canal',
    place: 'Venice, Italy',
    href: 'https://www.skylinewebcams.com/en/webcam/italia/veneto/venezia/canal-grande-rialto.html',
    note: 'Busy canal traffic and classic Venice chaos.',
  },
  {
    name: 'Times Square',
    place: 'New York City, USA',
    href: 'https://www.earthcam.com/usa/newyork/timessquare/',
    note: 'Bright lights, giant screens, permanent overstimulation.',
  },
  {
    name: 'Shibuya Crossing',
    place: 'Tokyo, Japan',
    href: 'https://www.skylinewebcams.com/en/webcam/japan/kanto/tokyo/shibuya-crossing.html',
    note: 'One of the best people-flow cameras on earth.',
  },
  {
    name: 'Old Town Square',
    place: 'Prague, Czech Republic',
    href: 'https://www.skylinewebcams.com/en/webcam/czech-republic/prague/prague/old-town-square.html',
    note: 'Historic center, rooftops, clock, tourists.',
  },
  {
    name: 'Santa Monica Beach',
    place: 'California, USA',
    href: 'https://www.earthcam.com/usa/california/santamonica/',
    note: 'Beach, pier, weather, a more relaxed kind of surveillance.',
  },
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
  const [camIndex, setCamIndex] = useState(() => Math.floor(Math.random() * publicCams.length))

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

  const activeCam = publicCams[camIndex]

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

        <div className="info-card webcam-card" aria-label="Random public live webcam widget">
          <div className="webcam-card__header">
            <div>
              <p className="webcam-card__label">Public live cam</p>
              <h2>{activeCam.name}</h2>
              <p className="webcam-card__place">{activeCam.place}</p>
            </div>
            <button
              type="button"
              className="webcam-card__button"
              onClick={() => setCamIndex((current) => (current + 1 + Math.floor(Math.random() * 4)) % publicCams.length)}
            >
              Randomize
            </button>
          </div>

          <p className="webcam-card__note">{activeCam.note}</p>

          <a href={activeCam.href} target="_blank" rel="noreferrer" className="webcam-card__link">
            Open live webcam
          </a>
        </div>
      </section>
    </main>
  )
}

export default App
