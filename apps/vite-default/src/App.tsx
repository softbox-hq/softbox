import { useEffect, useMemo, useState } from 'react'

type NewsItem = {
  title: string
  link: string
  pubDate: string
}

type MetalCard = {
  name: string
  symbol: string
  unit: string
  price: string
  change: string
  note: string
  tone: 'gold' | 'silver' | 'bronze'
}

type SystemStat = {
  label: string
  value: string
  detail: string
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

async function fetchJson<T>(url: string) {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`JSON request failed: ${response.status}`)
  }

  return (await response.json()) as T
}

function formatUsd(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value >= 100 ? 2 : 3,
  }).format(value)
}

function formatBytes(value: number) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 1,
  }).format(value / 1024 / 1024 / 1024)
}

function getRouteFromPath(pathname: string): AppRoute {
  if (pathname === '/dashboard') return '/dashboard'
  if (pathname === '/about') return '/about'
  return '/'
}

function App() {
  const [route, setRoute] = useState<AppRoute>(() => getRouteFromPath(window.location.pathname))
  const [photoSeed, setPhotoSeed] = useState(() => Math.floor(Math.random() * 100000))
  const [now, setNow] = useState(() => formatNow(new Date()))
  const [news, setNews] = useState<NewsItem[]>([])
  const [newsStatus, setNewsStatus] = useState('Loading latest Iran headlines…')
  const [camIndex, setCamIndex] = useState(() => Math.floor(Math.random() * publicCams.length))
  const [metals, setMetals] = useState<MetalCard[]>([
    {
      name: 'Gold',
      symbol: 'XAU',
      unit: 'per troy oz',
      price: 'Loading…',
      change: 'Live feed pending',
      note: 'Spot gold in USD.',
      tone: 'gold',
    },
    {
      name: 'Silver',
      symbol: 'XAG',
      unit: 'per troy oz',
      price: 'Loading…',
      change: 'Live feed pending',
      note: 'Spot silver in USD.',
      tone: 'silver',
    },
    {
      name: 'Bronze',
      symbol: 'BRZ',
      unit: 'benchmark est.',
      price: 'Loading…',
      change: 'Derived estimate',
      note: 'Bronze has no clean global spot feed, so this is an alloy benchmark estimate.',
      tone: 'bronze',
    },
  ])
  const [metalsStatus, setMetalsStatus] = useState('Loading metals…')
  const [systemStats, setSystemStats] = useState<SystemStat[]>([
    {
      label: 'CPU',
      value: 'Unknown',
      detail: 'Live host CPU usage is not exposed to this frontend.',
    },
    {
      label: 'RAM',
      value: 'Unknown',
      detail: 'Waiting for browser-visible memory info.',
    },
    {
      label: 'Free space',
      value: `${formatBytes(938510725120)} GB`,
      detail: `${formatBytes(1081101176832)} GB total on this workspace disk snapshot.`,
    },
  ])

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
    const memoryGiB = typeof navigator.deviceMemory === 'number' ? navigator.deviceMemory : null
    const cpuThreads = typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : null

    setSystemStats([
      {
        label: 'CPU',
        value: cpuThreads ? `${cpuThreads} threads` : 'Unavailable',
        detail: 'Browser-visible hardware concurrency, not live CPU load.',
      },
      {
        label: 'RAM',
        value: memoryGiB ? `${memoryGiB} GB` : 'Unavailable',
        detail: 'Approximate device memory reported by the browser.',
      },
      {
        label: 'Free space',
        value: `${formatBytes(938510725120)} GB`,
        detail: `${formatBytes(1081101176832)} GB total on this workspace disk snapshot.`,
      },
    ])
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadMetals = async () => {
      setMetalsStatus('Loading metals…')

      try {
        const [gold, silver] = await Promise.all([
          fetchJson<{ price: number; ch: number }>('https://api.gold-api.com/price/XAU'),
          fetchJson<{ price: number; ch: number }>('https://api.gold-api.com/price/XAG'),
        ])

        const bronzeEstimate = silver.price * 0.0036
        const bronzeChange = silver.ch * 0.0036

        if (!cancelled) {
          setMetals([
            {
              name: 'Gold',
              symbol: 'XAU',
              unit: 'per troy oz',
              price: formatUsd(gold.price),
              change: `${gold.ch >= 0 ? '+' : ''}${formatUsd(gold.ch)} today`,
              note: 'Live spot gold in USD.',
              tone: 'gold',
            },
            {
              name: 'Silver',
              symbol: 'XAG',
              unit: 'per troy oz',
              price: formatUsd(silver.price),
              change: `${silver.ch >= 0 ? '+' : ''}${formatUsd(silver.ch)} today`,
              note: 'Live spot silver in USD.',
              tone: 'silver',
            },
            {
              name: 'Bronze',
              symbol: 'BRZ',
              unit: 'benchmark est.',
              price: formatUsd(bronzeEstimate),
              change: `${bronzeChange >= 0 ? '+' : ''}${formatUsd(bronzeChange)} est.`,
              note: 'Estimated alloy benchmark, because literal bronze does not have a standard live spot feed.',
              tone: 'bronze',
            },
          ])
          setMetalsStatus('Live metals board')
        }
      } catch {
        if (!cancelled) {
          setMetalsStatus('Live metals feed unavailable right now.')
        }
      }
    }

    loadMetals()
    const metalsRefreshInterval = window.setInterval(loadMetals, 1000 * 60 * 5)

    return () => {
      cancelled = true
      window.clearInterval(metalsRefreshInterval)
    }
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
  const photoUrl = `https://picsum.photos/seed/softbox-photo-${photoSeed}/900/1200`

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

              <div className="photo-stack">
                <div className="photo-widget" aria-label="Random photo of the day widget">
                  <div className="photo-widget__header">
                    <div>
                      <p className="photo-widget__label">Photo of the day</p>
                      <h2 className="photo-widget__title">Random pick</h2>
                    </div>
                    <button
                      type="button"
                      className="photo-widget__button"
                      onClick={() => setPhotoSeed(Math.floor(Math.random() * 100000))}
                    >
                      New photo
                    </button>
                  </div>

                  <div className="photo-widget__frame">
                    <img src={photoUrl} alt="Random photo of the day" className="photo-widget__image" />
                  </div>
                </div>

                <div className="system-widget" aria-label="System usage widget">
                  <div className="system-widget__header">
                    <p className="system-widget__label">System snapshot</p>
                    <h2 className="system-widget__title">CPU, RAM, space</h2>
                  </div>

                  <div className="system-widget__grid">
                    {systemStats.map((stat) => (
                      <article key={stat.label} className="system-stat-card">
                        <p className="system-stat-card__label">{stat.label}</p>
                        <p className="system-stat-card__value">{stat.value}</p>
                        <p className="system-stat-card__detail">{stat.detail}</p>
                      </article>
                    ))}
                  </div>
                </div>
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
          <div className="metals-widget" aria-label="Live metals price widget">
            <div className="metals-widget__header">
              <div>
                <p className="metals-widget__eyebrow">Metals board</p>
                <h2 className="metals-widget__title">Gold, silver, bronze</h2>
              </div>
              <p className="metals-widget__status">{metalsStatus}</p>
            </div>

            <div className="metals-widget__grid">
              {metals.map((metal) => (
                <article
                  key={metal.symbol}
                  className={`metal-card metal-card--${metal.tone}`}
                  aria-label={`${metal.name} price card`}
                >
                  <p className="metal-card__symbol">{metal.symbol}</p>
                  <h3 className="metal-card__name">{metal.name}</h3>
                  <p className="metal-card__price">{metal.price}</p>
                  <p className="metal-card__unit">{metal.unit}</p>
                  <p className="metal-card__change">{metal.change}</p>
                  <p className="metal-card__note">{metal.note}</p>
                </article>
              ))}
            </div>
          </div>
        ) : (
          <div className="info-card about-card" aria-label="About route content">
            <p className="about-card__eyebrow">Gateway cron jobs</p>
            <h2>Yes, I can create them</h2>
            <p>
              Yes — I can create cron jobs inside the Gateway from here. Not just talk about them: I can
              actually add, update, list, run, disable, and remove them.
            </p>
            <p>
              So if you want a scheduled reminder, recurring check, summary, wake-up event, or periodic
              agent task, I can wire that into Gateway cron directly.
            </p>
            <p>
              If you want, the next step is simple: tell me what should happen, when it should run, and
              whether it repeats. Then I can create the job.
            </p>
          </div>
        )}
      </section>
    </main>
  )
}

export default App
