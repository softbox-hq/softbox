import { useEffect, useMemo, useState } from 'react'

type NewsItem = {
  title: string
  link: string
  pubDate: string
}

type AppRoute = '/' | '/dashboard' | '/about'

import './App.css'

type PublicCam = {
  name: string
  place: string
  href: string
  embedUrl: string
  note: string
}

const publicCams: PublicCam[] = [
  {
    name: 'Times Square',
    place: 'New York City, USA',
    href: 'https://www.youtube.com/watch?v=rnXIjl_Rzy4',
    embedUrl: 'https://www.youtube.com/embed/rnXIjl_Rzy4?autoplay=1&mute=1',
    note: 'EarthCam’s Times Square feed. Loud city energy, minus the sound.',
  },
  {
    name: 'Times Square Crossroads',
    place: 'New York City, USA',
    href: 'https://www.youtube.com/watch?v=PGrq-2mju2s',
    embedUrl: 'https://www.youtube.com/embed/PGrq-2mju2s?autoplay=1&mute=1',
    note: 'Another angle on Times Square, because apparently one wasn’t enough.',
  },
  {
    name: 'NYC Multi-Cam',
    place: 'New York City, USA',
    href: 'https://www.youtube.com/watch?v=VGnFLdQW39A',
    embedUrl: 'https://www.youtube.com/embed/VGnFLdQW39A?autoplay=1&mute=1',
    note: 'A rotating city view with a few live NYC camera angles.',
  },
  {
    name: 'Worldwide Webcam Tour',
    place: 'Various locations',
    href: 'https://www.youtube.com/watch?v=HVGwLboIdYc',
    embedUrl: 'https://www.youtube.com/embed/HVGwLboIdYc?autoplay=1&mute=1',
    note: 'A live tour bouncing between public webcams around the world.',
  },
  {
    name: 'Around the World Webcams',
    place: 'Various locations',
    href: 'https://www.youtube.com/watch?v=0NffMsxiY8k',
    embedUrl: 'https://www.youtube.com/embed/0NffMsxiY8k?autoplay=1&mute=1',
    note: 'More global camera hopping, but actually embeddable this time.',
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

function getRouteFromPath(pathname: string): AppRoute {
  if (pathname === '/dashboard') return '/dashboard'
  if (pathname === '/about') return '/about'
  return '/'
}

function App() {
  const [route, setRoute] = useState<AppRoute>(() => getRouteFromPath(window.location.pathname))
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
    const onPopState = () => setRoute(getRouteFromPath(window.location.pathname))

    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
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

  const routeMeta = useMemo(
    () => ({
      '/': { label: 'Home', title: 'Home' },
      '/dashboard': { label: 'Dashboard', title: 'Dashboard' },
      '/about': { label: 'About', title: 'About' },
    })[route],
    [route],
  )

  const navigateTo = (nextRoute: AppRoute) => {
    if (nextRoute === route) return
    window.history.pushState({}, '', nextRoute)
    setRoute(nextRoute)
  }

  return (
    <main className="chat-page">
      <section className="chat-shell" aria-labelledby="chat-title">
        <nav className="top-tabs" aria-label="Primary navigation tabs">
          <a
            href="/"
            className={`top-tabs__tab ${route === '/' ? 'top-tabs__tab--active' : ''}`}
            onClick={(event) => {
              event.preventDefault()
              navigateTo('/')
            }}
          >
            Home
          </a>
          <a
            href="/dashboard"
            className={`top-tabs__tab ${route === '/dashboard' ? 'top-tabs__tab--active' : ''}`}
            onClick={(event) => {
              event.preventDefault()
              navigateTo('/dashboard')
            }}
          >
            Dashboard
          </a>
          <a
            href="/about"
            className={`top-tabs__tab ${route === '/about' ? 'top-tabs__tab--active' : ''}`}
            onClick={(event) => {
              event.preventDefault()
              navigateTo('/about')
            }}
          >
            About
          </a>
        </nav>

        <header className="route-header" aria-label="Current route header">
          <p className="route-header__eyebrow">Current route</p>
          <h1 className="route-header__title">{routeMeta.title}</h1>
          <p className="route-header__path">{window.location.pathname}</p>
        </header>

        {route === '/' ? (
          <>
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
                  onClick={() =>
                    setCamIndex(
                      (current) => (current + 1 + Math.floor(Math.random() * 4)) % publicCams.length,
                    )
                  }
                >
                  Randomize
                </button>
              </div>

              <p className="webcam-card__note">{activeCam.note}</p>

              <div className="webcam-card__frame-wrap">
                <iframe
                  key={activeCam.embedUrl}
                  src={activeCam.embedUrl}
                  title={`${activeCam.name} live webcam`}
                  className="webcam-card__frame"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  allow="autoplay; fullscreen; picture-in-picture"
                />
              </div>

              <p className="webcam-card__fallback">
                If this camera refuses to render in the page, open it directly:
              </p>

              <a href={activeCam.href} target="_blank" rel="noreferrer" className="webcam-card__link">
                Open live webcam
              </a>
            </div>
          </>
        ) : route === '/dashboard' ? (
          <div className="dashboard-grid" aria-label="Dashboard route content">
            <div className="info-card stat-card">
              <p className="stat-card__label">Clock</p>
              <h2 className="stat-card__value">{now.time}</h2>
              <p className="stat-card__meta">{now.date}</p>
            </div>

            <div className="info-card stat-card">
              <p className="stat-card__label">Iran headlines</p>
              <h2 className="stat-card__value">{news.length}</h2>
              <p className="stat-card__meta">{newsStatus}</p>
            </div>

            <div className="info-card stat-card stat-card--wide">
              <p className="stat-card__label">Current live cam</p>
              <h2 className="stat-card__value">{activeCam.name}</h2>
              <p className="stat-card__meta">{activeCam.place}</p>
            </div>
          </div>
        ) : (
          <div className="info-card about-card" aria-label="About route content">
            <p className="about-card__eyebrow">About this page</p>
            <h2>Small control room, real routes</h2>
            <p>
              This app now uses browser history routes for Home, Dashboard, and About without adding a
              routing library. The tabs update the URL, support back/forward navigation, and render
              route-specific content.
            </p>
          </div>
        )}
      </section>
    </main>
  )
}

export default App
